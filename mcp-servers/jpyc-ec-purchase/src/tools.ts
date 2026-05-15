/**
 * MCP tool definitions for the JPYC EC purchase server.
 *
 * The tool surface mirrors the EC platform's public /api/v1 routes 1:1 so an
 * agent reading the tool list sees exactly the operations available on the
 * real service. No tool advertises functionality the API does not provide.
 *
 * Discovery tools (read-only, no payment):
 *   list_shops()                       → GET /api/v1/shops
 *   list_products_in_shop(shop_slug)   → GET /api/v1/shops/:slug/products
 *   get_product(product_id)            → GET /api/v1/products/:id
 *   get_product_reviews(product_id)    → GET /api/v1/products/:id/reviews
 *   get_nft_discounts(shop_slug)       → GET /api/v1/shops/:slug/nft-discounts
 *   get_categories()                   → GET /api/v1/categories
 *   get_order_status(customer_address?) → GET /api/v1/orders?customer_address=
 *
 * Purchase tools (sign + settle via x402):
 *   purchase_cart({...})               → POST /api/v1/checkout (twice)
 *   purchase_product({...})            → thin shim over purchase_cart for a
 *                                        single item (kept for back-compat)
 */

import { z } from "zod"
import { privateKeyToAccount } from "viem/accounts"
import { type Address, type Hex } from "viem"
import { EcClient, formatJpycFromAtomic } from "./client.js"
import {
  decodeHeader,
  encodeHeader,
  signAndBuildPayload,
  type PaymentRequired,
} from "./x402.js"

export interface ToolDeps {
  /** Resolves the buyer's signer. Default reads BUYER_PRIVATE_KEY at call time. */
  resolveSigner: () => ReturnType<typeof privateKeyToAccount>
  /** Resolves the EC API base URL. Default reads EC_API_URL. */
  resolveApiBaseUrl: () => string
}

export function defaultDeps(env: NodeJS.ProcessEnv = process.env): ToolDeps {
  return {
    resolveSigner: () => {
      const key = env.BUYER_PRIVATE_KEY as Hex | undefined
      if (!key) throw new Error("BUYER_PRIVATE_KEY env var is required")
      return privateKeyToAccount(key)
    },
    resolveApiBaseUrl: () => {
      const url = env.EC_API_URL ?? "https://ec.jpyc-service.com"
      return url.replace(/\/$/, "")
    },
  }
}

// ── Input schemas ───────────────────────────────────────────────────────────
const emptyInput = z.object({})
const shopSlugInput = z.object({ shop_slug: z.string().min(1) })
const productIdInput = z.object({ product_id: z.string().min(1) })
const orderStatusInput = z.object({
  customer_address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
})
const shippingSchema = z.object({
  name: z.string().min(1),
  zip: z.string().min(1),
  prefecture: z.string().min(1),
  address1: z.string().min(1),
  address2: z.string().optional(),
  tel: z.string().min(1),
})

const giftRecipientSchema = z.object({
  name: z.string().min(1),
  tel: z.string().min(1),
  zip: z.string().min(1),
  prefecture: z.string().min(1),
  address1: z.string().min(1),
  address2: z.string().optional(),
})

const purchaseCartInput = z.object({
  shop_id: z.string().min(1),
  items: z
    .array(
      z.object({
        product_id: z.string().min(1),
        quantity: z.number().int().positive(),
        /** Required when the product has variants (e.g. {"サイズ":"M"}). */
        variant_selections: z.record(z.string()).optional(),
      }),
    )
    .min(1),
  /** Required — the order-confirmation email goes here. */
  customer_email: z.string().email(),
  /** Optional: pick a chain from the items' common `available_chains`. */
  preferred_chain_id: z.number().int().positive().optional(),
  /** Required when any item has requires_shipping === true. */
  shipping: shippingSchema.optional(),
  is_gift: z.boolean().optional(),
  /** Required when is_gift is true. */
  gift_recipient: giftRecipientSchema.optional(),
  customer_note: z.string().optional(),
  /** Shop-defined checkout options (のし / arrival time, etc.). */
  checkout_options: z.record(z.union([z.string(), z.boolean()])).optional(),
  /** Hard budget cap (atomic JPYC, 18 decimals). Refuses if challenge asks more. */
  max_amount_atomic: z.string().regex(/^\d+$/).optional(),
})

