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
        "free_shipping_threshold": "5000",
        "category": "食品,飲料",
        "stock_display_mode": "exact",
        "low_stock_threshold": 5
      }
    ]
  }
}
```

`stock_display_mode` values: `"exact"` (show exact count), `"low_stock_only"` (show "low stock" when below threshold), `"hidden"` (hide stock count, only show out-of-stock)

### Step 1.5: Browse Categories (optional)

```
GET /api/v1/categories
```

Response:
```json
{
  "ok": true,
  "data": {
    "shop_categories": ["クリエイター", "サービス", "その他", "書籍", "雑貨", "食品", "飲料"],
    "product_categories": ["カメラ用品", "タロット占い", "写真集", "書籍"],
    "product_tags": ["お米", "おつまみ", "ぬか炊き", "北九州"]
  }
}
```

Use these categories to help users filter shops and products.

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
      "default_chain_id": 137,
      "checkout_options": [
        {
          "id": "noshi",
          "name": "のし",
          "type": "select",
          "required": false,
          "values": [
            { "label": "紅白蝶結び", "surcharge_jpyc": "0" },
            { "label": "紅白結び切り", "surcharge_jpyc": "0" }
          ]
        },
        {
          "id": "message",
          "name": "メッセージカード",
          "type": "text",
          "required": false,
          "max_length": 100
        },
        {
          "id": "gift_wrap",
          "name": "ギフト包装",
          "type": "checkbox",
          "required": false,
          "surcharge_jpyc": "300"
        }
      ]
    },
    "products": [
      {
        "id": "uuid",
        "name": "Product Name",
        "description": "...",
        "price_jpyc": "1500.000000000000000000",
        "stock": 10,
        "image_urls": ["https://..."],
        "category": "書籍",
        "tags": ["お米", "産地直送"],
        "requires_shipping": true,
        "grants_free_shipping": false,
        "variants": {
          "options": [
            { "name": "挽き方", "values": ["豆のまま", "粉に挽く"] },
            { "name": "サイズ", "values": ["200g", "400g"] }
          ],
          "skus": [
            { "options": { "挽き方": "豆のまま", "サイズ": "200g" }, "price_jpyc": null },
            { "options": { "挽き方": "豆のまま", "サイズ": "400g" }, "price_jpyc": "2380" },
            { "options": { "挽き方": "粉に挽く", "サイズ": "200g" }, "price_jpyc": null },
            { "options": { "挽き方": "粉に挽く", "サイズ": "400g" }, "price_jpyc": "2380" }
          ]
        },
        "review_avg_rating": 4.5,
        "review_count": 3,
        "has_nft_discount": true
      }
    ],
    "has_nft_discounts": true
  }
}
```

**Important**: `price_jpyc` is a string with 18 decimal places (DECIMAL type). Use the integer part for display (e.g., "1500.000000000000000000" → 1500 JPYC).

- `variants`: Product options (e.g., size, grind type). `null` if no variants.
  - `options`: Array of option definitions (name + possible values)
  - `skus`: Array of option combinations with optional price override. `price_jpyc: null` means use the product's base `price_jpyc`.
- `review_avg_rating`: Average rating (1-5) or `null` if no reviews
- `review_count`: Number of visible reviews
- `has_nft_discount`: Whether this product is eligible for NFT/SBT holder discounts
- `has_nft_discounts`: Whether the shop has any active NFT discount rules
- `shop.checkout_options`: **Shop-level** options that apply to the entire order (NOT per-product). Examples: のし (gift wrap label), 到着時間 (delivery time), メッセージカード (gift message). Each definition has:
  - `id`: stable identifier (e.g., `"noshi"`, `"delivery_time"`)
  - `name`: display label
  - `type`: `"select"` (choose one of `values[].label`), `"text"` (freeform up to `max_length`), or `"checkbox"` (boolean)
  - `required`: whether the buyer MUST provide a value
  - For `select`: each entry in `values` has a `surcharge_jpyc` that's added to the order total if selected
  - For `checkbox`: `surcharge_jpyc` is added if the value is `true`
  - For `text`: no surcharge, `max_length` enforces text length
  - When creating an order, send the selected values in `checkout_options` (see Step 6)

### Step 3: Get Product Details (optional)

```
GET /api/v1/products/{product_id}
```

Returns product details with shop info including `shop.wallet_address`, plus `variants`, `review_avg_rating`, `review_count`, and `has_nft_discount`.

### Step 3.5: Get Product Reviews (optional)

```
GET /api/v1/products/{product_id}/reviews
```

Response:
```json
{
  "ok": true,
  "data": {
    "product_id": "uuid",
    "avg_rating": 4.5,
    "review_count": 3,
    "reviews": [
      {
        "id": "uuid",
        "customer_address": "0xF243...E853",
        "rating": 5,
        "title": "とても良い商品です",
        "content": "品質が高くて満足しました。",
        "created_at": "2026-04-20T..."
      }
    ]
  }
}
```

Customer addresses are masked for privacy. Reviews are only from verified purchasers (wallet signature verified).

