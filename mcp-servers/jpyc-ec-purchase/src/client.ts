/**
 * Tiny client for the JPYC EC Platform public API.
 *
 * Wraps:
 *   - GET  /api/v1/shops              — list shops
 *   - GET  /api/v1/products?shop=     — list products
 *   - GET  /api/v1/products/:id       — product detail
 *   - GET  /api/v1/orders?customer_address=  — order history
 *   - POST /api/v1/products/:id/checkout (x402 two-shot)
 */

import { type Address, type Hex, parseUnits } from "viem"

export interface EcClientOptions {
  /** Base URL of the EC API, e.g. https://ec.jpyc-service.com */
  baseUrl: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export class EcClient {
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: EcClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "")
    this.fetchFn = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  async listShops() {
    return this.get("/api/v1/shops")
  }

  /**
   * List products for one shop. The EC API has no global product listing —
   * products live under `/api/v1/shops/:slug/products` only. Callers that
   * want cross-shop search should list shops first, then iterate.
   */
  async listProductsInShop(shopSlug: string) {
    return this.get(`/api/v1/shops/${encodeURIComponent(shopSlug)}/products`)
  }

  async getProduct(productId: string) {
    return this.get(`/api/v1/products/${encodeURIComponent(productId)}`)
  }

  async getProductReviews(productId: string) {
    return this.get(`/api/v1/products/${encodeURIComponent(productId)}/reviews`)
  }

  async getNftDiscounts(shopSlug: string) {
    return this.get(`/api/v1/shops/${encodeURIComponent(shopSlug)}/nft-discounts`)
  }

  async getCategories() {
    return this.get(`/api/v1/categories`)
  }

  async getOrders(customerAddress: Address) {
    return this.get(`/api/v1/orders?customer_address=${encodeURIComponent(customerAddress)}`)
  }

  /** Step 1 of x402 checkout — request a payment challenge. */
  async requestX402Challenge(
    productId: string,
    body: {
      quantity: number
      preferred_chain_id?: number
      variant_selections?: Record<string, string>
      shipping?: Record<string, string>
      customer_note?: string
    },
  ): Promise<X402Challenge> {
    const url = `${this.baseUrl}/api/v1/products/${encodeURIComponent(productId)}/checkout`
    const res = await this.rawPost(url, body, {})
    if (res.status !== 402) {
      const text = await res.text()
      throw new Error(`expected 402, got ${res.status}: ${text.slice(0, 240)}`)
    }
    const required = res.headers.get("PAYMENT-REQUIRED")
    if (!required) {
      throw new Error("missing PAYMENT-REQUIRED header in 402 response")
    }
    const json = (await res.json()) as { data?: { reservation_id?: string; expires_at_unix_ms?: number } }
    if (!json.data?.reservation_id) {
      throw new Error("response body missing data.reservation_id")
    }
    return {
      reservationId: json.data.reservation_id,
      expiresAtUnixMs: json.data.expires_at_unix_ms ?? 0,
      paymentRequiredHeader: required,
    }
  }

  /** Step 2 of x402 checkout — submit signed payload. */
  async submitX402Payment(
    productId: string,
    reservationId: string,
    paymentSignatureHeader: string,
  ): Promise<X402SettlementResult> {
    const url = `${this.baseUrl}/api/v1/products/${encodeURIComponent(productId)}/checkout`
    const res = await this.rawPost(url, { reservation_id: reservationId }, {
      "PAYMENT-SIGNATURE": paymentSignatureHeader,
    })
    const text = await res.text()
    let json: unknown = {}
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`non-JSON response (status=${res.status}): ${text.slice(0, 240)}`)
    }
    return {
      status: res.status,
      paymentResponseHeader: res.headers.get("PAYMENT-RESPONSE"),
      body: json,
    }
  }

  private async get(path: string) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchFn(url, { signal: ctrl.signal })
      const text = await res.text()
      if (!res.ok) {
        throw new Error(`GET ${path} failed (status=${res.status}): ${text.slice(0, 240)}`)
      }
      return text ? JSON.parse(text) : {}
    } finally {
      clearTimeout(t)
    }
  }

  private async rawPost(url: string, body: unknown, extraHeaders: Record<string, string>) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      return await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(t)
    }
  }
}

export interface X402Challenge {
  reservationId: string
  expiresAtUnixMs: number
  /** base64url JSON of x402 PaymentRequired. */
  paymentRequiredHeader: string
}

export interface X402SettlementResult {
  status: number
  paymentResponseHeader: string | null
  body: unknown
}

/** JPYC has 18 decimals. Helper for tools that show prices in JPYC strings. */
export function formatJpycFromAtomic(atomic: string | bigint): string {
  const n = typeof atomic === "bigint" ? atomic : BigInt(atomic)
  const whole = n / 10n ** 18n
  const frac = n % 10n ** 18n
  if (frac === 0n) return whole.toString()
  // Trim trailing zeros so "1500000000000000000000" -> "1500"
  const fracStr = frac.toString().padStart(18, "0").replace(/0+$/, "")
  return `${whole}${fracStr ? "." + fracStr : ""}`
}

/** Convert "1500" or "1500.5" JPYC to atomic units. */
export function parseJpycToAtomic(amount: string): bigint {
  return parseUnits(amount, 18)
}

export type { Address, Hex }
