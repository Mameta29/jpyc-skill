# @jpyc-skill/ec-purchase-mcp

MCP server that lets any LLM agent (Claude Desktop, Cursor, OpenAI Agents SDK,
…) buy products on **JPYC EC Platform** using **x402** — gasless EIP-3009
payments over HTTP.

## Tools

The tool surface mirrors the EC platform's public /api/v1 routes 1:1 so an
agent reading the tool list sees exactly the operations the real service
provides. No tool advertises functionality the API does not.

**Discovery (read-only, no payment):**

| Tool | EC API endpoint |
| ---- | --------------- |
| `list_shops()` | `GET /api/v1/shops` |
| `list_products_in_shop({ shop_slug })` | `GET /api/v1/shops/:slug/products` |
| `get_product({ product_id })` | `GET /api/v1/products/:id` |
| `get_product_reviews({ product_id })` | `GET /api/v1/products/:id/reviews` |
| `get_nft_discounts({ shop_slug })` | `GET /api/v1/shops/:slug/nft-discounts` |
| `get_categories()` | `GET /api/v1/categories` |
| `get_order_status({ customer_address? })` | `GET /api/v1/orders?customer_address=` |

**Purchase (signs + settles via x402):**

| Tool | EC API endpoint |
| ---- | --------------- |
| `purchase_product({ product_id, quantity, ... })` | `POST /api/v1/products/:id/checkout` (called twice — challenge then settle) |

`purchase_product` accepts an optional `max_amount_atomic` budget cap. The
tool refuses to sign if the 402 challenge requires more than this — a
strongly recommended guard against agent hijacking.

> **Before calling `purchase_product`**: always call `get_product` first.
> Read `requires_shipping` and `variants` and collect the necessary inputs
> from the user. Skipping this step causes the purchase to fail with
> `400 shipping_required` or `400 invalid_variant`.

## Install

```bash
npm install -g @jpyc-skill/ec-purchase-mcp   # once published
```

Or run from source:

```bash
git clone https://github.com/Mameta29/jpyc-skill.git
cd jpyc-skill/mcp-servers/jpyc-ec-purchase
npm install && npm run build
node dist/bin.js
```

## Configure (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jpyc-ec-purchase": {
      "command": "npx",
      "args": ["-y", "@jpyc-skill/ec-purchase-mcp"],
      "env": {
        "BUYER_PRIVATE_KEY": "0x...",
        "EC_API_URL": "https://ec.jpyc-service.com"
      }
    }
  }
}
```

`BUYER_PRIVATE_KEY` should belong to a wallet you have funded with JPYC on a
chain the platform supports (Polygon recommended; cheapest gas, widest JPYC
liquidity).

## Configure (Cursor / OpenAI Agents SDK)

Use the same stdio launcher; both tools accept arbitrary MCP servers.

## Notes

- Each `purchase_product` call signs a fresh EIP-3009 authorization; nothing
  is reused. Replay is impossible at the contract level.
- The platform's facilitator (`https://facilitator.jpyc-x402.com`) pays gas
  for settlement. If you self-host the EC platform, configure your own
  facilitator URL via that platform's `FACILITATOR_URL` env var.
- Supported chains follow JPYC EC Platform's chain registry: Ethereum,
  Polygon, Avalanche, Sepolia, Amoy, Fuji, Kairos, Arc.
- Shipping products require a `shipping` block — the EC layer rejects
  shipping-required products without an address (400, not 402: paying does
  not fix a missing address).
