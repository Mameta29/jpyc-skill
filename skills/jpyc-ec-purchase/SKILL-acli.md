---
name: jpyc-ec-purchase-acli
description: Purchase products from JPYC EC Platform via x402 using shell/curl-style commands. For agents that prefer direct HTTP over SDKs.
---

# JPYC EC Purchase Skill (acli / curl)

`SKILL.md` の curl / shell コマンド版。**TypeScript SDK が使えない環境** (CLI
エージェント、シェルベースの自動化、debug 用 acli 等) でも完走できるように、
全リクエストを `curl` で完結する形にしてあります。署名生成だけは EIP-712
ライブラリが要るので、`viem` の小さなインライン Node スクリプト経由で示します。

---

## Decision tree (必ず最初に実行)

```
1. GET  /api/v1/products/{id}        ← requires_shipping / variants 確認 (商品ごと)
2. POST /api/v1/checkout             ← 402 + reservation_id + 金額サマリ
       (no PAYMENT-SIGNATURE)
3. EIP-712 sign (TransferWithAuthorization) + build PaymentPayload
4. POST /api/v1/checkout             ← 200 + 注文成立
       (with PAYMENT-SIGNATURE, body は reservation_id のみ。任意の line_id_token は LINE Mini App 専用 — 外部エージェントは省略)
```

注文は `POST /api/v1/checkout` 一本。`items[]` で複数商品をまとめられます
(1 商品なら配列に 1 件)。

`requires_shipping=true` の商品で住所を渡さないと `400 shipping_required` が返ります。
これは **支払えば解決する問題ではない** ので、エージェントは住所を聞いて step 2 から
やり直してください。

---

## 決済方式の選択とAAウォレット

`PAYMENT-REQUIRED.accepts` は複数の決済方式を含む場合があります。配列の順序を決済方式の判定に使わず、`extra.assetTransferMethod` で選択してください。

本書の秘密鍵・EIP-712署名の例では `eip3009` を選択します。例中の `accepted` / `accepts` / `ACCEPTS_JSON` は、その選択済み要素を指します。対応要素が無ければ署名せず、対応ウォレットへ切り替えるよう案内してください。

マイナウォレットなど、EIP-3009署名を作れないAAウォレットでは、ウォレット自身の署名・送金APIが使える場合に限り、次の手順で `erc20-transfer` を選択できます。EOAの秘密鍵だけを持つエージェントが、AAアドレスを自己申告して代行することはできません。

1. 予約作成時に、支払元の `payer_address` と `transfer_authorization_version: "1"` を送ります。サーバーが `erc20-transfer` を提示したことを確認してください。
2. 選んだ要素の `amount` / `asset` / `payTo` / `network` を確認します。表示合計 `summary.total_jpyc` を18桁のatomic unitsへ変換した値と `amount` が一致しなければ、署名・送金を開始しません。注文識別用の端数は足しません。
3. `extra.payerAuthorization.message` を一文字も変更せず、支払元ウォレットで `personal_sign` します。この所有確認だけでは資金は動きません。
4. `POST /api/v1/checkout/authorize-transfer` へ `{ "reservation_id": "res_...", "signature": "0x..." }` を送ります。サーバーはEOA / ERC-1271 / ERC-6492の署名を検証します。HTTP 200で成功するまで送金してはいけません。
5. 予約ID・選択した要素・支払元を復旧用に保存してから、同じチェーンの `asset` コントラクトで `transfer(payTo, amount)` をウォレットから実行します。ガス代の負担はウォレットのスポンサー設定に依存します。
6. `PAYMENT-SIGNATURE` には次のオブジェクトをbase64urlで符号化して指定し、通常と同じ `POST /api/v1/checkout` へbody `{ "reservation_id": "res_..." }` を送ります。

