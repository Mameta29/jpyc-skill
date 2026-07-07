---
name: jpyc-ec-purchase
description: Purchase products from JPYC EC Platform shops using JPYC stablecoin via x402 — one-shot HTTP-native gasless payments designed for AI agents.
---

# JPYC EC Purchase Skill

AI エージェントが **JPYC EC Platform** (https://ec.jpyc-service.com) のショップ
から商品を購入するためのスキルです。決済プロトコルは **x402 v2**
([coinbase/x402](https://github.com/coinbase/x402) 仕様、2025-12 リリース) に
準拠し、JPYC (日本円ステーブルコイン、1 JPYC = 1 JPY) を EIP-3009
`transferWithAuthorization` 署名で支払います。

**特徴**:

- **ガス代不要**: エージェント側はゼロ。プラットフォームの facilitator が gas を支払う
- **1 ショット決済**: HTTP 1 往復で settle が完了 (注文作成と署名提出を分けない)
- **マルチチェーン**: Ethereum / Polygon / Avalanche / Kaia / Sepolia / Amoy /
  Fuji / Kairos / Arc に対応
- **AI 向け設計**: 認証なし、ウォレットアドレス + 署名 = identity

---

## Prerequisites

- JPYC 残高のあるウォレットの**秘密鍵** (EIP-712 署名用)
- `viem` または同等の EIP-712 署名ライブラリ

---

## Environments

| 環境 | Base URL | 対応チェーン ID |
|------|---------|-----------------|
| Production | `https://ec.jpyc-service.com` | 1 (Ethereum), 137 (Polygon), 43114 (Avalanche), 8217 (Kaia) |
| Staging | `https://stg-ec.jpyc-service.com` | 11155111 (Sepolia), 80002 (Amoy), 43113 (Fuji), 1001 (Kairos), 5042002 (Arc) |

メインネット ID をステージングに、テストネット ID を本番に送ると、その環境では
そのチェーンが使えないため弾かれます。`/api/v1/checkout` では `400 invalid_body`
(`preferred_chain_id is not available in this environment`)、`/api/v1/balance/check`
では `INVALID_CHAIN` が返ります。

---

## Purchase Flow (x402)

注文は **`POST /api/v1/checkout`** に一本化されています。人間ユーザーの
storefront も AI エージェントも同じエンドポイントを使います。エージェントは
以下の 3 ステップで完走します。

```
1. GET  /api/v1/products/{productId}   ← 各商品の配送/バリエーション要件確認
2. POST /api/v1/checkout (no PAYMENT-SIGNATURE)
                                       ← 402 challenge + reservation_id + 金額サマリ
3. POST /api/v1/checkout (with PAYMENT-SIGNATURE, body は reservation_id のみ)
                                       ← 200 + 注文成立 + tx_hash
```

`/api/v1/checkout` は **カート単位** (複数商品 OK)。1 商品だけ買う場合も
`items` 配列に 1 件入れるだけです。

### Step 1 — Product info & branching

商品の **必須条件** を取得します。これを必ず先に呼んでください。スキップすると
ステップ 2 で `400 shipping_required` / `400 invalid_variant` が返り、エージェント
は再度ユーザーに情報を聞き直す必要があります。

```http
GET https://ec.jpyc-service.com/api/v1/products/{productId}
```

レスポンス:

```json
{
  "ok": true,
  "data": {
    "product": {
      "id": "uuid",
      "slug": "matcha-latte",
      "name": "商品名",
      "description": "...",
      "price_jpyc": "1500.000000000000000000",
      "stock": 42,
      "image_urls": ["https://..."],
      "category": "飲料",
      "subcategory": "お茶",
      "tags": ["organic", "limited"],
      "requires_shipping": true,
      "grants_free_shipping": false,
      "variants": {
        "options": [{ "name": "サイズ", "values": ["S", "M", "L"] }],
        "skus": [{ "options": { "サイズ": "M" }, "price_jpyc": "1500.0" }]
      },
      "review_avg_rating": 4.7,
      "review_count": 12,
      "has_nft_discount": false
    },
    "shop": {
      "id": "uuid",
      "slug": "example-shop",
      "name": "ショップ名",
      "wallet_address": "0x...",
      "available_chains": [137, 43114],
      "default_chain_id": 137,
      "is_demo": false,
      "x402_enabled": true,
      "checkout_options": [
        {
          "id": "noshi",
          "name": "のし",
          "required": true,
          "type": "select",
          "values": [
            { "label": "あり", "surcharge_jpyc": "100" },
            { "label": "なし", "surcharge_jpyc": "0" }
          ]
        },
        {
          "id": "message",
          "name": "メッセージカード",
          "required": false,
          "type": "text",
          "max_length": 100
        }
      ]
    }
  }
}
```

**判定** — Step 2 に進む前に、商品とショップの **必須条件をすべて満たす情報を
集めてあるか** を必ずこの表で確認してください。`checkout_options` は商品ではなく
**ショップ単位** の設定です。

| フィールド | 条件 | エージェントの行動 |
|-----------|------|-------------------|
| `product.requires_shipping === true` | 配送先住所が**必須** | ユーザーに **氏名・郵便番号・都道府県・市区町村以降の住所・電話番号** を聞き、`shipping` ブロックに入れる (email は別途必須) |
| `product.variants !== null` | バリエーション選択が**必須** | ユーザーに **どの組み合わせ** を選ぶか聞き、`items[].variant_selections` に入れる (例: `{ "サイズ": "M", "色": "白" }`) |
| `shop.checkout_options[]` の各要素で `required === true` | **そのオプションの値が必須** | ユーザーに値を聞き、`checkout_options` に `{ option_id: 値 }` で入れる。`required:false` のものは省略可。詳細は下の「checkout_options」節 |
| `shop.x402_enabled === false` | このショップは **x402 購入不可** | 購入を中止し、ユーザーに「このショップは AI エージェント経由の購入に対応していません」と伝える。`POST /checkout` しても `400 x402_disabled` で弾かれる |
| `shop.available_chains` | このチェーン以外は払えない | ユーザーに preference があれば pass、なければサーバが先頭を使う |
| `shop.is_demo === true` | **デモショップ** | JPYC 残高ゼロでも完走できる。実際の送金は起きず `tx_hash` はダミー。x402 フローの動作確認に使える (後述) |

#### checkout_options (ショップ定義の購入オプション)

`shop.checkout_options` は、のし・到着時間指定・メッセージカードなど **ショップが
独自に定義した購入時オプション** の配列です。各要素の構造:

- `id` — オプション識別子。`POST /checkout` の `checkout_options` ではこの `id`
  をキーに値を渡す
- `name` — ユーザー向け表示名 (例: 「のし」)
- `required` — **`true` ならそのオプションの値は必須**。値を送らずに `POST
  /checkout` すると `400 invalid_checkout_option` になる。`false` は省略可
- `type` — `"select"`（`values` から 1 つ選ぶ）/ `"text"`（自由入力、`max_length`
  まで）/ `"checkbox"`（true/false）
- `values` (select のみ) — 選択肢。各 `label` と追加料金 `surcharge_jpyc`
- `surcharge_jpyc` — 選んだ値に応じて合計金額に加算される (Step 2 の 402 で
  確定するので、エージェント側で足し算する必要はない)

`POST /checkout` に渡す形式 (Step 2 参照):

```json
"checkout_options": { "noshi": "あり", "message": "お誕生日おめでとう" }
```

`required:true` のオプションが 1 つでもあるショップでは、`checkout_options` を
省略すると Step 2 で弾かれます。**ショップに `checkout_options` がある場合は、
`required` を確認して必須のものを必ずユーザーに尋ねてください。**

> **デモショップ (`shop.is_demo === true`) について**: x402 購入フロー
> (402 → 署名 → 注文確定) を JPYC を持たずに体験するためのショップです。
> リクエスト/レスポンスの形・署名手順は通常ショップと完全に同一ですが、
> settle で **on-chain 送金が行われません** (facilitator を経由しない)。
> - JPYC 残高ゼロのウォレットでも settle が成功する
> - `tx_hash` は `0xde30…` で始まるダミー値 (注文ごとにユニーク)。ブロック
>   エクスプローラでは引けないので、エクスプローラ URL を提示しないこと。
>   デモ判定は `data.is_demo === true` で行うこと (tx_hash の中身に依存しない)
> - settle 成功レスポンスの `data.is_demo` が `true` で返る
> - 署名 (EIP-712) の検証はサーバ側で行われるため、不正な署名は弾かれる

> **ヒント**: `image_urls` は **空配列もありえる**。サムネ表示で `image_urls[0]`
> を使う場合は必ず存在チェックすること。

エラー:

- `404 PRODUCT_NOT_FOUND` — 商品が存在しないか非公開
- `500 INTERNAL_ERROR` — サーバエラー

### Step 2 — Request 402 challenge

`PAYMENT-SIGNATURE` ヘッダ **なし** で POST。サーバは在庫を 5 分間仮押さえし、
402 + `PAYMENT-REQUIRED` ヘッダ + 金額サマリを返します。

```http
POST https://ec.jpyc-service.com/api/v1/checkout
Content-Type: application/json

{
  "shop_id": "uuid-of-shop",
  "preferred_chain_id": 137,
  "items": [
    { "product_id": "uuid-1", "quantity": 1, "variant_selections": { "サイズ": "M" } },
    { "product_id": "uuid-2", "quantity": 2 }
  ],
  "customer_email": "yamada@example.com",
  "shipping": {
    "name": "山田太郎",
    "zip": "150-0001",
    "prefecture": "東京都",
    "address1": "渋谷区神宮前1-2-3",
    "address2": "サンプルマンション101",
    "tel": "090-1234-5678"
  },
  "is_gift": false,
  "customer_note": "プレゼント用に包装してください"
}
```

**フィールド**:

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `shop_id` | ✅ | 全 `items` が同一ショップに属している必要がある |
| `items[]` | ✅ | `product_id` + `quantity` (+ `variant_selections`)。最低 1 件 |
| `items[].variant_selections` | `variants !== null` の商品で必須 | `{ option_name: value }` |
| `customer_email` | ✅ | 注文確認メールの宛先。x402 経路でも必須 |
| `preferred_chain_id` | 任意 | 全 `items` の `available_chains` の積集合のいずれか |
| `shipping` | いずれかの item が `requires_shipping` のとき必須 | name / zip / prefecture / address1 / tel |
| `is_gift` / `gift_recipient` | 任意 | 贈り物のとき `is_gift: true` + `gift_recipient` |
| `checkout_options` | 任意 | ショップ定義のオプション (のし等) の選択値 |
| `customer_note` | 任意 | ショップへの伝言 (max 2000 文字) |

レスポンス (HTTP 402):

```http
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...   (base64url JSON of PaymentRequired)
Content-Type: application/json

{
  "ok": false,
  "error": { "code": "payment_required", "message": "PAYMENT-SIGNATURE header is required" },
  "data": {
    "reservation_id": "res_a1b2c3d4...",
    "expires_at_unix_ms": 1731486100000,
    "summary": {
      "subtotal_jpyc": "5000",
      "discount_jpyc": "0",
      "shipping_jpyc": "500",
      "checkout_options_surcharge_jpyc": "0",
      "total_jpyc": "5500"
    }
  }
}
```

`summary` を使って、署名前にユーザーへ正しい合計金額を提示してください。

> **注意**: `summary` の各値は文字列で、小数桁数は項目により不揃いです
> (`total_jpyc` は `"3500"`、`shipping_jpyc` は `"500.000000000000000000"` の
> ように 18 桁付きで返ることがある)。表示前に `parseFloat` / `Number` で正規化
> してください。実際に署名する金額は `summary` ではなく
> `PAYMENT-REQUIRED.accepts[0].amount` (atomic units) を使うこと。

`PAYMENT-REQUIRED` ヘッダを base64url デコードすると以下の x402 v2 `PaymentRequired`
構造体になります:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://ec.jpyc-service.com/api/v1/checkout",
    "description": "商品名 × 1",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:137",
      "amount": "1500000000000000000000",
      "asset": "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
      "payTo": "0xShopWallet...",
      "maxTimeoutSeconds": 90,
      "extra": {
        "assetTransferMethod": "eip3009",
        "name": "JPY Coin",
        "version": "1",
        "decimals": 18,
        "symbol": "JPYC"
      }
    }
  ],
  "extensions": {
    "x402.jpyc-ec.reservation_id": "res_a1b2c3d4..."
  }
}
```

> **重要 (デコード方法)**: ヘッダは `base64url` (RFC 4648 §5、`-` `_` を使う変種)
> でエンコードされています。Node なら `Buffer.from(header, "base64url")` で
> デコード可。**シェルの `base64 -d` は環境差** (macOS の BSD 版は base64url を
> サポートせず壊れます) があるので、シェル経由でデコードしたい場合は
> `tr '_-' '/+'` してパディングを補ってから `base64 -d` するか、Node/Python の
> `base64.urlsafe_b64decode` を使ってください。`SKILL-acli.md` に詳細あり。

**ユーザーに見せて確認** すべき情報:

- 合計金額: `amount` を 10^18 で割って JPYC 表示 (例: `1500000000000000000000` → 1500 JPYC)
- 支払先: `payTo` (ショップのウォレット)
- チェーン: `network` (CAIP-2)

エラー:

- `400 invalid_body` — リクエストボディが zod schema に合わない。**`quantity <= 0`、
  `customer_email` 欠落/不正、`preferred_chain_id` がその環境で使えない、等は
  すべてこの `invalid_body` で返る** (専用コードはない)。`message` に zod の
  詳細 (`path` 付き) が JSON 文字列で入るので、どのフィールドが原因かはそれを見る
- `400 shipping_required` — `requires_shipping=true` なのに `shipping` 欠落 → ユーザーに住所聞く
- `400 variant_required` / `400 invalid_variant` — variants 必須なのに `variant_selections` 欠落/不正
- `400 invalid_checkout_option` — `required:true` の checkout_options を送っていない、
  または値が定義 (select の選択肢 / text の max_length 等) に合わない → ショップの
  `checkout_options` を見て必須オプションをユーザーに聞き、再送する。
  `message` は「到着時間を選択してください」のような **ユーザー向けの日本語**
  で、オプションの `name` (表示名、`id` ではない) を含む。そのままユーザーに
  見せてよいが、どの定義が原因かをコードで特定したいときは `message` の文字列
  一致ではなく `checkout_options` の `name` と突き合わせること
- `400 shop_mismatch` — `items` に別ショップの商品が混在
- `400 no_common_chain` — `items` の `available_chains` に共通チェーンがない
- `400 x402_disabled` — ショップが x402 をオプトアウト → このショップは購入不可
- `404 product_not_found`
- `404 shop_not_found`
- `409 insufficient_stock` — 在庫不足
- `429 rate_limited` — 30 req/60s/IP の上限

### Step 3 — Sign and settle

#### 3a. EIP-712 署名

JPYC の `transferWithAuthorization` を EIP-712 で署名します。

**Domain**:

```typescript
{
  name: "JPY Coin",                // 固定。accepts[0].extra.name と一致
  version: "1",                    // 固定。accepts[0].extra.version と一致
  chainId: 137,                    // accepts[0].network の eip155: 部分
  verifyingContract: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29"  // accepts[0].asset
}
```

**Types**:

```typescript
{
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" }
  ]
}
```

**Message**:

```typescript
{
  from: <agent wallet address>,                    // 署名者
  to: <accepts[0].payTo>,                          // ショップ wallet
  value: BigInt(<accepts[0].amount>),              // atomic units
  validAfter: 0n,                                  // 即座に有効
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 90),  // now + 90s
  nonce: <32-byte random hex>                      // 0x + 64 hex
}
```

`primaryType` は `"TransferWithAuthorization"` (※ 既存の `ReceiveWithAuthorization`
ではない。x402 では facilitator が msg.sender になるため `Transfer` 系を使う)。

#### 3b. PaymentPayload 構築

x402 v2 の `PaymentPayload` を組み立てます:

```json
{
  "x402Version": 2,
  "accepted": <accepts[0] を verbatim でコピー>,
  "payload": {
    "signature": "0x<130-char hex>",  // 上の署名 (r + s + v)
    "authorization": {
      "from": "0x<agent wallet>",
      "to": "0x<accepts[0].payTo>",
      "value": "<accepts[0].amount>",
      "validAfter": "0",
      "validBefore": "<unix sec>",
      "nonce": "0x<32 bytes hex>"
    }
  }
}
```

これを **base64url エンコード** して `PAYMENT-SIGNATURE` ヘッダに乗せます。

#### 3c. Settle リクエスト

```http
POST https://ec.jpyc-service.com/api/v1/checkout
Content-Type: application/json
PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6Mi...   (base64url JSON)

