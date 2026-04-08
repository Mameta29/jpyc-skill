---
name: jpyc-ec-purchase
description: Purchase products from JPYC EC Platform shops using JPYC stablecoin with gasless EIP-3009 payments
---

# JPYC EC Purchase Skill

AIエージェントが **JPYC EC Platform** のショップから商品を購入するためのスキルです。

JPYC（日本円ステーブルコイン、1 JPYC = 1 JPY）を使ったガスレス決済で、お客様（エージェント）側のガス代はゼロです。

---

## Overview

- **Platform**: JPYC EC Platform（https://ec.jpyc-service.com）
- **Payment**: JPYC（ERC-20 stablecoin, 18 decimals）
- **Method**: EIP-3009 `receiveWithAuthorization`（ガスレス署名）
- **Gas cost for buyer**: **Zero** (signature only, no on-chain transaction)
- **Authentication**: None required. Wallet address + signature = identity.

## Prerequisites

- An Ethereum-compatible wallet with a **private key** (for EIP-712 signing)
- **JPYC balance** on a supported chain
- `viem` or equivalent library capable of `signTypedData` (EIP-712)

## Supported Chains

Each environment only accepts chain IDs for its own network type. Using a testnet chain ID on Production (or mainnet on Staging) will return `INVALID_CHAIN` error.

### Production (`https://ec.jpyc-service.com`)

| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Ethereum | 1 | ETH |
| Polygon | 137 | POL |
| Avalanche | 43114 | AVAX |

### Staging (`https://stg-ec.jpyc-service.com`)

| Chain | Chain ID | Native Token |
|-------|----------|--------------|
| Sepolia | 11155111 | ETH |
| Polygon Amoy | 80002 | POL |
| Avalanche Fuji | 43113 | AVAX |

**JPYC Contract Address** (same on all chains, both mainnet and testnet):
```
0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
```

Additionally, each shop has its own `available_chains` array. The `chain_id` used in an order must be included in the shop's `available_chains`.

## API Base URL

- **Production**: `https://ec.jpyc-service.com/api/v1` — mainnet chains only
- **Staging**: `https://stg-ec.jpyc-service.com/api/v1` — testnet chains only

All responses follow this format:
```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

---

## Complete Purchase Flow

### Step 1: Browse Shops

```
GET /api/v1/shops
```

Response:
```json
{
  "ok": true,
  "data": {
    "shops": [
      {
        "id": "uuid",
        "slug": "shop-slug",
        "name": "Shop Name",
        "description": "Shop description",
        "logo_url": "https://...",
        "available_chains": [137, 43114],
        "default_chain_id": 137,
        "free_shipping_threshold": "5000"
      }
    ]
  }
}
```

### Step 2: Browse Products

```
GET /api/v1/shops/{slug}/products
```

Response:
```json
{
  "ok": true,
  "data": {
    "shop": {
      "id": "uuid",
      "slug": "shop-slug",
      "name": "Shop Name",
      "wallet_address": "0x...",
      "available_chains": [137, 43114],
      "default_chain_id": 137
    },
    "products": [
      {
        "id": "uuid",
        "name": "Product Name",
        "description": "...",
        "price_jpyc": "1500.000000000000000000",
        "stock": 10,
        "image_urls": ["https://..."],
        "requires_shipping": true,
        "grants_free_shipping": false
      }
    ]
  }
}
```

**Important**: `price_jpyc` is a string with 18 decimal places (DECIMAL type). Use the integer part for display (e.g., "1500.000000000000000000" → 1500 JPYC).

### Step 3: Get Product Details (optional)

```
GET /api/v1/products/{product_id}
```

Returns product details with shop info including `shop.wallet_address`.

### Step 4: Calculate Shipping Fee (if product requires shipping)

```
POST /api/v1/shipping/fee
Content-Type: application/json

{
  "shop_id": "uuid",
  "prefecture": "東京都",
  "items": [
    { "product_id": "uuid", "quantity": 1 }
  ],
  "city": "渋谷区"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "shipping_fee": "800",
    "reason": "standard_rate"
  }
}
```

`reason` values: `"standard_rate"`, `"free_shipping_product"`, `"threshold_met"`, `"local_delivery"`, `"no_shipping_items"`, `"no_rate_configured"`

If `reason` is `"no_rate_configured"`, that prefecture is not available for shipping.

### Step 5: Check JPYC Balance

```
POST /api/v1/balance/check
Content-Type: application/json

{
  "address": "0xYourWalletAddress",
  "required_amount": "2300",
  "chain_id": 137
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "sufficient": true,
    "balance": "5000.0",
    "required": "2300"
  }
}
```

**CRITICAL**: Always check balance BEFORE creating an order. If `sufficient` is `false`, do not proceed.

### Step 6: Create Order

```
POST /api/v1/orders
Content-Type: application/json