```json
{
  "x402Version": 2,
  "accepted": "選択したerc20-transfer要素を、payerAuthorizationを含めオブジェクトのままコピー",
  "payload": { "payerAddress": "0x支払元", "txHash": "0x任意の送信結果" }
}
```

上記 `accepted` の説明文字列は実際のリクエストではJSONオブジェクトに置換してください。`txHash` は任意のヒントです。ウォレットがUserOperation hashしか返さなくても、サーバーがJPYCのTransferログを調べます。送金前の所有確認を省略して、過去の送金を後付けで注文に充当することはできません。

送金後の `transfer_not_found` は承認ブロック待ちの場合があります。同じ予約・payloadで結果確認だけを再試行し、transferを再送したり、新規予約で再購入したりしないでください。送金応答が失われた場合も同じ扱いです。予約が期限切れになった場合や確定状態が不明な場合は、注文履歴・運営の確認へ進みます。通常カート（`/checkout`）、対面レジ（`/pos`）、LINEトーク注文の `/pay` 画面は、同じAA決済基盤に対応しています。LINEの旧予約でAA方式が提示されない場合は注文を作り直します。所有確認後のLINE予約はネットワークを変更できません。定期便・JPYC Pay charges APIは対象外です。


## 0円デモの署名体験（マイナウォレット対応）

デモショップ（`is_demo: true`）の合計0 JPYC注文では、ウォレット自身の `personal_sign` を使って注文完了まで体験できます。通常の送金フローとは別の `demo-signature` 方式です。

1. 予約リクエストに `payer_address` と `demo_signature_version: "1"` を送ります（MCPの `quote_checkout` でも同じ指定）。
2. `accepts` に `extra.assetTransferMethod: "demo-signature"` があること、`amount` と表示合計がともに0であること、ネットワークと受取先を確認します。提示がないときはこの方式を合成しないでください。
3. 選択した `extra.payerAuthorization.message` を変更せず、対象ウォレットで `personal_sign` します。EOA / ERC-1271 / ERC-6492を検証できます。
4. 通常と同じ `POST /api/v1/checkout` へ `{ "reservation_id": "res_..." }` を送り、`PAYMENT-SIGNATURE` ヘッダに以下のPaymentPayloadをbase64urlで渡します（MCPは `submit_payment`）。

```json
{
  "x402Version": 2,
  "accepted": "提示されたdemo-signature要素をオブジェクトのままコピー",
  "payload": { "payerAddress": "0x対象ウォレット", "demoSignature": "0xpersonal_signの署名" }
}
```

`accepted` の説明文字列は実際のJSONオブジェクトへ置き換えてください。`demoSignature` は偶数桁hex、最大16KiBです。

この方式で `authorize-transfer`、`transfer`、`approve`、facilitatorは呼びません。JPYC残高・ガス代は不要です。成功時は `data.is_demo: true`、`tx_hash` はデモ用識別子です。通常店舗・有料注文には使えず、署名は予約・店舗・チェーン・ウォレット・有効期限に結びつきます。確認結果が受け取れなければ同じ予約と署名で再送してください。旧予約にdemo-signatureがない場合は、新しい予約を作成します。

エラー: `demo_signature_unavailable` (400: 対象外)、`demo_signature_invalid` (402: 不正署名)、`demo_signature_verification_unavailable` (502: 検証RPC障害)、`reservation_expired` (400: 期限切れ)、`demo_checkout_failed` (502: 保存失敗)。いずれもこの方式から送金は発生しません。


---

## Step 1 — Product info

```bash
curl -sS https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID} | jq .
```

重要フィールド:

- `data.product.requires_shipping` (bool) — true なら shipping ブロック必須
- `data.product.variants` (object | null) — 非 null なら `variant_selections` 必須
- `data.product.slug` (string | null) — 人間可読な商品URL用の値。商品ページURL
  は `/shops/{shop.slug}/products/{slug ?? id}`。**チェックアウトの `product_id`
  には必ず `id` (UUID) を使う** — `slug` は URL 表示専用。