{
  "reservation_id": "res_a1b2c3d4..."
}
```

> 2 回目の body は `reservation_id` だけです。`items` 等は再送しません
> (1 回目で reservation snapshot に固定済み)。

**成功レスポンス** (HTTP 200):

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLC...   (base64url JSON of SettlementResponse)
Content-Type: application/json

{
  "ok": true,
  "data": {
    "order_id": "uuid",
    "order_number": "ORD-20260514-GOSFBI",
    "tx_hash": "0x<64 hex>",
    "network": "eip155:137",
    "payer": "0x<agent wallet>",
    "amount_atomic": "1500000000000000000000",
    "is_demo": false
  }
}
```

注文は `order_status=3` (collected = 決済完了) で確定済み。on-chain transfer も完了
しているので追加の署名や確認は不要です。`tx_hash` は対応するブロックエクスプローラ
(Polygonscan / Etherscan / Snowtrace 等) でそのまま検索できます。

> **`data.is_demo`**: `true` ならデモショップの注文です。on-chain 送金は
> 行われておらず、`tx_hash` は `0xde30…` で始まるダミー値 (注文ごとにユニーク) で
> エクスプローラでは引けません。`is_demo: true` のときはユーザーに「これは
> デモ決済で、実際の JPYC 送金は行われていません」と明示してください。

