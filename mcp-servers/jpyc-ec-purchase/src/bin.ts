#!/usr/bin/env node
/**
 * stdio launcher for the JPYC EC purchase MCP server.
 *
 * Claude Desktop / Cursor MCP config:
 *
 *   {
 *     "mcpServers": {
 *       "jpyc-ec-purchase": {
 *         "command": "npx",
 *         "args": ["-y", "@jpyc-skill/ec-purchase-mcp"],
 *         "env": {
 *           "BUYER_PRIVATE_KEY": "0x...",
 *           "EC_API_URL": "https://ec.jpyc-service.com"
 *         }
 *       }
 *     }
 *   }
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { buildEcPurchaseServer } from "./server.js"

async function main() {
  const server = buildEcPurchaseServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error("[jpyc-ec-purchase-mcp] fatal:", err)
  process.exit(1)
})