- `data.shop.available_chains` (number[]) — 払えるチェーン ID
- `data.shop.default_chain_id` — チェーン指定省略時のデフォルト
- `data.shop.x402_enabled` (bool) — **false ならこのショップは x402 購入不可**。
  購入を中止し、ユーザーにその旨を伝える (`POST /checkout` しても
  `400 x402_disabled` で弾かれる)
- `data.shop.checkout_options` (array) — ショップ定義の購入オプション (のし /
  到着時間 / メッセージカード等)。各要素の **`required:true` はそのオプションが
  必須**。値を送らないと `400 invalid_checkout_option`。`id` をキーに
  `checkout_options` で値を渡す (下記参照)
- `data.shop.is_demo` (bool) — true なら**デモショップ**。x402 フローを JPYC
  残高ゼロで体験できる。settle で on-chain 送金は行われず、`tx_hash` は
  `0xde30…` で始まるダミー値 (注文ごとにユニーク)。リクエスト/署名手順は通常ショップと同一

`checkout_options` の各要素:

```json
{ "id": "noshi", "name": "のし", "required": true, "type": "select",
  "values": [ { "label": "あり", "surcharge_jpyc": "100" },
              { "label": "なし", "surcharge_jpyc": "0" } ] }
```

`required:true` のオプションがあるショップでは、Step 2 の body に
`"checkout_options": { "noshi": "あり" }` のように `id` をキーにした値を必ず
含めること (省略すると `400 invalid_checkout_option`)。`type` は `select`
(`values` から選ぶ) / `text` (自由入力) / `checkbox` (true/false)。

エラー:

- `404 PRODUCT_NOT_FOUND`
- `500 INTERNAL_ERROR`

---

## Step 2 — Request 402 challenge

```bash
curl -i -sS \
  -X POST \
  -H "Content-Type: application/json" \
  --data '{
    "shop_id": "{SHOP_ID}",
    "preferred_chain_id": 137,
    "items": [
      { "product_id": "{PRODUCT_ID}", "quantity": 1, "variant_selections": { "サイズ": "M" } }
    ],
    "customer_email": "buyer@example.com",
    "shipping": {
      "name": "山田太郎",
      "zip": "150-0001",
      "prefecture": "東京都",
      "address1": "渋谷区神宮前1-2-3",
      "tel": "090-1234-5678"
    }
  }' \
  https://ec.jpyc-service.com/api/v1/checkout
```

成功時 (HTTP 402):

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...
Content-Type: application/json

{
  "ok": false,
  "error": { "code": "payment_required", "message": "PAYMENT-SIGNATURE header is required" },
  "data": {
    "reservation_id": "res_a1b2...",
    "expires_at_unix_ms": 1731486100000,
    "summary": {
      "subtotal_jpyc": "5000", "discount_jpyc": "0", "shipping_jpyc": "500",
      "checkout_options_surcharge_jpyc": "0", "total_jpyc": "5500"
    }
  }
}
```

`PAYMENT-REQUIRED` ヘッダを取り出してデコード:

```bash
# レスポンスヘッダから抽出 (ヘッダ名は HTTP/2 で小文字化されるので case-insensitive で grep)
PAYMENT_REQUIRED_B64=$(curl -isS ... | awk -F': ' 'tolower($1)=="payment-required"{print $2}' | tr -d '\r')

# base64url → base64 に正規化してからデコード (BSD/macOS の `base64 -d` は
# base64url を直接サポートしないので必須)
echo "$PAYMENT_REQUIRED_B64" \
  | tr '_-' '/+' \
  | awk '{ pad = (4 - length($0) % 4) % 4; printf "%s%s", $0, substr("====", 1, pad) }' \
  | base64 -d | jq .