エラー (status / code):

| Status | Code | 意味 | エージェントの行動 |
|--------|------|------|-------------------|
| 400 | `invalid_payment_payload` | base64 や JSON が壊れている | 再構築 |
| 400 | `payload_mismatch` | 署名内容が reservation と不一致 | step 2 からやり直し |
| 402 | `invalid_exact_evm_payload_signature` | 署名が不正 / 期限切れ | 再署名 |
| 402 | `invalid_exact_evm_payload_authorization_valid_before` | 90s 超過 | step 2 からやり直し (新しい reservation を取得) |
| 402 | `insufficient_funds` | JPYC 残高不足 | ユーザーに「残高不足です」と通知 |
| 404 | `reservation_not_found` | reservation 5 分超過 (※決済済み reservation への再送では返らない — 下記「冪等リプレイ」参照) | step 2 からやり直し |
| 404 | `product_disappeared` | 商品が削除された | 別の商品提案 |
| 409 | `insufficient_stock` | 在庫切れ | 別の商品提案 |
| 409 | `shop_wallet_changed` | ショップがウォレット変更 | step 2 からやり直し |
| 429 | `rate_limited` | 30 req/60s/IP | 数秒待ってリトライ |
| 502 | `facilitator_insufficient_native_balance` | facilitator (relayer) の gas 切れ | リトライ (運営に自動通知される。復旧まで数分かかることがある) |
| 502 | `settlement_failed` | facilitator が settle 失敗 (上記以外) | リトライ。繰り返すなら運営に問い合わせ |
| 502 | `unexpected_settle_error` | facilitator が分類不能な例外を捕捉 | リトライ。繰り返すなら運営に問い合わせ |
| 502 | `facilitator_unreachable` | 決済サービスに接続不可 (資金は動いていない) | リトライ |
| 502 | `settle_precondition_failed` | settle 前の記録に失敗 (資金は動いていない) | リトライ |
| 502 | `authorization_already_used` | **この nonce は既にオンチェーンで消費済み = 支払いは成立している** | `settlement_state_unknown` と同じ扱い: 再署名せず `GET /orders` で注文を確認 (自動復旧される) |
| 502 | `settlement_state_unknown` | **決済結果が不明 (資金が動いている可能性あり)** | **絶対に即再署名・再購入しない**。2〜3 分待って `GET /orders?customer_address=...` を確認。注文があれば決済成功 (自動復旧)。無ければ安全に再試行できる |

