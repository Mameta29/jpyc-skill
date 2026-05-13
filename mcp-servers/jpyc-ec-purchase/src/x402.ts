/**
 * Minimal x402 v2 helpers — embedded here so the MCP server has zero npm
 * dependencies on @jpyc-x402/* packages until those are published. Once
 * available on npm, replace this file with a re-export from
 * `@jpyc-x402/client` and `@jpyc-x402/shared`.
 */

import { randomBytes } from "node:crypto"
import {
  type Address,
  type Hex,
  type LocalAccount,
  type TypedDataDomain,
} from "viem"

export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const

export interface PaymentRequirements {
  scheme: "exact"
  network: string
  amount: string
  asset: Address
  payTo: Address
  maxTimeoutSeconds: number
  extra: {
    assetTransferMethod: "eip3009"
    name: string
    version: string
    decimals?: number
    symbol?: string
  }
}

export interface PaymentRequired {
  x402Version: 2
  error?: string
  resource: { url: string; description?: string; mimeType?: string }
  accepts: PaymentRequirements[]
  extensions?: Record<string, unknown>
}

export interface PaymentPayload {
  x402Version: 2
  resource?: { url: string; description?: string; mimeType?: string }
  accepted: PaymentRequirements
  payload: {
    signature: Hex
    authorization: {
      from: Address
      to: Address
      value: string
      validAfter: string
      validBefore: string
      nonce: Hex
    }
  }
}

export function decodeHeader<T = unknown>(header: string): T {
  const normalised = header.replace(/-/g, "+").replace(/_/g, "/")
  const padding = normalised.length % 4 === 0 ? "" : "=".repeat(4 - (normalised.length % 4))
  const json = Buffer.from(normalised + padding, "base64").toString("utf8")
  return JSON.parse(json) as T
}

export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url")
}

export function generateRandomNonce(): Hex {
  const bytes = randomBytes(32)
  let hex = "0x"
  for (const b of bytes) hex += b.toString(16).padStart(2, "0")
  return hex as Hex
}

export function caip2ToChainId(caip2: string): number {
  const m = /^eip155:(\d+)$/.exec(caip2)
  if (!m) throw new Error(`unsupported network: ${caip2}`)
  return Number(m[1])
}

export function buildJpycDomain(requirements: PaymentRequirements): TypedDataDomain {
  return {
    name: requirements.extra.name,
    version: requirements.extra.version,
    chainId: caip2ToChainId(requirements.network),
    verifyingContract: requirements.asset,
  }
}

export interface SignAndBuildPayloadOptions {
  account: LocalAccount
  requirements: PaymentRequirements
  /** Override validity window (seconds since epoch). */
  validAfterSeconds?: bigint
  validBeforeSeconds?: bigint
}

/**
 * Sign an EIP-3009 transferWithAuthorization for the given x402 PaymentRequirements
 * and produce a v2 PaymentPayload ready to put in a `PAYMENT-SIGNATURE` header.
 */
export async function signAndBuildPayload(
  opts: SignAndBuildPayloadOptions,
): Promise<PaymentPayload> {
  const requirements = opts.requirements
  const value = BigInt(requirements.amount)
  const nowSec = BigInt(Math.floor(Date.now() / 1000))
  const validAfter = opts.validAfterSeconds ?? 0n
  const validBefore =
    opts.validBeforeSeconds ?? nowSec + BigInt(requirements.maxTimeoutSeconds)
  const nonce = generateRandomNonce()
  const signature = (await opts.account.signTypedData({
    domain: buildJpycDomain(requirements),
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: opts.account.address,
      to: requirements.payTo,
      value,
      validAfter,
      validBefore,
      nonce,
    },
  })) as Hex

  return {
    x402Version: 2,
    accepted: requirements,
    payload: {
      signature,
      authorization: {
        from: opts.account.address,
        to: requirements.payTo,
        value: value.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
    },
  }
}