```

> **macOS / Linux 共通の堅牢な代替**: シェルの base64 は環境差が激しいため、
> Node が手元にあるなら次の方が確実です。
>
> ```bash
> echo "$PAYMENT_REQUIRED_B64" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0,"utf8").trim(),"base64url").toString())' | jq .
> ```
>
> Python なら:
>
> ```bash
> echo "$PAYMENT_REQUIRED_B64" | python3 -c 'import sys,base64; sys.stdout.write(base64.urlsafe_b64decode(sys.stdin.read().strip()+"===").decode())' | jq .
> ```

デコード後の例:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:137",
    "amount": "1500000000000000000000",
    "asset": "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
    "payTo": "0xShopWallet...",
    "maxTimeoutSeconds": 90,
    "extra": { "assetTransferMethod": "eip3009", "name": "JPY Coin", "version": "1", "decimals": 18, "symbol": "JPYC" }
  }]
}
```

リクエストボディのフィールド対応表:

| フィールド | 必須 | メモ |
|-----------|------|------|
| `shop_id` | ✅ | 全 `items` が同一ショップである必要がある |
| `items[]` | ✅ | `product_id` + `quantity` (+ `variant_selections`)。最低 1 件 |
| `items[].variant_selections` | `variants !== null` の商品で必須 | `{ option_name: value }` |
| `customer_email` | ✅ | 注文確認メールの宛先 |
| `preferred_chain_id` | 任意 | 全 `items` の `available_chains` の積集合内 |
| `shipping` | いずれかの item が `requires_shipping` のとき必須 | name / zip / prefecture / address1 / tel |
| `is_gift` / `gift_recipient` | 任意 | 贈り物のとき両方セット |
| `checkout_options` | 任意 | ショップ定義オプション (のし等) |
| `customer_note` | 任意 | max 2000 文字 |
| `payer_address` | 通常は任意 (推奨)、AA・NFT割引・クーポンでは必須 | 署名するウォレット。settle 時に署名の `from` と照合。不一致は 400 `payer_mismatch` (2026-07 追加) |
| `pos_session_id` | 使用しない | 対面レジ UI 専用の内部フィールド。エージェントは送らない (2026-08 追加) |

エラーコード:

- `400 invalid_body` ← zod schema 違反全般。`quantity <= 0`、`customer_email`
  欠落/不正、`preferred_chain_id` がその環境で未対応、等はすべてこれ (専用コード
  なし)。`message` に zod の詳細が JSON 文字列で入る
- `400 shipping_required` ← 住所聞いてリトライ
- `400 shop_mismatch` ← items に別ショップの商品が混在
- `400 no_common_chain` ← items の `available_chains` に共通チェーンがない
- `400 variant_required` / `400 invalid_variant`
- `400 invalid_checkout_option` ← required:true の checkout_options 欠落/不正値
  → ショップの `checkout_options` を見て必須オプションを聞き、再送。
  `message` はユーザー向け日本語 (例「到着時間を選択してください」) で
  オプションの `name` を含む (`id` ではない)
- `400 x402_disabled` ← このショップは x402 未対応 (shop.x402_enabled=false)
- `404 product_not_found` / `404 shop_not_found`
- `409 insufficient_stock`
- `429 rate_limited` (30 req/60s/IP)

---

## Step 3 — Sign EIP-712 (inline Node script)

純粋な shell では EIP-712 署名は厳しいので、`viem` の最小 Node スクリプトを使います。

