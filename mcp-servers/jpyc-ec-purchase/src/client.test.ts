import { describe, expect, it } from "vitest"
import { EcClient, formatJpycFromAtomic, parseJpycToAtomic } from "./client.js"

function clientWith(fetchImpl: typeof fetch): EcClient {
  return new EcClient({ baseUrl: "https://stg-ec.test", fetch: fetchImpl })
}

const checkoutBody = {
  shop_id: "11111111-1111-1111-1111-111111111111",
  items: [{ product_id: "22222222-2222-2222-2222-222222222222", quantity: 1 }],
  customer_email: "qa@example.com",
}

describe("EcClient.requestX402Challenge", () => {
  it("hits /api/v1/checkout and parses the 402 challenge + summary", async () => {
    let capturedUrl = ""
    let capturedBody: unknown
    const client = clientWith(async (url, init) => {
      capturedUrl = String(url)
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          ok: false,
          data: {
            reservation_id: "res_abc123",
            expires_at_unix_ms: 1731486100000,
            summary: { subtotal_jpyc: "5000", total_jpyc: "5500" },
          },
        }),
        { status: 402, headers: { "PAYMENT-REQUIRED": "eyJ4NDAyVmVyc2lvbiI6Mn0" } },
      )
    })
    const challenge = await client.requestX402Challenge(checkoutBody)
    // Targets the unified cart endpoint, not the legacy per-product one.
    expect(capturedUrl).toBe("https://stg-ec.test/api/v1/checkout")
    expect(capturedBody).toEqual(checkoutBody)
    expect(challenge.reservationId).toBe("res_abc123")
    expect(challenge.summary.total_jpyc).toBe("5500")
    expect(challenge.paymentRequiredHeader).toBe("eyJ4NDAyVmVyc2lvbiI6Mn0")
  })

  it("throws when the server does not return 402", async () => {
    const client = clientWith(
      async () =>
        new Response(JSON.stringify({ ok: false, error: { code: "shop_mismatch" } }), {
          status: 400,
        }),
    )
    await expect(client.requestX402Challenge(checkoutBody)).rejects.toThrow(/expected 402/)
  })

  it("throws when the 402 lacks the PAYMENT-REQUIRED header", async () => {
    const client = clientWith(
      async () =>
        new Response(JSON.stringify({ data: { reservation_id: "res_x" } }), { status: 402 }),
    )
    await expect(client.requestX402Challenge(checkoutBody)).rejects.toThrow(/PAYMENT-REQUIRED/)
  })
})

describe("EcClient.submitX402Payment", () => {
  it("hits /api/v1/checkout with the PAYMENT-SIGNATURE header", async () => {
    let capturedUrl = ""
    let capturedSig = ""
    let capturedBody: unknown
    const client = clientWith(async (url, init) => {
      capturedUrl = String(url)
      capturedSig = String((init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"])
      capturedBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({ ok: true, data: { order_id: "ord1", tx_hash: "0xabc" } }),
        { status: 200, headers: { "PAYMENT-RESPONSE": "eyJzdWNjZXNzIjp0cnVlfQ" } },
      )
    })
    const result = await client.submitX402Payment("res_abc123", "SIGHEADER")
    expect(capturedUrl).toBe("https://stg-ec.test/api/v1/checkout")
    expect(capturedSig).toBe("SIGHEADER")
    expect(capturedBody).toEqual({ reservation_id: "res_abc123" })
    expect(result.status).toBe(200)
    expect(result.paymentResponseHeader).toBe("eyJzdWNjZXNzIjp0cnVlfQ")
  })
})

describe("JPYC atomic helpers", () => {
  it("formatJpycFromAtomic trims trailing zeros", () => {
    expect(formatJpycFromAtomic("5500000000000000000000")).toBe("5500")
    expect(formatJpycFromAtomic("0")).toBe("0")
  })
  it("parseJpycToAtomic round-trips", () => {
    expect(formatJpycFromAtomic(parseJpycToAtomic("1234"))).toBe("1234")
  })
})