> **冪等リプレイ (2026-07 追加)**: 同じ `reservation_id` + `PAYMENT-SIGNATURE` で
> settle を再送した場合、既に決済済みなら同じ注文情報が 200 で返る。
> トランスポートエラー (接続断・タイムアウト) 後のリトライは安全。
> `settlement_state_unknown` を受けた場合のみ、上記の手順で状態確認を挟むこと。

---

## Other Useful Endpoints

### Shop / product discovery

| Endpoint | 用途 |
|---------|------|
| `GET /api/v1/shops` | 全ショップ一覧 |
| `GET /api/v1/shops/{slug}/products` | ショップ内の商品一覧 |
| `GET /api/v1/shops/{slug}/nft-discounts` | NFT 割引ルール (購入時に該当 NFT 所持で割引) |
| `GET /api/v1/products/{id}` | 商品詳細 (step 1) |
| `GET /api/v1/products/{id}/reviews` | 商品レビュー一覧 |
| `GET /api/v1/categories` | カテゴリ・タグの一覧 |

> **`product.slug` について**: 商品レスポンスの `slug` は人間可読な商品URL用の
> 値です (商品ページURL = `/shops/{shop.slug}/products/{slug ?? id}`、`null` の
> 場合は `id` を使う)。**チェックアウトの `items[].product_id` には必ず商品の
> `id` (UUID) を使ってください** — `slug` は URL 表示専用で、API リクエストの
> 識別子としては使いません。

