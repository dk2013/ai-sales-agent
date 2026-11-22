// MCP client used by the agent worker: starts the MCP server as a child process (stdio transport),
// lists its tools and calls them. The same server works with Claude Desktop or Cursor.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
}

export interface McpConnection {
  tools: McpTool[];
  call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  close(): Promise<void>;
}

export async function connectMcp(): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: process.execPath, // the same node binary
    args: ["--import", "tsx", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    stderr: "inherit",
  });
  const client = new Client({ name: "ai-sales-agent-worker", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();

  return {
    tools: tools as McpTool[],
    async call(name, args) {
      const result = await client.callTool({ name, arguments: args });
      const content = (result.content as { type: string; text?: string }[]) ?? [];
      return { text: content.map((c) => c.text ?? "").join("\n"), isError: Boolean(result.isError) };
    },
    close: () => client.close(),
  };
}
