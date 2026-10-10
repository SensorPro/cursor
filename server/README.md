# sensorpro-mcp

MCP server (stdio) for the [SensorPro](https://sensorpro.eu) email marketing REST API. It has 25 tools for contacts, campaigns, segments, designs, broadcasts, relay email and imports. It ships as the MCP server of the SensorPro Cursor plugin (see the repository root).

## Run

```sh
# from GitHub, without npm publishing
npx -y github:OWNER/REPO#v0.1.0

# from a checkout
node server/dist/sensorpro-mcp.js
```

`dist/sensorpro-mcp.js` is a single bundled file with no runtime dependencies (Node 18.17+).

## Environment

Required: `SENSORPRO_API_KEY` (API > API keys > "Sensorpro rest API default key"), `SENSORPRO_ORG`, `SENSORPRO_USER` (an API user, not a normal login), `SENSORPRO_PASSWORD`.

Optional: `SENSORPRO_BASE_URL` (default `https://apinie.sensorpro.net`), `SENSORPRO_TIMEOUT_MS` (60000), `SENSORPRO_DEBUG=1` (logs to stderr, never prints credentials or tokens).

## Behaviour

- Signs in once and caches the token until shortly before `ExpiresIn`. Signs in again on 401 or an expired session. Send tools only retry on HTTP 401.
- After a bad-credential sign-in it refuses further sign-ins (SensorPro locks the account after 3 failed logins) until restart or `sensorpro_check_connection {force: true}`.
- IP whitelist rejections are explained, including the IP SensorPro saw and where to whitelist it.
- `sensorpro_send_email`, `sensorpro_add_broadcast` and `sensorpro_trigger_email` require `confirmSend: true`.

## Develop

```sh
npm install
npm run build   # src/ -> dist/sensorpro-mcp.js (esbuild)
npm test        # initialize + tools/list against dist, plus offline fake-API tests (ok, badcreds, ip)
SERVER_ENTRY=src/index.js npm test   # same tests against the unbundled source
node test/stdio-test.mjs sensorpro_check_connection '{}'   # live call, needs real credentials in env
```

To publish to npm later: `npm publish` from this folder (`prepublishOnly` builds and tests first).