### Agent discovery surface

REST API を直接叩く以外に、プラットフォームはエージェント向けの発見・
対話レイヤーを公開している。

| Endpoint | 用途 |
|---------|------|
| `GET /.well-known/commerce-manifest` | プラットフォームの能力・エンドポイント・x402 決済レール一覧 (Open Agentic Commerce 形式) |
| `GET /.well-known/agent-card.json` | A2A Agent Card |
| `GET /api/v1/openapi.yaml` | OpenAPI 3.1 仕様 |
| `GET /llms.txt` | LLM 向け Markdown インデックス |
| `POST /mcp` | MCP サーバー (Streamable HTTP)。商品検索・購入ツールを提供 |

MCP ホスト (Claude Desktop / Cursor 等) からは `POST /mcp` に接続すると、
`search_products` / `get_product` / `quote_checkout` / `submit_payment`
などのツールが使える。本スキルの REST 手順は、MCP を使わず HTTP を直接
叩くエージェント向け。

### Order tracking

```http
GET https://ec.jpyc-service.com/api/v1/orders?customer_address=0x...
```

レスポンス: `orders[]` (注文履歴、x402 経由も既存経路の注文も両方返る)。

`order_status` の意味:

- `3` — **決済完了** (`/api/v1/checkout` 経由の注文は最初からこの状態)
- `9` — 期限切れ
- `1` / `2` — 旧フロー (未署名 / 署名済み回収待ち) の名残。新規注文では発生しない

