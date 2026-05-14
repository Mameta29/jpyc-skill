# jpyc-skill

AI agent tooling for the **JPYC EC Platform** ([ec.jpyc-service.com](https://ec.jpyc-service.com)) — buy products with JPYC stablecoin via the **x402** payment protocol, no gas fees, no accounts.

This repo ships two complementary pieces:

| Path | What it is | Use it from |
| ---- | ---------- | ----------- |
| [`skills/jpyc-ec-purchase/`](./skills/jpyc-ec-purchase) | Claude Code [Skill](https://docs.anthropic.com/en/docs/claude-code/plugins) — markdown reference describing the EC API and x402 flow | Claude Code (CLI / Desktop) |
| [`mcp-servers/jpyc-ec-purchase/`](./mcp-servers/jpyc-ec-purchase) | Model Context Protocol server — invokable tools (`search_products`, `purchase_product`, …) for any MCP-capable agent | Claude Desktop, Cursor, OpenAI Agents SDK, and any MCP host |

Both target the same surface: the JPYC EC Platform's public `/api/v1` routes plus the x402 v2 checkout endpoint.

---

## Why this exists

[x402](https://x402.org) is an open standard (Coinbase, December 2025) that embeds payments into HTTP using the long-dormant `402 Payment Required` status code. JPYC implements EIP-3009 natively, so an AI agent can:

1. Discover a product on the JPYC EC Platform
2. Sign an EIP-712 authorization with its wallet (zero gas)
3. POST it back — the platform's facilitator settles on-chain in one round trip
4. Receive an order number + transaction hash

This repo is the agent-side ergonomics layer for that flow.

---

## Skill (`skills/jpyc-ec-purchase/`)

Markdown documentation Claude Code reads as context. Two files:

- **`SKILL.md`** — The TypeScript / SDK-flavoured reference. Decision tree (when to ask for shipping, when to ask for variants), full request/response shapes for every `/api/v1` route, complete error matrix, sample TypeScript implementation using viem.
- **`SKILL-acli.md`** — The same content rewritten as `curl` + `jq` recipes. Useful for shell-based agents and direct debugging.

### Install (Claude Code)

```bash
git clone https://github.com/Mameta29/jpyc-skill.git
mkdir -p ~/.claude/skills/jpyc-ec-purchase
cp -r jpyc-skill/skills/jpyc-ec-purchase/* ~/.claude/skills/jpyc-ec-purchase/
```

Claude Code will then automatically use the skill whenever you ask it to interact with the JPYC EC Platform — e.g. "list shops on stg-ec.jpyc-service.com" or "buy product X with my testnet wallet".

---

## MCP server (`mcp-servers/jpyc-ec-purchase/`)

A standalone MCP server exposing eight tools:

| Tool | EC API endpoint |
| ---- | --------------- |
| `list_shops` | `GET /api/v1/shops` |
| `list_products_in_shop` | `GET /api/v1/shops/:slug/products` |
| `get_product` | `GET /api/v1/products/:id` |
| `get_product_reviews` | `GET /api/v1/products/:id/reviews` |
| `get_nft_discounts` | `GET /api/v1/shops/:slug/nft-discounts` |
| `get_categories` | `GET /api/v1/categories` |
| `get_order_status` | `GET /api/v1/orders?customer_address=` |
| `purchase_product` | `POST /api/v1/products/:id/checkout` (x402, called twice) |

`purchase_product` runs the full x402 dance: fetches the 402 challenge, signs an EIP-3009 `transferWithAuthorization` with the agent's wallet, submits the signed payload, returns the finalized order. Accepts an optional `max_amount_atomic` budget cap so a misbehaving (or hijacked) agent can't overspend.

### Configure (Claude Desktop)

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

For Cursor / OpenAI Agents SDK, the same stdio launcher works — both accept arbitrary MCP servers.

### Run from source

```bash
cd jpyc-skill/mcp-servers/jpyc-ec-purchase
npm install && npm run build
BUYER_PRIVATE_KEY=0x... EC_API_URL=https://stg-ec.jpyc-service.com node dist/bin.js
```

See [`mcp-servers/jpyc-ec-purchase/README.md`](./mcp-servers/jpyc-ec-purchase/README.md) for the full setup walkthrough.

---

## What this repo is NOT

- It is **not** a JPYC contract reference. EIP-3009 / EIP-2612 / admin docs for the JPYC token itself live elsewhere.
- It is **not** a generic x402 facilitator. The hosted facilitator the platform uses (`facilitator.jpyc-service.com`) is operated separately at [`Mameta29/jpyc-x402-facilitator`](https://github.com/Mameta29/jpyc-x402-facilitator).
- It is **not** affiliated with JPYC株式会社 or Coinbase.

---

## Related

- [jpyc-ec-platform](https://github.com/Mameta29/jpyc-ec-platform) — The EC platform whose API these tools target.
- [jpyc-x402-facilitator](https://github.com/Mameta29/jpyc-x402-facilitator) — The x402 facilitator the EC platform delegates settlement to.
- [coinbase/x402](https://github.com/coinbase/x402) — Protocol specification.

## License

MIT