const purchaseInput = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().positive(),
  /** Required — the shop_id the product belongs to (get it via get_product). */
  shop_id: z.string().min(1),
  /** Required — the order-confirmation email goes here. */
  customer_email: z.string().email(),
  preferred_chain_id: z.number().int().positive().optional(),
  /** Required when the product has variants (e.g. {"サイズ":"M"}). */
  variant_selections: z.record(z.string()).optional(),
  /** Required when product.requires_shipping === true. */
  shipping: shippingSchema.optional(),
  customer_note: z.string().optional(),
  max_amount_atomic: z.string().regex(/^\d+$/).optional(),
})

export interface ToolDef<TInput, TOutput> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  handler: (input: TInput, deps: ToolDeps) => Promise<TOutput>
}

// ── Tools ───────────────────────────────────────────────────────────────────
export const tools = {
  list_shops: {
    name: "list_shops",
    description:
      "List all published shops on JPYC EC Platform. Returns name, slug, available_chains, default_chain_id, and the shop's overall metadata.",
    inputSchema: emptyInput,
    handler: async (_input, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.listShops()
    },
  } satisfies ToolDef<Record<string, never>, unknown>,

  list_products_in_shop: {
    name: "list_products_in_shop",
    description:
      "List all published products in one shop. Includes price_jpyc, stock, requires_shipping, variants, review stats, NFT discount eligibility. Use this after list_shops to find candidate items to buy.",
    inputSchema: shopSlugInput,
    handler: async ({ shop_slug }, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.listProductsInShop(shop_slug)
    },
  } satisfies ToolDef<z.infer<typeof shopSlugInput>, unknown>,

  get_product: {
    name: "get_product",
    description:
      "Get full detail of one product. CRITICAL: call this BEFORE purchase_product to read `requires_shipping` (boolean) and `variants` (object|null). If requires_shipping is true, you must ask the user for an address. If variants is non-null, you must ask the user to pick options. Skipping this step causes purchase_product to fail with 400 shipping_required or 400 invalid_variant.",
    inputSchema: productIdInput,
    handler: async ({ product_id }, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.getProduct(product_id)
    },
  } satisfies ToolDef<z.infer<typeof productIdInput>, unknown>,

  get_product_reviews: {
    name: "get_product_reviews",
    description:
      "Get reviews for one product. Returns avg_rating (0-5), review_count, and individual reviews with masked customer addresses.",
    inputSchema: productIdInput,
    handler: async ({ product_id }, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.getProductReviews(product_id)
    },
  } satisfies ToolDef<z.infer<typeof productIdInput>, unknown>,

  get_nft_discounts: {
    name: "get_nft_discounts",
    description:
      "List NFT-based discount rules for a shop. Informational: the MCP purchase tools do not auto-apply NFT discounts. The /api/v1/checkout endpoint accepts a `discount` block, but computing it requires holding the qualifying NFT and is not wired into this MCP server yet.",
    inputSchema: shopSlugInput,
    handler: async ({ shop_slug }, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.getNftDiscounts(shop_slug)
    },
  } satisfies ToolDef<z.infer<typeof shopSlugInput>, unknown>,

  get_categories: {
    name: "get_categories",
    description:
      "List all shop categories, product categories, and product tags on the platform. Useful for narrowing down what to search for.",
    inputSchema: emptyInput,
    handler: async (_input, deps) => {
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.getCategories()
    },
  } satisfies ToolDef<Record<string, never>, unknown>,

  get_order_status: {
    name: "get_order_status",
    description:
      "List orders for a wallet address. Defaults to the agent's own wallet (derived from BUYER_PRIVATE_KEY env). x402 purchases appear as order_status=3 (collected) immediately with a tx_hash.",
    inputSchema: orderStatusInput,
    handler: async ({ customer_address }, deps) => {
      const addr = (customer_address ?? deps.resolveSigner().address) as Address
      const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
      return await client.getOrders(addr)
    },
  } satisfies ToolDef<z.infer<typeof orderStatusInput>, unknown>,

  purchase_cart: {
    name: "purchase_cart",
    description:
      [
        "End-to-end multi-item purchase via x402. Performs the full two-shot flow:",
        "  1) POST /api/v1/checkout without PAYMENT-SIGNATURE",
        "     → server returns 402 + PAYMENT-REQUIRED + reservation_id + a",
        "       price summary (subtotal / discount / shipping / options / total)",
        "  2) Sign an EIP-3009 TransferWithAuthorization with the agent's wallet",
        "  3) POST again with PAYMENT-SIGNATURE → server settles on-chain and",
        "     returns the finalized order (status=collected) + tx_hash.",
        "",
        "This is the single purchase entry point. Human shoppers and AI agents",
        "use the same /api/v1/checkout endpoint.",
        "",
        "BEFORE calling, ALWAYS:",
        "  • Call get_product on each item first.",
        "  • All items must belong to the same shop_id.",
        "  • If ANY item has requires_shipping=true, ask the user for name,",
        "    zip, prefecture, address1, tel (address2 optional) and pass them",
        "    as `shipping`. Missing shipping for a shipping-required item",
        "    fails with 400 shipping_required — paying does not fix a missing",
        "    address.",
        "  • For each item whose product.variants is non-null, ask the user to",
        "    pick options (e.g. {\"サイズ\":\"M\"}) and pass them as the item's",
        "    `variant_selections`.",
        "  • customer_email is REQUIRED — the order confirmation goes there.",
        "  • If is_gift is true, gift_recipient is required.",
        "  • Confirm the total JPYC price (from the step-1 summary) with the",
        "    user before signing.",
        "  • Optionally set `max_amount_atomic` as a budget cap; the tool",
        "    refuses to sign if the challenge requires more than that.",
        "",
        "Requires BUYER_PRIVATE_KEY in the MCP server environment.",
      ].join("\n"),
    inputSchema: purchaseCartInput,
    handler: async (input, deps) => {
      return runX402Cart(input, deps)
    },
  } satisfies ToolDef<z.infer<typeof purchaseCartInput>, unknown>,

  purchase_product: {
    name: "purchase_product",
    description:
      [
        "Single-item purchase. Thin wrapper over purchase_cart for the common",
        "case of buying one product. Prefer purchase_cart when buying multiple",
        "items or when you need gift / checkout-option fields.",
        "",
        "BEFORE calling: call get_product, supply shop_id + customer_email,",
        "and provide `shipping` (if requires_shipping) and `variant_selections`",
        "(if the product has variants). See purchase_cart for the full rules.",
        "",
        "Requires BUYER_PRIVATE_KEY in the MCP server environment.",
      ].join("\n"),
    inputSchema: purchaseInput,
    handler: async (input, deps) => {
      return runX402Cart(
        {
          shop_id: input.shop_id,
          items: [
            {
              product_id: input.product_id,
              quantity: input.quantity,
              variant_selections: input.variant_selections,
            },
          ],
          customer_email: input.customer_email,
          preferred_chain_id: input.preferred_chain_id,
          shipping: input.shipping,
          customer_note: input.customer_note,
          max_amount_atomic: input.max_amount_atomic,
        },
        deps,
      )
    },
  } satisfies ToolDef<z.infer<typeof purchaseInput>, unknown>,
}

