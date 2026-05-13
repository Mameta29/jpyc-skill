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
1. GET  /api/v1/products/{id}                ← requires_shipping / variants 確認
2. POST /api/v1/products/{id}/checkout       ← 402 + reservation_id
       (no PAYMENT-SIGNATURE)
3. EIP-712 sign + build PaymentPayload
4. POST /api/v1/products/{id}/checkout       ← 200 + 注文成立
       (with PAYMENT-SIGNATURE)
```

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
- `data.product.variants` (object | null) — 非 null ならバリエーション選択必須
- `data.shop.available_chains` (number[]) — 払えるチェーン ID
- `data.shop.default_chain_id` — チェーン指定省略時のデフォルト

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
    "quantity": 1,
    "preferred_chain_id": 137,
    "variant_selections": { "サイズ": "M" },
    "shipping": {
      "name": "山田太郎",
      "zip": "150-0001",
      "prefecture": "東京都",
      "address1": "渋谷区神宮前1-2-3",
      "tel": "090-1234-5678"
    }
  }' \
  https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID}/checkout
```

成功時 (HTTP 402):

```
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6Mi...
Content-Type: application/json

{
  "ok": false,
  "error": { "code": "payment_required", "message": "PAYMENT-SIGNATURE header is required" },
  "data": { "reservation_id": "res_a1b2...", "expires_at_unix_ms": 1731486100000 }
}
```

`PAYMENT-REQUIRED` ヘッダを取り出してデコード:

```bash
# レスポンスヘッダから抽出
PAYMENT_REQUIRED_B64=$(curl -isS ... | awk -F': ' '/^PAYMENT-REQUIRED:/{print $2}' | tr -d '\r')
echo "$PAYMENT_REQUIRED_B64" | base64 -d | jq .
```

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
| `quantity` | ✅ | int > 0 |
| `preferred_chain_id` | 任意 | `shop.available_chains` 内のいずれか |
| `variant_selections` | `variants !== null` のとき必須 | `{ option_name: value }` |
| `shipping` | `requires_shipping === true` のとき必須 | name / zip / prefecture / address1 / tel が必須 |
| `customer_note` | 任意 | max 2000 文字 |

エラーコード:

- `400 invalid_body` / `400 invalid_quantity`
- `400 shipping_required` ← 住所聞いてリトライ
- `400 variant_required` / `400 invalid_variant`
- `400 x402_disabled` ← このショップは x402 未対応
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

ACCEPTS_JSON=$(echo "$PAYMENT_REQUIRED_B64" | base64 -d | jq -c '.accepts[0]')
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
  https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID}/checkout
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
    "amount_atomic": "1500000000000000000000"
  }
}
```

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
| 502 | `settlement_failed` / `facilitator_insufficient_native_balance` | リトライ |

---

## Other endpoints (acli)

### Shop / product 一覧

```bash
curl -sS https://ec.jpyc-service.com/api/v1/shops | jq .
curl -sS https://ec.jpyc-service.com/api/v1/shops/{SLUG}/products | jq .
curl -sS https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID}/reviews | jq .
curl -sS https://ec.jpyc-service.com/api/v1/categories | jq .
```

### 注文履歴

```bash
curl -sS "https://ec.jpyc-service.com/api/v1/orders?customer_address=0x..." | jq .
```

`order_status` の意味: 1=未署名 (レガシー経路のみ), 2=署名済み (レガシー経路のみ), 3=決済完了 (**x402 はここから開始**), 9=期限切れ。

### NFT 割引ルール

```bash
curl -sS https://ec.jpyc-service.com/api/v1/shops/{SLUG}/nft-discounts | jq .
```

x402 経路は現在 NFT 割引未対応。NFT 割引を活用したい購入は既存レガシー経路を使う。

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
| Production | `https://ec.jpyc-service.com` | 1 / 137 / 43114 |
| Staging | `https://stg-ec.jpyc-service.com` | 11155111 / 80002 / 43113 / 1001 / 5042002 |

メインネット ID をステージングに送ると `INVALID_CHAIN` エラー。

---

## Sanity-check snippet

step 2 が正しく動いているかの最小確認:

```bash
curl -isS -X POST \
  -H "Content-Type: application/json" \
  -d '{"quantity":1}' \
  https://ec.jpyc-service.com/api/v1/products/{PRODUCT_ID}/checkout \
  | head -20
```

`requires_shipping=false` の商品なら `HTTP/1.1 402` と `PAYMENT-REQUIRED:` ヘッダが
返れば OK。`requires_shipping=true` の商品では `400 shipping_required` が返ります。
