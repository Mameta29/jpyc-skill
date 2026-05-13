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
- **マルチチェーン**: Ethereum / Polygon / Avalanche / Sepolia / Amoy / Fuji /
  Kairos / Arc に対応
- **AI 向け設計**: 認証なし、ウォレットアドレス + 署名 = identity

---

## Prerequisites

- JPYC 残高のあるウォレットの**秘密鍵** (EIP-712 署名用)
- `viem` または同等の EIP-712 署名ライブラリ

---

## Environments

| 環境 | Base URL | 対応チェーン ID |
|------|---------|-----------------|
| Production | `https://ec.jpyc-service.com` | 1 (Ethereum), 137 (Polygon), 43114 (Avalanche) |
| Staging | `https://stg-ec.jpyc-service.com` | 11155111 (Sepolia), 80002 (Amoy), 43113 (Fuji), 1001 (Kairos), 5042002 (Arc) |

メインネット ID をステージングに、テストネット ID を本番に送ると `INVALID_CHAIN`
エラーになります。

---

## Purchase Flow (x402)

エージェントは以下の 3 ステップで完走します。

```
1. GET  /api/v1/products/{productId}         ← 商品情報 + 配送/オプション要件確認
2. POST /api/v1/products/{productId}/checkout (no PAYMENT-SIGNATURE)
                                              ← 402 challenge + reservation_id
3. POST /api/v1/products/{productId}/checkout (with PAYMENT-SIGNATURE)
                                              ← 200 + 注文成立 + tx_hash
```

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
      "name": "商品名",
      "description": "...",
      "price_jpyc": "1500.000000000000000000",
      "stock": 42,
      "image_urls": ["https://..."],
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
      "default_chain_id": 137
    }
  }
}
```

**判定**:

| フィールド | true / 非 null のとき | エージェントの行動 |
|-----------|---------------------|-------------------|
| `requires_shipping === true` | 配送先住所が必須 | ユーザーに **氏名・郵便番号・都道府県・市区町村以降の住所・電話番号** を聞く (email は任意) |
| `variants !== null` | バリエーション選択が必須 | ユーザーに **どの組み合わせ** を選ぶか聞く (例: `{ "サイズ": "M", "色": "白" }`) |
| `available_chains` | このチェーン以外は払えない | ユーザーに preference があれば pass、なければサーバが先頭を使う |

エラー:

- `404 PRODUCT_NOT_FOUND` — 商品が存在しないか非公開
- `500 INTERNAL_ERROR` — サーバエラー

### Step 2 — Request 402 challenge

`PAYMENT-SIGNATURE` ヘッダ **なし** で POST。サーバは在庫を 5 分間仮押さえし、
402 + `PAYMENT-REQUIRED` ヘッダを返します。

```http
POST https://ec.jpyc-service.com/api/v1/products/{productId}/checkout
Content-Type: application/json

{
  "quantity": 1,
  "preferred_chain_id": 137,
  "variant_selections": { "サイズ": "M" },
  "shipping": {
    "name": "山田太郎",
    "email": "yamada@example.com",
    "zip": "150-0001",
    "prefecture": "東京都",
    "address1": "渋谷区神宮前1-2-3",
    "address2": "サンプルマンション101",
    "tel": "090-1234-5678"
  },
  "customer_note": "プレゼント用に包装してください"
}
```

**フィールド**:

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `quantity` | ✅ | 正の整数 |
| `preferred_chain_id` | 任意 | `product.shop.available_chains` のいずれか。省略時は `default_chain_id` |
| `variant_selections` | `variants !== null` のとき必須 | `{ option_name: value }` |
| `shipping` | `requires_shipping === true` のとき必須 | name / zip / prefecture / address1 / tel が必須サブフィールド |
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
    "expires_at_unix_ms": 1731486100000
  }
}
```

`PAYMENT-REQUIRED` ヘッダを base64url デコードすると以下の x402 v2 `PaymentRequired`
構造体になります:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": { "url": "...", "description": "商品名 × 1", "mimeType": "application/json" },
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
  ]
}
```

**ユーザーに見せて確認** すべき情報:

- 合計金額: `amount` を 10^18 で割って JPYC 表示 (例: `1500000000000000000000` → 1500 JPYC)
- 支払先: `payTo` (ショップのウォレット)
- チェーン: `network` (CAIP-2)

エラー:

- `400 invalid_body` — リクエストボディが zod schema に合わない
- `400 invalid_quantity` — `quantity <= 0`
- `400 shipping_required` — `requires_shipping=true` なのに `shipping` 欠落 → ユーザーに住所聞く
- `400 variant_required` / `400 invalid_variant` — variants 必須なのに `variant_selections` 欠落/不正
- `400 no_chains_configured` — 商品の `available_chains` が空
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
POST https://ec.jpyc-service.com/api/v1/products/{productId}/checkout
Content-Type: application/json
PAYMENT-SIGNATURE: eyJ4NDAyVmVyc2lvbiI6Mi...   (base64url JSON)

{
  "reservation_id": "res_a1b2c3d4..."
}
```