```bash
cat > /tmp/sign-x402.mjs <<'EOF'
import { privateKeyToAccount } from "viem/accounts"
import { randomBytes } from "node:crypto"

const accepts = JSON.parse(process.argv[2])
const buyerKey = process.env.BUYER_PRIVATE_KEY
if (!buyerKey) throw new Error("BUYER_PRIVATE_KEY missing")
const account = privateKeyToAccount(buyerKey)

const validAfter = 0n
const validBefore = BigInt(Math.floor(Date.now() / 1000) + accepts.maxTimeoutSeconds)
const nonce = "0x" + randomBytes(32).toString("hex")

const signature = await account.signTypedData({
  domain: {
    name: accepts.extra.name,
    version: accepts.extra.version,
    chainId: Number(accepts.network.split(":")[1]),
    verifyingContract: accepts.asset,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: account.address,
    to: accepts.payTo,
    value: BigInt(accepts.amount),
    validAfter,
    validBefore,
    nonce,
  },
})

const payload = {
  x402Version: 2,
  accepted: accepts,
  payload: {
    signature,
    authorization: {
      from: account.address,
      to: accepts.payTo,
      value: accepts.amount,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  },
}
console.log(Buffer.from(JSON.stringify(payload)).toString("base64url"))
EOF

ACCEPTS_JSON=$(echo "$PAYMENT_REQUIRED_B64" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0,"utf8").trim(),"base64url").toString())' | jq -ce '[.accepts[] | select(.extra.assetTransferMethod == "eip3009")][0] // error("No supported eip3009 payment method")')
PAYMENT_SIGNATURE=$(BUYER_PRIVATE_KEY=0x... node /tmp/sign-x402.mjs "$ACCEPTS_JSON")
```

---

## Step 4 — Settle

```bash
RESERVATION_ID="res_a1b2..."  # step 2 のレスポンスから取得

curl -i -sS \
  -X POST \
  -H "Content-Type: application/json" \
  -H "PAYMENT-SIGNATURE: $PAYMENT_SIGNATURE" \
  --data "{\"reservation_id\":\"$RESERVATION_ID\"}" \
  https://ec.jpyc-service.com/api/v1/checkout
```

成功 (HTTP 200):

```
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLC...

{
  "ok": true,
  "data": {
    "order_id": "uuid",
    "order_number": "ORD-2026-...",
    "tx_hash": "0x<64hex>",
    "network": "eip155:137",
    "payer": "0x<agent>",
    "amount_atomic": "1500000000000000000000",
    "is_demo": false
  }
}
```

> `data.is_demo` が `true` ならデモショップの注文。on-chain 送金は行われず
> `tx_hash` は `0xde30…` で始まるダミー値 (注文ごとにユニーク、エクスプローラでは引けない)。
> デモ判定は `is_demo` で行い (tx_hash の中身に依存しない)、
> ユーザーには「デモ決済で実際の JPYC 送金はない」と明示すること。

エラー (status / code):

| Status | Code | 行動 |
|--------|------|------|
| 400 | `invalid_payment_payload` | base64 / JSON を見直し |
| 400 | `payload_mismatch` | step 2 からやり直し |
| 400 | `payer_mismatch` | `payer_address` と署名 `from` の不一致。正しいウォレットで再署名して同じ reservation に再送 (2026-07 追加) |
| 402 | `invalid_exact_evm_payload_signature` | 再署名 |
| 402 | `invalid_exact_evm_payload_authorization_valid_before` | reservation 期限切れ→step 2 やり直し |
| 402 | `insufficient_funds` | JPYC 残高不足 |
| 404 | `reservation_not_found` | 5 分超過→step 2 やり直し (決済済みへの再送では返らない: 冪等リプレイで 200) |
| 404 | `product_disappeared` | 商品削除 |
| 409 | `insufficient_stock` / `shop_wallet_changed` | step 2 からやり直し |
| 429 | `rate_limited` | 決済・確認は900 req/60s/IP、かつ40 req/60s/予約ID (予約作成の30 req/60s/IPとは別枠)。15秒以上待ち、同じ予約・支払い情報で再試行 |
| 502 | `facilitator_insufficient_native_balance` | facilitator の gas 切れ。リトライ (運営に自動通知。復旧まで数分かかることも) |
| 502 | `settlement_failed` / `unexpected_settle_error` | facilitator が settle 失敗。リトライ。繰り返すなら運営に問い合わせ |
| 502 | `facilitator_unreachable` / `settle_precondition_failed` | 資金は動いていない。リトライ可 |
| 502 | `authorization_already_used` | 支払い成立済み。再署名せず `GET /orders` を確認 (注文は自動復旧) |
| 409 / 502 | `settlement_state_unknown` | **資金が動いた可能性あり。再署名・再送金・再購入しない**。2〜3 分後に `GET /orders?customer_address=...` を確認。注文が無くても未払いとは断定せず、同じ予約の確認または運営確認を続ける |

