---
name: jpyc-ec-purchase
description: Purchase products from JPYC EC Platform using JPYC stablecoin. Use when you or the user want to buy products from a JPYC EC shop, browse shops, check product availability, or complete a purchase with gasless EIP-3009 payment.
user-invocable: true
disable-model-invocation: false
allowed-tools: ["Bash(curl *)", "Bash(node * balance *)", "Bash(node * wallet *)", "Bash(node * sign *)"]
---

# JPYC EC Purchase

Purchase products from **JPYC EC Platform** shops using JPYC (Japanese Yen Stablecoin, 1 JPYC ≈ 1 JPY) with gasless EIP-3009 payments. The buyer pays **zero gas fees** — only an EIP-712 signature is required.

## ⚠️ Important Notes

| Item | Detail |
|------|--------|
| **Gas cost for buyer** | **Zero** (signature only) |
| **Authentication** | None required — wallet address + signature = identity |
| **Minimum order** | 100 JPYC |
| **Signature validity** | Default 3 days (varies by shop) |
| **Rate limit** | 10 order creations per minute |

## Environments & Supported Chains

Each environment only accepts its own chain type. Using a testnet chain ID on Production (or mainnet on Staging) will return `INVALID_CHAIN`.

### Production: `https://ec.jpyc-service.com/api/v1`

| Chain | Chain ID | acli chain name |
|-------|----------|----------------|
| Ethereum | 1 | ethereum |
| Polygon | 137 | polygon |
| Avalanche | 43114 | avalanche |

### Staging (for testing): `https://stg-ec.jpyc-service.com/api/v1`

| Chain | Chain ID | acli chain name |
|-------|----------|----------------|
| Sepolia | 11155111 | sepolia |
| Polygon Amoy | 80002 | polygon-amoy |
| Avalanche Fuji | 43113 | avalanche-fuji |

**JPYC Contract Address** (same on all chains, both mainnet and testnet):
```
0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
```

Additionally, each shop has its own `available_chains` array (returned in API responses). The `chain_id` used in an order **must** be in the shop's `available_chains`.

---

## Complete Purchase Flow

### Step 1: Get Wallet Address

```bash
# Get wallet info to find your address
node <acli-path> wallet info --name <wallet-name>
```

Extract the wallet address for the target chain from the response.

### Step 2: Browse Shops

```bash
curl -s https://ec.jpyc-service.com/api/v1/shops | jq .
```

Expected output:
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

### Step 2.5: Browse Categories (optional)

```bash
curl -s https://ec.jpyc-service.com/api/v1/categories | jq .
```

Expected output:
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

### Step 3: Browse Products

```bash
curl -s https://ec.jpyc-service.com/api/v1/shops/<shop-slug>/products | jq .
```

Expected output:
```json
{
  "ok": true,
  "data": {
    "shop": {
      "id": "uuid",
      "slug": "shop-slug",
      "name": "Shop Name",
      "wallet_address": "0xShopWallet...",
      "available_chains": [137, 43114],
      "default_chain_id": 137,
      "category": "食品,飲料",
      "stock_display_mode": "exact",
      "low_stock_threshold": 5
    },
    "products": [
      {
        "id": "uuid",
        "name": "Product Name",
        "description": "...",
        "price_jpyc": "1500.000000000000000000",
        "stock": 10,
        "image_urls": ["https://..."],
        "category": "コーヒー",
        "tags": ["珈琲", "産地直送"],
        "requires_shipping": true,
        "grants_free_shipping": false,
        "variants": {
          "options": [
            { "name": "挽き方", "values": ["豆のまま", "粉に挽く"] },
            { "name": "サイズ", "values": ["200g", "400g"] }
          ],
          "skus": [
            { "options": { "挽き方": "豆のまま", "サイズ": "200g" }, "price_jpyc": null },
            { "options": { "挽き方": "豆のまま", "サイズ": "400g" }, "price_jpyc": "2380" }
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

**Note**: `price_jpyc` is a string with 18 decimal places. Use the integer part for calculations (e.g., "1500.000000000000000000" → 1500 JPYC).

- `variants`: Product options (e.g., size, grind type). `null` if no variants. Each SKU may have a `price_jpyc` override — if null, use the product's base price. When ordering, you **must** include `variant_selections` in the item (see Step 6).
- `review_avg_rating`: Average rating (1-5) or `null` if no reviews
- `review_count`: Number of visible reviews
- `has_nft_discount`: Whether this product is eligible for NFT/SBT holder discounts
- `has_nft_discounts`: Whether the shop has any active NFT discount rules

**Important**: Save `shop.wallet_address` — it is needed for the EIP-712 signature in Step 7.

### Step 3.5: Get Product Details (optional)

```bash
curl -s https://ec.jpyc-service.com/api/v1/products/<product-id> | jq .
```

Returns product details with shop info including `shop.wallet_address`, plus `variants`, `review_avg_rating`, `review_count`, and `has_nft_discount`.

### Step 3.6: Get Product Reviews (optional)

```bash
curl -s https://ec.jpyc-service.com/api/v1/products/<product-id>/reviews | jq .
```

Expected output:
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

Customer addresses are masked for privacy. Reviews are only from verified purchasers.

### Step 3.7: Check NFT Discount Rules (optional)

```bash
curl -s https://ec.jpyc-service.com/api/v1/shops/<shop-slug>/nft-discounts | jq .
```

Expected output:
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

Skip this step if `requires_shipping` is `false`.

```bash
curl -s -X POST https://ec.jpyc-service.com/api/v1/shipping/fee \
  -H "Content-Type: application/json" \
  -d '{
    "shop_id": "<shop-id>",
    "prefecture": "東京都",
    "items": [{"product_id": "<product-id>", "quantity": 1}],
    "city": "渋谷区"
  }' | jq .