{
  "shop_id": "uuid",
  "customer_address": "0xYourWalletAddress",
  "customer_name": "Agent Name",
  "customer_email": "user@example.com",
  "chain_id": 137,
  "items": [
    { "product_id": "uuid", "quantity": 1 }
  ],
  "shipping_prefecture": "東京都",
  "shipping_address1": "渋谷区神南1-2-3",
  "shipping_address2": "ABCビル 101",
  "shipping_zip": "150-0041",
  "shipping_tel": "03-1234-5678"
}
```

**Shipping fields** are required only if ANY product has `requires_shipping: true`. For digital products, omit them.

**Optional field**: `customer_note` (max 2000 chars) for special instructions.

Response:
```json
{
  "ok": true,
  "data": {
    "order": {
      "id": "uuid",
      "order_number": "ORD-XXXXXX",
      "nonce": "0xabc123...def456",
      "valid_after": "0",
      "valid_before": "1712345678",
      "subtotal_jpyc": "1500.000000000000000000",
      "shipping_jpyc": "800.000000000000000000",
      "total_jpyc": "2300.000000000000000000",
      "chain_id": 137,
      "order_status": 1,
      "created_at": "2026-04-08T..."
    },
    "shop_wallet_address": "0xShopWallet...",
    "items": [
      { "product_name": "Product", "price_jpyc": "1500.000000000000000000", "quantity": 1 }
    ]
  }
}
```

### Step 7: Sign EIP-712 Message

Using the order response data, construct and sign the EIP-712 typed data:

```typescript
import { parseUnits } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const JPYC_CONTRACT = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29"

// From order creation response:
const order = response.data.order
const shopWallet = response.data.shop_wallet_address

const account = privateKeyToAccount("0xYOUR_PRIVATE_KEY")

const signature = await account.signTypedData({
  domain: {
    name: "JPY Coin",
    version: "1",
    chainId: BigInt(order.chain_id),
    verifyingContract: JPYC_CONTRACT,
  },
  types: {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "ReceiveWithAuthorization",
  message: {
    from: account.address,
    to: shopWallet,
    value: parseUnits(order.total_jpyc.split(".")[0], 18),
    validAfter: BigInt(order.valid_after),
    validBefore: BigInt(order.valid_before),
    nonce: order.nonce,
  },
})
```

**Critical details**:
- `domain.name` MUST be `"JPY Coin"` (exact match)
- `domain.version` MUST be `"1"`
- `domain.verifyingContract` MUST be `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`
- `message.from` MUST be the signing wallet address (same as `customer_address` in order)
- `message.to` MUST be the shop wallet address from the order response
- `message.value` is the total amount in wei (18 decimals)
- `message.nonce` is the random nonce from the order response
- The signature MUST be from the same address as `customer_address`

### Step 8: Submit Signature

```
POST /api/v1/orders/{order_id}/signature
Content-Type: application/json

{
  "signature": "0x...(130 hex chars)",
  "customer_address": "0xYourWalletAddress"
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "order_id": "uuid",
    "order_number": "ORD-XXXXXX",
    "order_status": 2,
    "signed_at": "2026-04-08T..."
  }
}
```

After this step, the shop owner will collect the signature and execute the on-chain payment. The buyer's payment is complete from their perspective.

### Step 9: Track Orders (optional)

```
GET /api/v1/orders?customer_address=0xYourWalletAddress
```

Response:
```json
{
  "ok": true,
  "data": {
    "orders": [
      {
        "id": "uuid",
        "order_number": "ORD-XXXXXX",
        "total_jpyc": "2300.000000000000000000",
        "order_status": 2,
        "tx_hash": null,
        "items": [{ "product_name": "Product", "price_jpyc": "1500.000000000000000000", "quantity": 1 }]
      }
    ]
  }
}
```

**Order status values**:
| Status | Meaning |
|--------|---------|
| 1 | Created (awaiting signature) |
| 2 | Signed (awaiting shop collection) |
| 3 | Collected (payment complete, on-chain verified) |
| 9 | Expired or cancelled |

---

## Handling Shipping Address

If a product requires shipping (`requires_shipping: true`), the agent must provide:
- `shipping_prefecture`: Japanese prefecture (e.g., "東京都", "大阪府")
- `shipping_address1`: City and street address
- `shipping_zip`: Postal code
- `shipping_tel`: Phone number

**If the agent does not know the user's shipping address**, it should ask the user to provide it before creating the order.

For digital products (`requires_shipping: false`), shipping fields are not needed.

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `INVALID_ADDRESS` | 400 | Malformed Ethereum address |
| `INVALID_AMOUNT` | 400 | Invalid amount value |
| `INVALID_CHAIN` | 400 | Unsupported chain ID |
| `INVALID_SIGNATURE` | 400 | Malformed signature |
| `INVALID_STATUS` | 400 | Order is not in expected status |
| `ADDRESS_MISMATCH` | 400 | Customer address doesn't match order |
| `SIGNATURE_EXPIRED` | 400 | Order signature period expired |
| `SHOP_NOT_FOUND` | 404 | Shop not found |
| `PRODUCT_NOT_FOUND` | 404 | Product not found |
| `ORDER_NOT_FOUND` | 404 | Order not found |
| `INSUFFICIENT_STOCK` | 400 | Not enough stock |
| `RATE_LIMITED` | 429 | Too many requests |
| `BALANCE_CHECK_FAILED` | 500 | Failed to check on-chain balance |
| `ORDER_CREATION_FAILED` | 500 | Failed to create order |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Complete Example (TypeScript + viem)

```typescript
import { parseUnits } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const API_BASE = "https://ec.jpyc-service.com/api/v1"
const JPYC_CONTRACT = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29"

