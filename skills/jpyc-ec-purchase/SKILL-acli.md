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
       (with PAYMENT-SIGNATURE, body は reservation_id のみ)
```

注文は `POST /api/v1/checkout` 一本。`items[]` で複数商品をまとめられます
(1 商品なら配列に 1 件)。

`requires_shipping=true` の商品で住所を渡さないと `400 shipping_required` が返ります。
これは **支払えば解決する問題ではない** ので、エージェントは住所を聞いて step 2 から
やり直してください。

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

ACCEPTS_JSON=$(echo "$PAYMENT_REQUIRED_B64" | node -e 'process.stdout.write(Buffer.from(require("fs").readFileSync(0,"utf8").trim(),"base64url").toString())' | jq -c '.accepts[0]')
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
| 402 | `invalid_exact_evm_payload_signature` | 再署名 |
| 402 | `invalid_exact_evm_payload_authorization_valid_before` | reservation 期限切れ→step 2 やり直し |
| 402 | `insufficient_funds` | JPYC 残高不足 |
| 404 | `reservation_not_found` | 5 分超過→step 2 やり直し |
| 404 | `product_disappeared` | 商品削除 |
| 409 | `insufficient_stock` / `shop_wallet_changed` | step 2 からやり直し |
| 429 | `rate_limited` | 数秒待ち |
| 502 | `facilitator_insufficient_native_balance` | facilitator の gas 切れ。リトライ (運営に自動通知。復旧まで数分かかることも) |
| 502 | `settlement_failed` / `unexpected_settle_error` | facilitator が settle 失敗。リトライ。繰り返すなら運営に問い合わせ |

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

```bash
curl -sS -X POST "https://ec.jpyc-service.com/api/v1/orders/{ORDER_NUMBER}/download" \
  -H "Content-Type: application/json" \
  -d '{"customer_address":"0x...","product_id":"..."}' | jq .
```

レスポンス `data`: `{ url, file_name, version, expires_in_seconds }`。本人確認は注文記録との照合 (注文番号 + 購入ウォレット + 商品 ID)。ファイルは 2 種類: **アップロード型** は `url` が短命な署名付き URL で `expires_in_seconds` 秒 (既定 300) で失効するため取得後すぐ DL する。**外部URL型** は `url` がショップ登録の外部 URL で有効期限がなく `expires_in_seconds` は `null`。常に最新版が返る (ショップがファイルを差し替えても同手順で最新版取得)。エラー: `ORDER_NOT_FOUND`(404) / `FORBIDDEN`・`NOT_PURCHASED`(403) / `NO_FILE`(404) / `RATE_LIMITED`(429)。

### NFT 割引ルール

```bash
curl -sS https://ec.jpyc-service.com/api/v1/shops/{SLUG}/nft-discounts | jq .
```

`/api/v1/checkout` は `discount` ブロックを受け付けるが、対象 NFT の保有確認と
割引額算出は呼び出し側の責務。情報取得のみのエンドポイント。

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
事前試算は UI 表示用途のみ。署名する金額は必ず `PAYMENT-REQUIRED.accepts[0].amount`
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