/**
 * Shared x402 two-shot runner used by purchase_cart and purchase_product.
 * Requests the 402 challenge, enforces the optional budget cap, signs the
 * TransferWithAuthorization, and settles.
 */
async function runX402Cart(
  input: z.infer<typeof purchaseCartInput>,
  deps: ToolDeps,
) {
  const client = new EcClient({ baseUrl: deps.resolveApiBaseUrl() })
  const account = deps.resolveSigner()

  // Step 1: 402 challenge (also reserves stock for 5 minutes).
  const challenge = await client.requestX402Challenge({
    shop_id: input.shop_id,
    items: input.items,
    customer_email: input.customer_email,
    preferred_chain_id: input.preferred_chain_id,
    shipping: input.shipping,
    is_gift: input.is_gift,
    gift_recipient: input.gift_recipient,
    customer_note: input.customer_note,
    checkout_options: input.checkout_options,
  })
  const required = decodeHeader<PaymentRequired>(challenge.paymentRequiredHeader)
  const requirements = required.accepts[0]
  if (!requirements) {
    throw new Error("PaymentRequired.accepts[] is empty")
  }

  // Budget guard — agent-side responsibility per x402 design.
  if (input.max_amount_atomic !== undefined) {
    if (BigInt(requirements.amount) > BigInt(input.max_amount_atomic)) {
      throw new Error(
        `agent budget exceeded: required=${requirements.amount} max=${input.max_amount_atomic}`,
      )
    }
  }

  // Step 2: sign the TransferWithAuthorization for the challenge's chain.
  const payload = await signAndBuildPayload({ account, requirements })

  // Step 3: settle.
  const settle = await client.submitX402Payment(
    challenge.reservationId,
    encodeHeader(payload),
  )

  return {
    ok: settle.status === 200,
    status: settle.status,
    body: settle.body,
    challenge: {
      reservation_id: challenge.reservationId,
      summary: challenge.summary,
      amount_atomic: requirements.amount,
      amount_jpyc: formatJpycFromAtomic(requirements.amount),
      network: requirements.network,
      asset: requirements.asset,
      pay_to: requirements.payTo,
    },
  }
}
