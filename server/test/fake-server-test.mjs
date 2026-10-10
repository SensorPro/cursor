// Offline test: points the MCP server at a local fake SensorPro to exercise sign-in, token reuse, lockout guard and IP error.
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
let signins = 0, mode = process.argv[2] || "ok";
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const R = (e = []) => ({ RequestId: "r", ErrorMessages: e, StatusMesssages: [], TotalStatusMessages: 0, TotalErrors: e.length });
    if (req.url.startsWith("/auth/sys/signin")) {
      signins++;
      if (mode === "badcreds") { res.statusCode = 401; return res.end(JSON.stringify({ ExpiresIn: 0, Token: "00000000-0000-0000-0000-000000000000", Result: R([{ Code: "SysLoginFailure", Description: "Login is not valid." }, { Code: "SysLoginLockoutWarning", Description: "1 Failed login attempts. Your account will be locked after 3 failed attempts." }]) })); }
      if (mode === "ip") { res.statusCode = 401; return res.end(JSON.stringify({ ExpiresIn: 0, Token: "00000000-0000-0000-0000-000000000000", Result: R([{ Code: "IPNotFoundAPIKey", Description: "IP address must be whitelisted to use this service 1.2.3.4. API key 9f89c84a559f573636a47ff8daed0d33", Sequence: 0 }]) })); }
      return res.end(JSON.stringify({ ExpiresIn: 3600, APIEndpoint: "https://apinie.sensorpro.net/", Token: "11111111-2222-3333-4444-555555555555", Result: R() }));
    }
    res.end(JSON.stringify({ Contacts: [{ ContactId: 1, PersonalEMail: JSON.parse(b || "{}").EmailAddress?.[0] }], Result: R(), _path: req.method + " " + req.url.replace(/[0-9a-f-]{36}$/, "[token]"), _body: JSON.parse(b || "null") }));
  });
});
await new Promise((r) => srv.listen(0, r));
const t = new StdioClientTransport({ command: process.execPath, args: [new URL("../" + (process.env.SERVER_ENTRY || "dist/sensorpro-mcp.js"), import.meta.url).pathname],
  env: { PATH: process.env.PATH, SENSORPRO_BASE_URL: `http://127.0.0.1:${srv.address().port}`, SENSORPRO_API_KEY: "k".repeat(32), SENSORPRO_ORG: "o", SENSORPRO_USER: "u", SENSORPRO_PASSWORD: "p".repeat(8) }, stderr: "ignore" });
const c = new Client({ name: "t", version: "0" }); await c.connect(t);
for (let i = 0; i < 3; i++) {
  const r = await c.callTool({ name: "sensorpro_get_contacts", arguments: { emails: ["a@b.c"] } });
  console.log(`call ${i + 1} isError=${!!r.isError}: ${r.content[0].text.slice(0, 260).replace(/\n/g, " ")}`);
}
console.log("signin attempts made:", signins);
await c.close(); srv.close();
