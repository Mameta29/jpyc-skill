/**
 * MCP server wiring. Registers the EC purchase tools (search_products,
 * get_product, get_order_status, purchase_product) on a Server instance and
 * exposes a stdio transport via `bin.ts`.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { defaultDeps, tools, type ToolDeps } from "./tools.js"

export function buildEcPurchaseServer(opts: { deps?: ToolDeps } = {}) {
  const deps = opts.deps ?? defaultDeps()

  const server = new Server(
    { name: "jpyc-ec-purchase-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object" },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const tool = (tools as Record<string, (typeof tools)[keyof typeof tools]>)[name]
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] }
    }
    const parsed = tool.inputSchema.safeParse(args ?? {})
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          { type: "text", text: `invalid arguments for ${name}: ${parsed.error.message}` },
        ],
      }
    }
    try {
      const result = await tool.handler(parsed.data as never, deps)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              result,
              (_k, v) => (typeof v === "bigint" ? v.toString() : v),
              2,
            ),
          },
        ],
      }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `tool ${name} failed: ${(err as Error).message}` }],
      }
    }
  })

  return server
}