### Step 3.6: Check NFT Discount Rules (optional)

```
GET /api/v1/shops/{slug}/nft-discounts
```

Response:
```json
{
  "ok": true,
  "data": {
    "shop_id": "uuid",
    "discount_rules": [
      {
        "id": "uuid",
        "name": "JPYC Supporters SBT",
        "contract_address": "0xabc...def",
        "chain_id": 137,
        "condition_type": "balance",
        "condition_value": { "min_balance": 1 },
        "discount_type": "percentage",
        "discount_value": "10.00",
        "apply_to_all": true,
        "product_ids": "all"
      }
    ]
  }
}
```

If `apply_to_all` is `false`, `product_ids` will be an array of product UUIDs that the discount applies to. The agent can check if it holds the required NFT/SBT to determine discount eligibility.

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
    {
      "product_id": "uuid",
      "quantity": 1,
      "variant_selections": { "挽き方": "粉に挽く", "サイズ": "200g" }
    }
  ],
  "shipping_prefecture": "東京都",
  "shipping_address1": "渋谷区神南1-2-3",
  "shipping_address2": "ABCビル 101",
  "shipping_zip": "150-0041",
  "shipping_tel": "03-1234-5678",
  "checkout_options": {
    "noshi": "紅白蝶結び",
    "message": "おめでとうございます",
    "gift_wrap": true
  }
}
```

**Shipping fields** are required only if ANY product has `requires_shipping: true`. For digital products, omit them.

**Variant selections**: If a product has `variants` (not null), you MUST include `variant_selections` in the item. This is a key-value object mapping each option name to the chosen value (e.g., `{"挽き方": "粉に挽く", "サイズ": "200g"}`). Omitting `variant_selections` for a product with variants will return a validation error. For products without variants, omit the field.

**Checkout options**: If the shop defines `checkout_options` (see Step 2), build an object keyed by option `id`:
- `select` → the chosen `label` string (must match one of the option's `values[].label`)
- `text` → freeform string (length ≤ `max_length`)
- `checkbox` → `true` or `false`
- Omit unselected non-required options entirely
- Required options MUST be present, otherwise the request returns a 400 validation error
- `surcharge_jpyc` from chosen values/checked checkboxes is added to `total_jpyc` automatically — do NOT add it client-side

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
      "discount_jpyc": "150.000000000000000000",
      "shipping_jpyc": "800.000000000000000000",
      "total_jpyc": "2450.000000000000000000",
      "chain_id": 137,
      "order_status": 1,
      "checkout_options": {
        "noshi": "紅白蝶結び",
        "message": "おめでとうございます",
        "gift_wrap": true
      },
      "created_at": "2026-04-08T..."
    },
    "shop_wallet_address": "0xShopWallet...",
    "items": [
      { "product_name": "Product", "price_jpyc": "1500.000000000000000000", "quantity": 1, "variant_info": "挽き方: 粉に挽く, サイズ: 200g", "discount_amount": "150.000000000000000000" }
    ]
  }
}
```

**NFT Discount**: If the buyer holds an eligible NFT/SBT (check via `/api/v1/shops/{slug}/nft-discounts`), include a `discount` object in the order request to apply the discount:

```json
{
  "discount": {
    "rule_id": "uuid-of-discount-rule",
    "total_discount": "150",
    "item_discounts": {
      "product-uuid": {
        "discount_amount": "150",
        "rule_snapshot": "{\"id\":\"...\",\"name\":\"...\",\"discount_type\":\"percentage\",\"discount_value\":\"10\"}"
      }
    }
  }
}
```

The `total_jpyc` in the response will reflect: `subtotal - discount + shipping`.
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
        "total_jpyc": "2450.000000000000000000",
        "discount_jpyc": "150.000000000000000000",
        "order_status": 2,
        "tx_hash": null,
        "checkout_options": {
          "noshi": "紅白蝶結び",
          "message": "おめでとうございます",
          "gift_wrap": true
        },
        "items": [{ "product_id": "uuid", "product_name": "Product", "price_jpyc": "1500.000000000000000000", "quantity": 1, "variant_info": "挽き方: 粉に挽く, サイズ: 200g", "discount_amount": "150.000000000000000000" }]
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
  variantSelections?: Record<string, string>,
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

  // Validate variant selections
  if (product.variants && !variantSelections) {
    const optionNames = product.variants.options.map((o: any) => o.name).join(", ")
    throw new Error(`This product requires variant selections: ${optionNames}`)
  }

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
    items: [{
      product_id: productId,
      quantity,
      ...(variantSelections ? { variant_selections: variantSelections } : {}),
    }],
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
  // If the shop has shop.checkout_options, build values keyed by definition id:
  //   - select → chosen label string
  //   - text   → freeform string (≤ max_length)
  //   - checkbox → true/false
  // Required options MUST be present; surcharge is added server-side to total_jpyc.
  // Example: orderBody.checkout_options = { noshi: "紅白蝶結び", gift_wrap: true }

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