async function purchaseFromJpycEc(
  privateKey: `0x${string}`,
  shopSlug: string,
  productId: string,
  quantity: number,
  chainId: number,
  shipping?: {
    prefecture: string
    address1: string
    address2?: string
    zip: string
    tel: string
    name: string
    email: string
  }
) {
  const account = privateKeyToAccount(privateKey)

  // 1. Get shop and product info
  const shopRes = await fetch(`${API_BASE}/shops/${shopSlug}/products`).then(r => r.json())
  if (!shopRes.ok) throw new Error(shopRes.error.message)

  const product = shopRes.data.products.find((p: any) => p.id === productId)
  if (!product) throw new Error("Product not found")
  if (product.stock < quantity) throw new Error("Insufficient stock")

  // 2. Calculate total (for balance check)
  const priceInt = Math.floor(parseFloat(product.price_jpyc))
  let total = priceInt * quantity

  // 3. Calculate shipping if needed
  if (product.requires_shipping && shipping) {
    const shippingRes = await fetch(`${API_BASE}/shipping/fee`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_id: shopRes.data.shop.id,
        prefecture: shipping.prefecture,
        items: [{ product_id: productId, quantity }],
        city: shipping.address1.split(/[市区町村]/)[0] + (shipping.address1.match(/[市区町村]/)?.[0] || ""),
      }),
    }).then(r => r.json())
    if (shippingRes.ok) {
      total += parseFloat(shippingRes.data.shipping_fee)
    }
  }

  // 4. Check balance
  const balanceRes = await fetch(`${API_BASE}/balance/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      required_amount: String(total),
      chain_id: chainId,
    }),
  }).then(r => r.json())

  if (!balanceRes.ok || !balanceRes.data.sufficient) {
    throw new Error(`Insufficient JPYC balance. Have: ${balanceRes.data?.balance}, Need: ${total}`)
  }

  // 5. Create order
  const orderBody: Record<string, any> = {
    shop_id: shopRes.data.shop.id,
    customer_address: account.address,
    chain_id: chainId,
    items: [{ product_id: productId, quantity }],
  }
  if (shipping) {
    orderBody.customer_name = shipping.name
    orderBody.customer_email = shipping.email
    orderBody.shipping_prefecture = shipping.prefecture
    orderBody.shipping_address1 = shipping.address1
    orderBody.shipping_address2 = shipping.address2
    orderBody.shipping_zip = shipping.zip
    orderBody.shipping_tel = shipping.tel
  }

  const orderRes = await fetch(`${API_BASE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody),
  }).then(r => r.json())

  if (!orderRes.ok) throw new Error(orderRes.error.message)

  const order = orderRes.data.order
  const shopWallet = orderRes.data.shop_wallet_address

  // 6. Sign EIP-712 message
  const signature = await account.signTypedData({
    domain: {
      name: "JPY Coin",
      version: "1",
      chainId: BigInt(order.chain_id),
      verifyingContract: JPYC_CONTRACT,
    },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: account.address,
      to: shopWallet as `0x${string}`,
      value: parseUnits(order.total_jpyc.split(".")[0], 18),
      validAfter: BigInt(order.valid_after),
      validBefore: BigInt(order.valid_before),
      nonce: order.nonce as `0x${string}`,
    },
  })

  // 7. Submit signature
  const sigRes = await fetch(`${API_BASE}/orders/${order.id}/signature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      signature,
      customer_address: account.address,
    }),
  }).then(r => r.json())

  if (!sigRes.ok) throw new Error(sigRes.error.message)

  return {
    order_number: order.order_number,
    total_jpyc: order.total_jpyc,
    status: "signed",
    message: "Purchase complete! The shop will collect payment shortly.",
  }
}
```

## Notes

- **Signature validity**: Default 3 days (varies by shop). After expiry, the order is automatically cancelled and stock restored.
- **Minimum order**: 100 JPYC
- **Rate limit**: 10 order creations per minute per IP
- **Stock**: Decremented when signature is submitted (not when order is created). If stock runs out between order creation and signature submission, the submission will fail.
- **No gas needed**: The buyer only signs a message. The shop owner pays gas when collecting the signature on-chain.