各注文には `refunds[]` フィールドが付き、ショップが過去に行った返金履歴
(完了したものだけ) が時系列で並ぶ。1 注文に対して複数回の部分返金がある
ケースを含む。各 refund は `{ amount_jpyc, tx_hash, chain_id, completed_at }`
の形。pending/failed の内部状態は外部に出さない。実際の受領金額を計算する
場合は `total_jpyc - sum(refunds[].amount_jpyc)` をすると良い。

**発送状況** — `order_status` (決済) とは独立して、物理商品の発送状況が
次のフィールドで返る:

- `shipping_status` — `null` (配送不要 or 発送準備前) / `"pending"` (発送準備中) /
  `"shipped"` (発送済み) / `"delivered"` (配送完了)
- `shipped_at` — 発送日時 (ISO8601, nullable)
- `tracking_number` — 追跡番号 (nullable)
- `shipping_carrier` — 配送業者名 (nullable)

決済完了 (`order_status: 3`) でも `shipping_status` が `null`/`pending` の
うちはまだ発送されていない。ユーザーに「発送済みか」を答えるときは
`order_status` ではなく `shipping_status` を見ること。デジタル商品や配送先の
ない注文では `shipping_status` は常に `null`。

### Digital product download

商品が `is_digital: true` のデジタル商品 (ダウンロード商品) の場合、決済完了
(`order_status: 3`) 後にダウンロード URL を発行できる。

