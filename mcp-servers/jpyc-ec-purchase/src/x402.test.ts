import { describe, expect, it } from "vitest"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { hashTypedData, recoverAddress, type Hex } from "viem"
import {
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  buildJpycDomain,
  decodeHeader,
  encodeHeader,
  signAndBuildPayload,
  type PaymentRequirements,
} from "./x402.js"

const sampleRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:80002",
  amount: "5000000000000000000",
  asset: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 90,
  extra: {
    assetTransferMethod: "eip3009",
    name: "JPY Coin",
    version: "1",
    decimals: 18,
    symbol: "JPYC",
  },
}

describe("x402 helpers", () => {
  it("encodeHeader / decodeHeader round-trip", () => {
    const payload = { hello: "world", n: 42 }
    expect(decodeHeader(encodeHeader(payload))).toEqual(payload)
  })

  it("signAndBuildPayload produces a payload that recovers to the signer", async () => {
    const sk = generatePrivateKey()
    const account = privateKeyToAccount(sk)
    const payload = await signAndBuildPayload({
      account,
      requirements: sampleRequirements,
      validAfterSeconds: 0n,
      validBeforeSeconds: 9999999999n,
    })
    expect(payload.x402Version).toBe(2)
    expect(payload.payload.authorization.from.toLowerCase()).toBe(account.address.toLowerCase())

    const digest = hashTypedData({
      domain: buildJpycDomain(sampleRequirements),
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: account.address,
        to: sampleRequirements.payTo,
        value: 5_000_000_000_000_000_000n,
        validAfter: 0n,
        validBefore: 9999999999n,
        nonce: payload.payload.authorization.nonce as Hex,
      },
    })
    const recovered = await recoverAddress({
      hash: digest,
      signature: payload.payload.signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})
