# Changelog

All notable changes to this plugin will be documented here.

## 0.1.0 (initial release)

- `sensorpro` MCP server (stdio, Node 18.17+) with 25 tools covering contacts, campaigns, designs, segments, broadcasts, relay email, imports, tags, sub-organizations and users.
- Runs with `npx -y github:sensorpro/cursor#v0.1.0`. The server is bundled into a single committed file (`server/dist/sensorpro-mcp.js`) with no runtime dependencies to install.
- Four skills: `sensorpro-recent-engagement`, `sensorpro-contacts`, `sensorpro-campaign-build`, `sensorpro-campaign-results`.
- Safety: send tools require `confirmSend: true`. Sign-in stops retrying after a bad-credential response, because SensorPro locks the account after 3 failed logins. Credentials and tokens are redacted from every tool result.
- Plugin variables: `SENSORPRO_API_KEY`, `SENSORPRO_ORG`, `SENSORPRO_USER`, `SENSORPRO_PASSWORD`.
