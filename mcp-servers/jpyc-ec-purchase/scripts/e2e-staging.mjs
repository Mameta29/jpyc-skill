/**
 * Manual end-to-end check of the MCP purchase tools against staging.
 *
 * Drives the real `purchase_cart` tool handler (not the MCP transport) so we
 * exercise client.ts + x402.ts + the staging EC + staging facilitator in one
 * shot. Creates a real test order on staging and broadcasts a real testnet
 * transaction.
 *
 * Usage:
 *   BUYER_PRIVATE_KEY=0x... node scripts/e2e-staging.mjs
 *
 * Requires the package to be built first (pnpm run build) — imports from dist.
 */

import { tools, defaultDeps } from "../dist/tools.js"

const EC_API_URL = "https://stg-ec.jpyc-service.com"

// agent shop / TEST_TEE — 5 JPYC, no variants, available on Amoy (80002).
const SHOP_ID = "7d29d289-fd78-46c2-beb2-ce891c7d33b7"
const PRODUCT_ID = "114a3d55-fa1a-4c51-b702-4dd816bced71"
const CHAIN_ID = 80002 // Polygon Amoy testnet

if (!process.env.BUYER_PRIVATE_KEY) {
  console.error("BUYER_PRIVATE_KEY env var is required")
  process.exit(1)
}

const deps = defaultDeps({
  ...process.env,
  EC_API_URL,
})

console.log("=== purchase_cart e2e (staging) ===")
console.log("EC:", EC_API_URL, "| shop:", SHOP_ID, "| product:", PRODUCT_ID, "| chain:", CHAIN_ID)

const result = await tools.purchase_cart.handler(
  {
    shop_id: SHOP_ID,
    items: [{ product_id: PRODUCT_ID, quantity: 1 }],
    customer_email: "qa-e2e@example.com",
    preferred_chain_id: CHAIN_ID,
    shipping: {
      name: "E2E テスト",
      zip: "150-0001",
      prefecture: "東京都",
      address1: "渋谷区神宮前1-2-3",
      tel: "090-0000-0000",
    },
    is_gift: false,
  },
  deps,
)

console.log("\n=== RESULT ===")
console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2))

if (result.ok) {
  console.log("\n✅ purchase_cart succeeded — order:", result.body?.data?.order_number,
    "tx:", result.body?.data?.tx_hash)
} else {
  console.log("\n❌ purchase_cart failed")
  process.exit(1)
}
