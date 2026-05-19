---
"@jpyc-skill/ec-purchase-mcp": minor
---

Initial public release.

MCP server exposing nine tools for AI agents to discover and purchase
products on JPYC EC Platform via x402 (HTTP-native gasless payments):

- Discovery: `list_shops`, `list_products_in_shop`, `get_product`,
  `get_product_reviews`, `get_nft_discounts`, `get_categories`,
  `get_order_status`
- Purchase: `purchase_cart` (full x402 v2 two-shot flow — fetch the 402
  challenge, sign an EIP-3009 TransferWithAuthorization, settle via the
  platform's facilitator, return the finalized order) and `purchase_product`
  (a single-item wrapper over `purchase_cart`)

Both purchase tools target the unified `POST /api/v1/checkout` endpoint and
support an optional `max_amount_atomic` budget cap. Built against the
publicly-tested staging deployment (stg-ec.jpyc-service.com /
facilitator-staging.jpyc-service.com); all routes verified against the real
API surface.