```

Expected output:
```json
{
  "ok": true,
  "data": {
    "shipping_fee": "800",
    "reason": "standard_rate"
  }
}
```

Reason values:
| Reason | Meaning |
|--------|---------|
| `standard_rate` | Normal prefecture-based rate |
| `free_shipping_product` | Product has free shipping |
| `threshold_met` | Order total exceeds free shipping threshold |
| `local_delivery` | Local delivery rate applied |
| `no_shipping_items` | No items require shipping |
| `no_rate_configured` | Prefecture not available — **cannot ship** |

### Step 5: Check JPYC Balance

```bash
# Using acli
node <acli-path> balance --name <wallet-name> --chain <chain> --token JPYC

# Or using API
curl -s -X POST https://ec.jpyc-service.com/api/v1/balance/check \
  -H "Content-Type: application/json" \
  -d '{
    "address": "0xYourWalletAddress",
    "required_amount": "2300",
    "chain_id": 137
  }' | jq .
```

API response:
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

**CRITICAL**: Always check balance BEFORE creating an order. If `sufficient` is `false`, do **not** proceed.

### Step 6: Create Order

```bash
curl -s -X POST https://ec.jpyc-service.com/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "shop_id": "<shop-id>",
    "customer_address": "0xYourWalletAddress",
    "customer_name": "Your Name",
    "customer_email": "user@example.com",
    "chain_id": 137,
    "items": [{"product_id": "<product-id>", "quantity": 1, "variant_selections": {"挽き方": "粉に挽く", "サイズ": "200g"}}],
    "shipping_prefecture": "東京都",
    "shipping_address1": "渋谷区神南1-2-3",
    "shipping_address2": "ABCビル 101",
    "shipping_zip": "150-0041",
    "shipping_tel": "03-1234-5678"
  }' | jq .
```

**Shipping fields** are required only if any product has `requires_shipping: true`. For digital products, omit them entirely.

**Variant selections**: If a product has `variants` (not null), you MUST include `variant_selections` in the item — a key-value object mapping each option name to the chosen value (e.g., `{"挽き方": "粉に挽く", "サイズ": "200g"}`). Omitting it for a product with variants returns a validation error. For products without variants, omit the field.

Optional: `customer_note` (max 2000 chars) for special instructions.

**NFT Discount**: If the buyer holds an eligible NFT/SBT (check via Step 3.7), include a `discount` object in the order request:

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

Expected output:
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
      "discount_jpyc": "0.000000000000000000",
      "shipping_jpyc": "800.000000000000000000",
      "total_jpyc": "2300.000000000000000000",
      "chain_id": 137,
      "order_status": 1,
      "created_at": "2026-04-08T..."
    },
    "shop_wallet_address": "0xShopWallet...",
    "items": [
      {"product_name": "Product", "price_jpyc": "1500.000000000000000000", "quantity": 1, "variant_info": "挽き方: 粉に挽く, サイズ: 200g", "discount_amount": "0.000000000000000000"}
    ]
  }
}
```

**Save these values** from the response — they are needed for signing:
- `order.id` — for submitting the signature
- `order.nonce` — the unique random nonce
- `order.valid_after` — usually "0"
- `order.valid_before` — expiry timestamp
- `order.total_jpyc` — total amount to sign
- `order.chain_id` — the chain for signing
- `shop_wallet_address` — the `to` address in the signature

### Step 7: Sign EIP-712 Message (using acli)

Construct the EIP-712 typed data JSON and sign it with `acli sign typed-data`:

```bash
# Calculate value in wei (total_jpyc integer part × 10^18)
# Example: 2300 JPYC → "2300000000000000000000"

node <acli-path> sign typed-data --name <wallet-name> --chain <chain> --data '{
  "types": {
    "EIP712Domain": [
      {"name": "name", "type": "string"},
      {"name": "version", "type": "string"},
      {"name": "chainId", "type": "uint256"},
      {"name": "verifyingContract", "type": "address"}
    ],
    "ReceiveWithAuthorization": [
      {"name": "from", "type": "address"},
      {"name": "to", "type": "address"},
      {"name": "value", "type": "uint256"},
      {"name": "validAfter", "type": "uint256"},
      {"name": "validBefore", "type": "uint256"},
      {"name": "nonce", "type": "bytes32"}
    ]
  },
  "primaryType": "ReceiveWithAuthorization",
  "domain": {
    "name": "JPY Coin",
    "version": "1",
    "chainId": "<chain-id>",
    "verifyingContract": "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29"
  },
  "message": {
    "from": "<your-wallet-address>",
    "to": "<shop-wallet-address>",
    "value": "<total-in-wei>",
    "validAfter": "<valid_after>",
    "validBefore": "<valid_before>",
    "nonce": "<nonce-from-order>"
  }
}'
```

**Critical requirements for signing**:
- `domain.name` MUST be exactly `"JPY Coin"`
- `domain.version` MUST be exactly `"1"`
- `domain.verifyingContract` MUST be `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29`
- `message.from` MUST be your wallet address (same as `customer_address` in order)
- `message.to` MUST be `shop_wallet_address` from the order response
- `message.value` MUST be total amount in wei (integer part of `total_jpyc` × 10^18)
- `message.nonce` MUST be the exact nonce from order response

**Converting total_jpyc to wei**:
```
total_jpyc = "2300.000000000000000000"
Integer part = 2300
Value in wei = "2300000000000000000000"  (2300 followed by 18 zeros)
```

Expected output:
```json
{
  "ok": true,
  "data": {
    "signature": "0x..."
  }
}
```

### Step 8: Submit Signature

```bash
curl -s -X POST https://ec.jpyc-service.com/api/v1/orders/<order-id>/signature \
  -H "Content-Type: application/json" \
  -d '{
    "signature": "0x...",
    "customer_address": "0xYourWalletAddress"
  }' | jq .
```

Expected output:
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

**Purchase complete!** The shop owner will collect the signature and execute the on-chain payment. No further action needed from the buyer.

### Step 9: Track Orders (optional)

```bash
curl -s "https://ec.jpyc-service.com/api/v1/orders?customer_address=0xYourWalletAddress" | jq .
```

Order status values:

| Status | Meaning |
|--------|---------|
| 1 | Created (awaiting signature) |
| 2 | Signed (awaiting shop collection) |
| 3 | Collected (payment complete, on-chain verified) |
| 9 | Expired or cancelled |

---

## Detailed Examples

### Example 1: Buy a Physical Product (Full Flow)

```bash
# 1. Get wallet address
node <acli-path> wallet info --name my-wallet
# → Note the address for polygon (chainId: eip155:137): 0xABC...

# 2. Browse shops
curl -s https://ec.jpyc-service.com/api/v1/shops | jq '.data.shops[] | {slug, name, available_chains}'
# → Found shop "oumi-rice" on chain 137

# 3. Browse products
curl -s https://ec.jpyc-service.com/api/v1/shops/oumi-rice/products | jq .
# → Found product id "prod-123", price 3000 JPYC, requires_shipping: true
# → Shop wallet: 0xShop123...

# 4. Calculate shipping
curl -s -X POST https://ec.jpyc-service.com/api/v1/shipping/fee \
  -H "Content-Type: application/json" \
  -d '{"shop_id":"shop-uuid","prefecture":"東京都","items":[{"product_id":"prod-123","quantity":1}]}' | jq .
# → shipping_fee: "800"

# 5. Check balance (total = 3000 + 800 = 3800)
curl -s -X POST https://ec.jpyc-service.com/api/v1/balance/check \
  -H "Content-Type: application/json" \
  -d '{"address":"0xABC...","required_amount":"3800","chain_id":137}' | jq .
# → sufficient: true

# 6. Create order
curl -s -X POST https://ec.jpyc-service.com/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "shop_id":"shop-uuid",
    "customer_address":"0xABC...",
    "customer_name":"田中太郎",
    "customer_email":"tanaka@example.com",
    "chain_id":137,
    "items":[{"product_id":"prod-123","quantity":1,"variant_selections":{"挽き方":"粉に挽く","サイズ":"200g"}}],
    "shipping_prefecture":"東京都",
    "shipping_address1":"渋谷区神南1-2-3",
    "shipping_zip":"150-0041",
    "shipping_tel":"03-1234-5678"
  }' | jq .
# → order.id: "order-uuid", nonce: "0xabc...", total_jpyc: "3800.000000000000000000"
# → shop_wallet_address: "0xShop123..."

# 7. Sign (3800 JPYC = "3800000000000000000000" wei)
node <acli-path> sign typed-data --name my-wallet --chain polygon --data '{
  "types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"ReceiveWithAuthorization":[{"name":"from","type":"address"},{"name":"to","type":"address"},{"name":"value","type":"uint256"},{"name":"validAfter","type":"uint256"},{"name":"validBefore","type":"uint256"},{"name":"nonce","type":"bytes32"}]},
  "primaryType":"ReceiveWithAuthorization",
  "domain":{"name":"JPY Coin","version":"1","chainId":"137","verifyingContract":"0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29"},
  "message":{"from":"0xABC...","to":"0xShop123...","value":"3800000000000000000000","validAfter":"0","validBefore":"1712345678","nonce":"0xabc..."}
}'
# → signature: "0xSIG..."

# 8. Submit signature
curl -s -X POST https://ec.jpyc-service.com/api/v1/orders/order-uuid/signature \
  -H "Content-Type: application/json" \
  -d '{"signature":"0xSIG...","customer_address":"0xABC..."}' | jq .
# → order_status: 2 — Purchase complete!
```