**成功レスポンス** (HTTP 200):

```http
HTTP/1.1 200 OK
PAYMENT-RESPONSE: eyJzdWNjZXNzIjp0cnVlLC...   (base64url JSON of SettlementResponse)
Content-Type: application/json

{
  "ok": true,
  "data": {
    "order_id": "uuid",
    "order_number": "ORD-2026-...",
    "tx_hash": "0x<64 hex>",
    "network": "eip155:137",
    "payer": "0x<agent wallet>",
    "amount_atomic": "1500000000000000000000"
  }
}
```

注文は `order_status=3` (collected = 決済完了) で確定済み。on-chain transfer も完了
しているので追加の署名や確認は不要です。

エラー (status / code):

| Status | Code | 意味 | エージェントの行動 |
|--------|------|------|-------------------|
| 400 | `invalid_payment_payload` | base64 や JSON が壊れている | 再構築 |
| 400 | `payload_mismatch` | 署名内容が reservation と不一致 | step 2 からやり直し |
| 402 | `invalid_exact_evm_payload_signature` | 署名が不正 / 期限切れ | 再署名 |
| 402 | `invalid_exact_evm_payload_authorization_valid_before` | 90s 超過 | step 2 からやり直し (新しい reservation を取得) |
| 402 | `insufficient_funds` | JPYC 残高不足 | ユーザーに「残高不足です」と通知 |
| 404 | `reservation_not_found` | reservation 5 分超過 | step 2 からやり直し |
| 404 | `product_disappeared` | 商品が削除された | 別の商品提案 |
| 409 | `insufficient_stock` | 在庫切れ | 別の商品提案 |
| 409 | `shop_wallet_changed` | ショップがウォレット変更 | step 2 からやり直し |
| 429 | `rate_limited` | 30 req/60s/IP | 数秒待ってリトライ |
| 502 | `settlement_failed` | facilitator が settle 失敗 | リトライ (relayer 残高不足など一時的なことが多い) |
| 502 | `facilitator_insufficient_native_balance` | facilitator の gas 切れ | リトライ (運営に通知される) |

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

### Order tracking

```http
GET https://ec.jpyc-service.com/api/v1/orders?customer_address=0x...
```

レスポンス: `orders[]` (注文履歴、x402 経由も既存経路の注文も両方返る)。

`order_status` の意味:

- `1` — 未署名 (`x402` 経路では発生しない。レガシー経路のみ)
- `2` — 署名済み・回収待ち (`x402` 経路では発生しない)
- `3` — **決済完了** (`x402` 経路は最初からこの状態)
- `9` — 期限切れ (`x402` 経路では発生しない)

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

レスポンス: `{ ok: true, data: { sufficient: boolean, balance: "...", required: "1500" } }`

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

async function purchaseProduct(productId: string, quantity = 1) {
  // Step 1: product info
  const productRes = await fetch(`${BASE}/api/v1/products/${productId}`)
  const { data: { product, shop } } = await productRes.json()

  // Step 1.5: collect shipping if required (replace with your agent's UX layer)
  let shipping: any = undefined
  if (product.requires_shipping) {
    shipping = await askUserForShipping()  // your UX
  }
  let variantSelections: any = undefined
  if (product.variants) {
    variantSelections = await askUserForVariant(product.variants)  // your UX
  }

  // Step 2: 402 challenge
  const challengeRes = await fetch(`${BASE}/api/v1/products/${productId}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quantity,
      preferred_chain_id: shop.default_chain_id,
      variant_selections: variantSelections,
      shipping,
    }),
  })
  if (challengeRes.status !== 402) {
    throw new Error(`expected 402, got ${challengeRes.status}: ${await challengeRes.text()}`)
  }
  const requiredHeader = challengeRes.headers.get("PAYMENT-REQUIRED")!
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
  const settleRes = await fetch(`${BASE}/api/v1/products/${productId}/checkout`, {
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
- **Discount / NFT**: x402 経路では現在対象外 (将来対応)。NFT 割引が必要な購入は
  既存レガシー経路 (`POST /api/v1/orders`) を使う
- **多商品カート**: x402 経路は 1 リクエスト = 1 商品。複数商品をまとめて買いたい場合は
  各商品を順に `purchase_product` する
