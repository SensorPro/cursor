# SensorPro for Cursor

Cursor plugin for [SensorPro](https://sensorpro.eu), the EU email marketing platform. It lets your agent work with your SensorPro account through SensorPro's REST API:

- Look up, add, update, tag and unsubscribe contacts, and handle GDPR erase requests
- Find your most recently engaged contacts
- Create campaigns, add your own HTML designs and segments, and send test or live broadcasts after you approve them
- Report on campaign results, link clicks and broadcast status
- Send one-off transactional email through SensorPro's relay

The plugin bundles a local MCP server (`sensorpro`, 25 tools) and four skills.

## Install

1. In Cursor, open **Customize** (or **Settings → Plugins**) and search for **SensorPro**.
2. Click **Install**.
3. Set the four variables below (Dashboard → **Plugins → SensorPro → Configure**).

Requires Node.js 18.17 or newer on the machine running Cursor. The MCP server starts with `npx`.

## Variables

| Variable | Secret | Where to find it |
| --- | --- | --- |
| `SENSORPRO_API_KEY` | yes | In SensorPro open **API > API keys** and copy **"Sensorpro rest API default key"**. |
| `SENSORPRO_ORG` | no | Your organization name, exactly as you enter it on the SensorPro sign-in page. |
| `SENSORPRO_USER` | no | A SensorPro **API user**. API users are separate from normal login users, and a normal login cannot use the API. Ask your admin or support@sensorpro.net if you do not have one. |
| `SENSORPRO_PASSWORD` | yes | Password of that API user. |

The values are stored by Cursor, not in this repository. The server never prints credentials or session tokens, and redacts them from error messages.

### IP whitelisting

SensorPro API keys can be restricted to specific IP addresses. If yours is, the machine running Cursor must be on the key's whitelist. Otherwise every call fails with a clear "IP address is not whitelisted" message that shows the IP SensorPro saw. Add that IP under **API > API keys > "Sensorpro rest API default key"**, or ask support@sensorpro.net. Cloud or remote agents usually come from changing IP addresses, so a fixed whitelist only works for machines with a stable IP.

### Account lockout

SensorPro locks an account after 3 failed sign-ins. After one rejected sign-in the server refuses to try again until you fix the credentials and restart it, or call `sensorpro_check_connection` with `force: true`.

## Safety: nothing is sent without your approval

- `sensorpro_add_broadcast`, `sensorpro_send_email` and `sensorpro_trigger_email` send real email. Each one requires `confirmSend: true`, and the skills tell the agent to show you the recipients, subject, sender and content and wait for your explicit OK first.
- Delete, GDPR forget, clear-tag and opt-in changes are flagged as destructive, and the skills ask for confirmation.
- `sensorpro_get_metrics_from_queue` permanently consumes SensorPro's metrics export queue (each record can be fetched once). The skills avoid it. Only use it if you own that integration.

## Skills

| Skill | Use it for |
| --- | --- |
| `sensorpro-recent-engagement` | Find contacts who opened, clicked or replied recently, using `LastReponseDate` |
| `sensorpro-contacts` | Look up, add, update, tag, unsubscribe or erase contacts |
| `sensorpro-campaign-build` | Campaign, design and segment, then an approved test or live send |
| `sensorpro-campaign-results` | Opens, clicks, bounces, opt-outs, link clicks and broadcast status |

## SensorPro API tips

These are built into the skills, and are useful to know if you call the tools yourself:

- **Characters.** Campaign titles, design descriptions, segment names and plain-text messages are rejected if they contain `+ ( ) : ·`, long dashes or hyphens. Use letters, digits, spaces, commas and full stops. Design names must be letters and digits only.
- **Segments take 3 to 6 minutes to build.** Until then the selected count (`SelectedTot`) is not reliable. Check it before sending.
- **Test segments.** Turn `reBuildBeforeBroadcast` off. A segment with rebuild on cannot be reused in another broadcast.
- **Designs** can be added through the API but not read or edited. To change one, add a new design with a new name.
- **Unsubscribe.** Put the unsubscribe link on the word "Unsubscribe", and include `{unsubscribe}` in the text version. SensorPro adds its "powered by" footer automatically, so don't add your own.
- **Recent activity.** The contact field is `LastReponseDate` (SensorPro's spelling).

## Tools

Connection: `sensorpro_check_connection`.
Contacts: `sensorpro_get_contacts`, `sensorpro_list_contacts`, `sensorpro_upsert_contacts`, `sensorpro_get_async_upsert_status`, `sensorpro_change_optout_status`, `sensorpro_change_contact_status`, `sensorpro_delete_contacts`, `sensorpro_forget_contacts`, `sensorpro_clear_tag`.
Campaigns: `sensorpro_list_campaigns`, `sensorpro_get_campaign_results`, `sensorpro_get_campaign_link_results`, `sensorpro_get_broadcast_status`, `sensorpro_create_campaign`, `sensorpro_add_design`, `sensorpro_add_segment`, `sensorpro_add_broadcast`, `sensorpro_trigger_email`, `sensorpro_get_metrics_from_queue`.
Email: `sensorpro_send_email`.
Imports: `sensorpro_get_import_status`, `sensorpro_execute_ftp_import`.
Account: `sensorpro_add_sub_organization`, `sensorpro_add_update_user`.

## MCP configuration

```json
{
  "mcpServers": {
    "sensorpro": {
      "command": "npx",
      "args": ["-y", "github:OWNER/REPO#v0.1.0"],
      "env": {
        "SENSORPRO_API_KEY": "${SENSORPRO_API_KEY}",
        "SENSORPRO_ORG": "${SENSORPRO_ORG}",
        "SENSORPRO_USER": "${SENSORPRO_USER}",
        "SENSORPRO_PASSWORD": "${SENSORPRO_PASSWORD}"
      }
    }
  }
}
```

Optional environment variables for manual setups: `SENSORPRO_BASE_URL` (default `https://apinie.sensorpro.net`), `SENSORPRO_TIMEOUT_MS` (default 60000), `SENSORPRO_DEBUG=1` (logs to stderr, never logs credentials).

## Repository layout

```text
.cursor-plugin/plugin.json   plugin manifest and variables schema
mcp.json                     MCP server definition
skills/                      agent skills (SKILL.md each)
assets/logo.png              logo
server/                      MCP server source, tests and bundled build
scripts/validate.mjs         offline checks for the plugin submission checklist
scripts/set-owner.sh         fills in the GitHub owner and repo placeholder
package.json                 lets npx run the bundled server from GitHub
```

## Development

```sh
cd server
npm install          # dev dependencies only (esbuild, MCP SDK, zod)
npm run build        # bundles src/ into dist/sensorpro-mcp.js (commit the result)
npm test             # stdio initialize + tools/list, plus offline fake-API tests
cd .. && node scripts/validate.mjs
```

To try the plugin locally, copy this folder to `~/.cursor/plugins/local/sensorpro` and reload Cursor.

## Support

- SensorPro: [sensorpro.eu](https://sensorpro.eu), support@sensorpro.net
- API reference: [sensorpro.net/api](https://sensorpro.net/api/)

## License

MIT