### Example 2: Buy a Digital Product (No Shipping)

```bash
# Digital products don't require shipping fields
curl -s -X POST https://ec.jpyc-service.com/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "shop_id":"shop-uuid",
    "customer_address":"0xABC...",
    "chain_id":137,
    "items":[{"product_id":"digital-prod-id","quantity":1}]
  }' | jq .

# Then sign and submit as usual (Steps 7-8)
```

### Example 3: Error Cases

**Insufficient balance**:
```json
{
  "ok": true,
  "data": {
    "sufficient": false,
    "balance": "100.0",
    "required": "3800"
  }
}
```
→ Do NOT proceed. Inform the user they need more JPYC.

**Out of stock**:
```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough stock for product: Product Name"
  }
}
```

**Signature expired (tried to submit after validity period)**:
```json
{
  "ok": false,
  "error": {
    "code": "SIGNATURE_EXPIRED",
    "message": "Order signature period has expired"
  }
}
```
→ Create a new order and sign again.

**Prefecture not available for shipping**:
```json
{
  "ok": true,
  "data": {
    "shipping_fee": "0",
    "reason": "no_rate_configured"
  }
}
```
→ The shop does not ship to this prefecture. Try a different prefecture or contact the shop.

## Handling Shipping Address

If a product requires shipping (`requires_shipping: true`), you need:
- `shipping_prefecture`: Japanese prefecture (e.g., "東京都", "大阪府", "北海道")
- `shipping_address1`: City, ward, and street (e.g., "渋谷区神南1-2-3")
- `shipping_address2`: Building name, room number (optional)
- `shipping_zip`: Postal code (e.g., "150-0041")
- `shipping_tel`: Phone number (e.g., "03-1234-5678")

**If you don't know the user's shipping address, ask them before creating the order.**

## Error Codes Reference

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `INVALID_ADDRESS` | 400 | Malformed Ethereum address |
| `INVALID_AMOUNT` | 400 | Invalid amount value |
| `INVALID_CHAIN` | 400 | Unsupported chain ID |
| `INVALID_SIGNATURE` | 400 | Malformed signature |
| `INVALID_STATUS` | 400 | Order not in expected status |
| `ADDRESS_MISMATCH` | 400 | Customer address doesn't match order |
| `SIGNATURE_EXPIRED` | 400 | Signature validity period expired |
| `SHOP_NOT_FOUND` | 404 | Shop not found or not published |
| `PRODUCT_NOT_FOUND` | 404 | Product not found or not published |
| `ORDER_NOT_FOUND` | 404 | Order not found |
| `INSUFFICIENT_STOCK` | 400 | Not enough stock available |
| `RATE_LIMITED` | 429 | Too many requests (10/min) |
| `BALANCE_CHECK_FAILED` | 500 | On-chain balance check failed |
| `ORDER_CREATION_FAILED` | 500 | Order creation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

## Input Validation

- **address**: Must be a valid Ethereum address starting with `0x` (42 characters).
- **chain_id**: Must be one of: 1, 137, 43114, 11155111, 80002, 43113.
- **quantity**: Must be a positive integer.
- **prefecture**: Must be a valid Japanese prefecture name (e.g., "東京都", "大阪府").
- **signature**: Must be a hex string starting with `0x` (132 characters = 0x + 130 hex chars).