**本人確認は SIWE (Sign-In with Ethereum) 署名チャレンジ**。ウォレットアドレス
は公開情報のため、自己申告アドレスでは本人確認にならない。購入ウォレットの
秘密鍵で署名できることを証明する必要がある (署名のみ・送金は発生しない)。

手順:

1. nonce を取得 (5 分有効・使い捨て):

```http
POST https://ec.jpyc-service.com/api/auth/siwe/nonce
Content-Type: application/json

{ "address": "0x<購入ウォレット>" }
```

レスポンス: `{ "nonce": "<hex>" }`

2. SIWE メッセージ (EIP-4361) を組み立てて `personal_sign` で署名する。
   `domain` / `uri` は EC のもの、`nonce` は手順 1 の値を使うこと
   (サーバが domain と nonce を検証する):

```
domain:    ec.jpyc-service.com
address:   0x<購入ウォレット>
statement: Sign to download your purchased file. No token transfer will occur.
uri:       https://ec.jpyc-service.com
version:   1
chainId:   <購入時の chain_id>
nonce:     <手順 1 の nonce>
issuedAt:  <現在時刻 ISO8601>
```

(siwe ライブラリなら `new SiweMessage({...}).prepareMessage()` の出力を署名)

3. ダウンロード URL を発行:

```http
POST https://ec.jpyc-service.com/api/v1/orders/{order_number}/download
Content-Type: application/json

{ "message": "<SIWE メッセージ全文>", "signature": "0x<署名>", "product_id": "..." }
```

レスポンス `data`: `{ url, file_name, version, expires_in_seconds }`。
署名者アドレスが注文の購入ウォレットと一致し、その注文に該当商品が含まれる
場合のみ発行される。

ファイルには 2 種類ある:

- **アップロード型**: `url` は短命な署名付き URL。`expires_in_seconds` 秒
  (既定 300) で失効するため取得後すぐにダウンロードすること。
- **外部URL型**: `url` はショップが登録した外部 URL。有効期限がないため
  `expires_in_seconds` は `null`。

常に最新版ファイルが返るため、ショップがファイルを差し替えても同じ手順で
最新版を取得できる (`version` で確認可能)。エラーは
`MISSING_SIGNATURE`・`INVALID_MESSAGE` (400) / `UNAUTHORIZED` (401: nonce
期限切れ・署名不正) / `ORDER_NOT_FOUND` (404) / `FORBIDDEN`・`NOT_PURCHASED`
(403) / `NO_FILE` (404) / `RATE_LIMITED` (429)。

### Balance check (optional)

署名前に残高を事前確認したいとき:

```http
POST https://ec.jpyc-service.com/api/v1/balance/check
Content-Type: application/json

{
  "address": "0x<agent wallet>",
  "required_amount": "1500",
  "chain_id": 137
}
```

レスポンス:
```json
{
  "ok": true,
  "data": {
    "address": "0x<agent>",
    "sufficient": true,
    "balance": "1234.567",
    "required": "1500",
    "chain_id": 137
  }
}
```

実用上は **x402 step 2 の中で facilitator が残高を確認する** ため、事前 check は
省略可能。step 3 で `insufficient_funds` が返れば残高不足と分かります。

---

## Sample Code (TypeScript / viem)

完全な実装例。`BUYER_PRIVATE_KEY` で署名するエージェント想定。