> **送金確認の間隔 (2026-09)**: `erc20-transfer` の `transfer_not_found` (402) は同じ予約・支払い情報のまま、前の応答を待ち、確認開始を通常2秒以上空けて再試行する。長時間未確定・接続エラーは5秒以上、429は15秒以上待つ。Polygonは`finalized`、Kaia mainnetはBFTの即時確定を使い、どちらも送金ログ・receipt・正規ブロックを照合してから確定する。RPCの不整合は502 `transfer_verification_failed` として再確認する。送金をやり直さず復旧情報を保持する。EIP-3009のFacilitator確定条件は変更なし。方式別の送金前所有確認・payloadは [OpenAPI](https://ec.jpyc-service.com/api/v1/openapi.yaml) を参照。

---

## Other endpoints (acli)

### Shop / product 一覧

```bash
curl -sS https://ec.jpyc-service.com/api/v1/shops | jq .
curl -sS https://ec.jpyc-service.com/api/v1/shops/{SLUG}/products | jq .
curl -sS https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID}/reviews | jq .
curl -sS https://ec.jpyc-service.com/api/v1/categories | jq .
```

### Agent discovery surface

REST を直接叩く以外に、エージェント向けの発見レイヤーが公開されている。

```bash
# プラットフォームの能力・エンドポイント・x402 決済レール一覧
curl -sS https://ec.jpyc-service.com/.well-known/commerce-manifest | jq .
# A2A Agent Card
curl -sS https://ec.jpyc-service.com/.well-known/agent-card.json | jq .
# OpenAPI 3.1 仕様
curl -sS https://ec.jpyc-service.com/api/v1/openapi.yaml
# LLM 向け Markdown インデックス
curl -sS https://ec.jpyc-service.com/llms.txt
```

MCP ホストからは `POST https://ec.jpyc-service.com/mcp` (Streamable HTTP)
に接続すると商品検索・購入ツールが使える。この acli 手順は MCP を使わず
HTTP を直接叩くエージェント向け。

### 注文履歴

```bash
curl -sS "https://ec.jpyc-service.com/api/v1/orders?customer_address=0x..." | jq .
```

`order_status` の意味: 3=決済完了 (`/api/v1/checkout` 経由はここから開始), 9=期限切れ。1/2 は旧フローの名残で新規注文では発生しない。

各 order に `refunds[]` (完了済み返金履歴) が付く。1 注文に対して複数の部分返金が積み重なるケースあり。各 refund は `{ amount_jpyc, tx_hash, chain_id, completed_at }`。実際の受領金額は `total_jpyc - sum(refunds[].amount_jpyc)`。

発送状況は `order_status` (決済) とは別に返る: `shipping_status` (`null`=配送不要/発送準備前, `pending`=発送準備中, `shipped`=発送済み, `delivered`=配送完了), `shipped_at`, `tracking_number`, `shipping_carrier`。「発送済みか」は `order_status` ではなく `shipping_status` で判断する (決済完了でも未発送なら `null`/`pending`)。デジタル商品・配送先なしの注文は常に `null`。

### デジタル商品ダウンロード

商品が `is_digital: true` なら、決済完了 (`order_status: 3`) 後に署名付きダウンロード URL を発行できる。

**本人確認は SIWE 署名チャレンジ** (自己申告アドレスは不可)。手順: ① nonce 取得 → ② SIWE メッセージを購入ウォレットで `personal_sign` → ③ download に提出。

```bash
# 1. nonce 取得 (5 分有効・使い捨て)
curl -sS -X POST "https://ec.jpyc-service.com/api/auth/siwe/nonce" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x<購入ウォレット>"}' | jq -r .nonce

# 2. SIWE メッセージ (EIP-4361, domain=ec.jpyc-service.com,
#    uri=https://ec.jpyc-service.com, nonce=上記, chainId=購入時のチェーン) を
#    組み立てて personal_sign で署名 (送金なし)

# 3. ダウンロード URL 発行
curl -sS -X POST "https://ec.jpyc-service.com/api/v1/orders/{ORDER_NUMBER}/download" \
  -H "Content-Type: application/json" \
  -d '{"message":"<SIWEメッセージ全文>","signature":"0x<署名>","product_id":"..."}' | jq .
```

レスポンス `data`: `{ url, file_name, version, expires_in_seconds }`。署名者アドレスが注文の購入ウォレットと一致する場合のみ発行。ファイルは 2 種類: **アップロード型** は `url` が短命な署名付き URL で `expires_in_seconds` 秒 (既定 300) で失効するため取得後すぐ DL する。**外部URL型** は `url` がショップ登録の外部 URL で有効期限がなく `expires_in_seconds` は `null`。常に最新版が返る (ショップがファイルを差し替えても同手順で最新版取得)。エラー: `MISSING_SIGNATURE`・`INVALID_MESSAGE`(400) / `UNAUTHORIZED`(401: nonce 期限切れ・使用済み・署名不正・署名先ドメイン不一致) / `ORDER_NOT_FOUND`(404) / `FORBIDDEN`・`NOT_PURCHASED`(403) / `NO_FILE`(404) / `RATE_LIMITED`(429) / `AUTH_UNAVAILABLE`(503: サービス側の認証設定不足)。

LINE連携用のSIWE署名は、`statement` や `resources` に専用の用途・LINEアカウントを含むため、ダウンロードやレシートなど別のAPIには転用できません。目的に合う新しいメッセージへ署名してください。

nonce は並行リクエスト間でも1回しか使用できない。再試行する場合は新しいnonceを取得し、
対象のECドメインと購入時のチェーンで再署名する。スマートウォレットの署名も、
SIWEに指定したチェーン上で検証される。`AUTH_UNAVAILABLE` の場合は再署名を繰り返さず、
サービス側の設定確認が必要な状態として扱う。

### NFT 割引ルール

```bash
curl -sS https://ec.jpyc-service.com/api/v1/shops/{SLUG}/nft-discounts | jq .
```

ルール取得後、`/api/v1/checkout` に `discount: { rule_id }` と署名する `payer_address` を渡します。対象NFTの保有確認と割引額はサーバーが再計算します。クーポンとは併用できません。

### 残高チェック (任意)

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  --data '{"address":"0x...","required_amount":"1500","chain_id":137}' \
  https://ec.jpyc-service.com/api/v1/balance/check | jq .
```

実用上は step 4 で `insufficient_funds` が返るので事前 check は省略可能。

### 配送料試算 (任意)

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  --data '{"shop_id":"uuid","prefecture":"東京都","items":[{"product_id":"uuid","quantity":1}]}' \
  https://ec.jpyc-service.com/api/v1/shipping/fee | jq .
```

ただし x402 経路は **1 回目の checkout 時点で送料込みの amount を確定** するので、
事前試算は UI 表示用途のみ。署名する金額は必ず `ACCEPTS_JSON.amount`
を使ってください。

---

## Environments

| 環境 | Base URL | チェーン ID |
|------|---------|------------|
| Production | `https://ec.jpyc-service.com` | 1 / 137 / 43114 / 8217 |
| Staging | `https://stg-ec.jpyc-service.com` | 11155111 / 80002 / 43113 / 1001 / 5042002 |

メインネット ID をステージングに送ると、その環境ではそのチェーンが使えないため
弾かれます。`/api/v1/checkout` では `400 invalid_body`、`/api/v1/balance/check`
では `INVALID_CHAIN` が返ります。

---

## Sanity-check snippet

step 2 が正しく動いているかの最小確認:

```bash
curl -isS -X POST \
  -H "Content-Type: application/json" \
  -d '{"shop_id":"{SHOP_ID}","items":[{"product_id":"{PRODUCT_ID}","quantity":1}],"customer_email":"test@example.com"}' \
  https://ec.jpyc-service.com/api/v1/checkout \
  | head -20
```

`requires_shipping=false` の商品なら `HTTP/2 402` と `payment-required:` ヘッダが
返れば OK。`requires_shipping=true` の商品では `400 shipping_required` が返ります
(これは「住所欠落」のシグナルで、再度 shipping ブロック付きで POST すれば 402 が返ります)。

> **HTTP/2 ヘッダ名は小文字**で来る点に注意: `awk -F': ' '/^PAYMENT-REQUIRED:/...'`
> ではマッチしません。上の例のように `tolower($1)=="payment-required"` を使うこと。

## 2026-09-18 販売期間・数量上限・クーポン

以下は本番とステージングの共通仕様です。ユーザーが選んだ環境の商品レスポンスとOpenAPIを確認し、その環境のAPI・対応チェーンを使ってください。

- 同一商品の複数バリエーションはそれぞれ `items[]` の別行に指定できます。在庫と購入上限は商品単位の数量合計で判定されます。商品の `max_quantity_per_order` がある場合、同一商品のバリエーション違いを含む数量合計を上限以下にしてください。`null` は購入上限なしです。
- `online_sale_status` (`coming_soon` / `on_sale` / `ended`)、`online_purchase_available`、販売開始・終了日時を確認してください。公開中でも販売期間外には購入できません。予約時にはサーバーが再検証し、409 `sale_not_started` / `sale_ended` / `quantity_limit_exceeded` を返す場合があります。
- 販売期間の対面レジ例外は、ショップがPOS販売を許可した配送不要・バリエーションなしの商品だけに適用されます。外部購入クライアントは `X-JPYC-CLIENT: pos` や `pos_session_id` を送らず、販売開始を待ってください。
- クーポンを利用するときは、初回checkoutに `coupon_code`、署名するウォレットの `payer_address`、16〜64文字の `idempotency_key` (UUID推奨) を送ります。通信断後は同じ購入内容・同じキーで再送し、返された予約と金額を使ってください。別の購入にキーを流用しません。
- NFT割引は `discount: { rule_id }` だけを指定します。割引額や保有状態の自己申告は使われません。NFT割引とクーポンは併用不可です。
- クーポンの総上限・ウォレット上限は予約時に確保されます。409 `coupon_total_limit_reached` / `coupon_wallet_limit_reached` / `coupon_not_applicable` / `coupon_changed` ではコードと条件を確認してください。別ウォレットでの制限回避を行ってはいけません。
- `idempotency_conflict` はキーに対応する購入内容が変わっています。送金前かどうかを確認してから購入内容を見直してください。`zero_payment_total` はクーポン適用後が0 JPYC以下です。
- AA所有確認後は送金APIの呼び出し前から利用枠を保持します。結果不明時には同じ予約で確認を続け、新規予約や送金の再実行はしません。
- 商品検索 `GET /products/search` は `q` / `shop` / `tag` / `category` / `minPrice` / `maxPrice` / `inStock` / `sort` / `limit` / `offset` を受け取ります。`limit` は1〜50、`offset` は0〜10000です。レスポンスは `{ products, server_time, pagination: { limit, offset, hasMore } }` です。

SIWEの認証nonceは、同じアドレスで再発行すると前のものが置き換わり、使用できるのは一度だけです。認証nonceと、送金に使うEIP-3009のnonceを混同しないでください。
