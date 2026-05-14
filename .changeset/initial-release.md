---
"@jpyc-skill/ec-purchase-mcp": minor
---

Initial public release.

MCP server exposing eight tools for AI agents to discover and purchase
products on JPYC EC Platform via x402 (HTTP-native gasless payments):

- Discovery: `list_shops`, `list_products_in_shop`, `get_product`,
  `get_product_reviews`, `get_nft_discounts`, `get_categories`,
  `get_order_status`
- Purchase: `purchase_product` (full x402 v2 dance — fetch 402 challenge,
  sign EIP-3009 TransferWithAuthorization, settle via the platform's
  facilitator, return finalized order)

Built against the publicly-tested staging deployment
(stg-ec.jpyc-service.com / facilitator-staging.jpyc-service.com); all
routes verified against the real API surface.