```typescript
import { privateKeyToAccount } from "viem/accounts"
import { keccak256, parseUnits, formatUnits } from "viem"
import { randomBytes } from "node:crypto"

const BASE = "https://ec.jpyc-service.com"
const account = privateKeyToAccount(process.env.BUYER_PRIVATE_KEY as `0x${string}`)

async function purchaseCart(shopId: string, productId: string, quantity = 1) {
  // Step 1: product info
  const productRes = await fetch(`${BASE}/api/v1/products/${productId}`)
  const { data: { product } } = await productRes.json()

  // Step 1.5: collect shipping if required (replace with your agent's UX layer)
  let shipping: any = undefined
  if (product.requires_shipping) {
    shipping = await askUserForShipping()  // your UX
  }
  let variantSelections: any = undefined
  if (product.variants) {
    variantSelections = await askUserForVariant(product.variants)  // your UX
  }

  // Step 2: 402 challenge (POST /api/v1/checkout — cart-level)
  const challengeRes = await fetch(`${BASE}/api/v1/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shop_id: shopId,
      items: [{ product_id: productId, quantity, variant_selections: variantSelections }],
      customer_email: "buyer@example.com",  // required
      shipping,
    }),
  })
  if (challengeRes.status !== 402) {
    throw new Error(`expected 402, got ${challengeRes.status}: ${await challengeRes.text()}`)
  }
  const requiredHeader = challengeRes.headers.get("PAYMENT-REQUIRED")!
  // Node の Buffer は "base64url" を直接サポート (RFC 4648 §5)。"base64" を
  // 指定すると `-` `_` の置換が無く JSON が壊れることがあるので必ず "base64url"
  // を使うこと。
  const required = JSON.parse(Buffer.from(requiredHeader, "base64url").toString())
  const accepts = required.accepts[0]
  const { reservation_id } = (await challengeRes.json()).data

  // Confirm with user before signing (recommended)
  const totalJpyc = formatUnits(BigInt(accepts.amount), 18)
  await confirmWithUser(`Pay ${totalJpyc} JPYC to ${accepts.payTo}?`)  // your UX

  // Step 3a: sign EIP-712
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + accepts.maxTimeoutSeconds)
  const nonce = ("0x" + randomBytes(32).toString("hex")) as `0x${string}`
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
      validAfter: 0n,
      validBefore,
      nonce,
    },
  })

  // Step 3b: build PaymentPayload
  const payload = {
    x402Version: 2,
    accepted: accepts,
    payload: {
      signature,
      authorization: {
        from: account.address,
        to: accepts.payTo,
        value: accepts.amount,
        validAfter: "0",
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  }
  const sigHeader = Buffer.from(JSON.stringify(payload)).toString("base64url")

  // Step 3c: settle
  const settleRes = await fetch(`${BASE}/api/v1/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-SIGNATURE": sigHeader,
    },
    body: JSON.stringify({ reservation_id }),
  })
  if (settleRes.status !== 200) {
    const err = await settleRes.json()
    throw new Error(`settle failed: ${err.error.code} ${err.error.message}`)
  }
  const result = await settleRes.json()
  return result.data  // { order_id, order_number, tx_hash, network, payer, amount_atomic }
}
```

---

## Notes

- **Reservation lifetime**: 5 分。`maxTimeoutSeconds` (デフォルト 90 秒) より長く取って
  あるので、エージェントがユーザー確認しても余裕がある
- **EIP-3009 nonce**: クライアント側で 32-byte ランダム生成。サーバ側生成は不要
- **Stock**: step 2 で仮押さえ → step 3 成功で確定。途中で失敗すると 5 分後に自動解放
- **多商品カート**: `POST /api/v1/checkout` は `items[]` で複数商品をまとめて
  購入できる。1 商品でも複数でも同じエンドポイント・同じ 1 回の署名で完結する
- **Discount / NFT 割引**: `/api/v1/checkout` は `discount` ブロックを受け付ける
  が、対象 NFT の保有確認と割引額の算出は呼び出し側の責務。本スキルの purchase
  ツールは現状 NFT 割引を自動適用しない
- **贈り物 / のし等のオプション**: `is_gift` / `gift_recipient` / `checkout_options`
  を `/api/v1/checkout` の body に渡せる
- **廃止済みの旧 endpoint**: `POST /api/v1/products/:id/checkout` と
  `POST /api/v1/orders` 系は廃止済み。購入は `POST /api/v1/checkout`
  （人間の買い物客と AI エージェント共通の単一エンドポイント）に一本化
  されている
- **送料**: `requires_shipping=true` の商品は **送料込みの amount** が `accepts[0].amount`
  に入って返る。エージェント側で別途送料計算は不要 (PaymentRequired を信頼すれば OK)
- **エラーコード `errorReason`**: x402 v2 spec で定義された code をそのまま返す
  (`insufficient_funds`, `invalid_exact_evm_payload_signature` 等)。詳細は
  [coinbase/x402 仕様 §9](https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md) 参照
