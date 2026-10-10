// Spawns the server over stdio, runs initialize + tools/list, and (optionally) calls tools.
// Usage: node test/stdio-test.mjs [toolName jsonArgs]...
// Tests the bundled dist/sensorpro-mcp.js by default; set SERVER_ENTRY=src/index.js to test the unbundled source.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve(here, "..", process.env.SERVER_ENTRY || "dist/sensorpro-mcp.js")],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "sensorpro-test", version: "0.0.1" });
await client.connect(transport);
const info = client.getServerVersion();
console.log("initialize OK ->", JSON.stringify(info), "protocol caps:", JSON.stringify(client.getServerCapabilities()));
const { tools } = await client.listTools();
console.log(`tools/list OK -> ${tools.length} tools`);
for (const t of tools) console.log(" -", t.name, Object.keys(t.inputSchema?.properties || {}).join(","));
if (tools.length < 25) { console.error(`FAIL: expected 25 tools, got ${tools.length}`); process.exitCode = 1; }
const calls = process.argv.slice(2);
for (let i = 0; i < calls.length; i += 2) {
  const name = calls[i];
  const args = calls[i + 1] ? JSON.parse(calls[i + 1]) : {};
  const r = await client.callTool({ name, arguments: args });
  console.log(`\ncallTool ${name} isError=${!!r.isError}:\n${r.content.map((c) => c.text).join("\n").slice(0, 3000)}`);
}
await client.close();
