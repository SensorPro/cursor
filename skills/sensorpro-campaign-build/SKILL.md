---
name: sensorpro-campaign-build
description: Build a SensorPro email campaign end to end. Creates the campaign, adds an HTML design and a segment, then sends a test or live broadcast only after explicit user approval. Use when the user wants to create, design, test or send a SensorPro campaign or newsletter.
---

# SensorPro: build and send a campaign

## When to use

- "Create a campaign for our October newsletter"
- "Put this HTML into SensorPro and send me a test"
- "Send this campaign to the people who opened last month"

## Flow

`sensorpro_create_campaign` → `sensorpro_add_design` → `sensorpro_add_segment` → wait for the segment to build → **user approval** → `sensorpro_add_broadcast`

Nothing is sent until `sensorpro_add_broadcast`. Every step before it is safe to repeat.

## Text rules (SensorPro rejects these)

SensorPro's API rejects some characters in campaign titles, design descriptions, segment names and plain-text messages: `+ ( ) : ·`, long dashes (`—` and `–`) and hyphens. Stick to letters, digits, spaces, commas and full stops in those fields, for example `October Newsletter 2026 Test`. Design `name` must be letters and digits only, and unique (for example `Oct2026NewsletterV1`). Subjects and HTML bodies are not affected.

## Instructions

1. **Campaign.** `sensorpro_create_campaign` with a plain `title` and the user's name as `manager`. Leave `serviceMessage: false`. True ignores opt-outs and is only for genuine service mail. Note the returned campaign id.
2. **Design.** `sensorpro_add_design` with `designType: "html"`, raw `html` (the tool encodes it) and a `textMessage` text version.
   - Put the unsubscribe link on the word **Unsubscribe**. In the text version include `{unsubscribe}`.
   - Do not add your own "powered by SensorPro" footer. SensorPro adds it automatically.
   - Designs can be added through the API but not read or edited. To reuse an existing SensorPro template, ask the user to paste or export its HTML, then build the new design from that. To change a design, add a new one with a new name and use its id.
   - Keep the returned `DesignIdHTML` (and `DesignIdTXT` if any).
3. **Segment.** `sensorpro_add_segment`:
   - Test send: `segmentType: "custom_rule"` with a rule such as `{ field: "Personalemail", condition: "=", value: "<test address>" }`, or `segmentType: "import"` with a tag that only holds test contacts.
   - Set `reBuildBeforeBroadcast: false` for test segments. A segment with rebuild on cannot be reused in another broadcast.
   - Keep `activeOnly: true`.
4. **Wait for the build.** New segments take about 3 to 6 minutes to build. Until then the selected count (`SelectedTot`, shown per segment in `sensorpro_get_campaign_results`) is not reliable. Wait, re-check, and make sure the count is what you expect (for example 1 for a single test address) before going on.
5. **Ask for approval.** Show the user exactly what will go out: campaign id and title, segment name and recipient count, subject, from address (must be an authorised sender in SensorPro), reply-to, design name, and send time (now, or a UTC schedule). Wait for an explicit yes. A general instruction to "set up a campaign" is not approval to send.
6. **Send.** Only then call `sensorpro_add_broadcast` with `confirmSend: true`, the `segmentId`, `designHtmlId`, `subject` and `fromEmail`. Use `scheduleUtc` for a future send.
7. **Confirm.** Check `sensorpro_get_broadcast_status` until it shows 40 (Finished) or an error, and report back.

## Other send tools

`sensorpro_send_email` (one-off relay email to up to 20 recipients) and `sensorpro_trigger_email` (triggered campaign to one contact) also send real email. Use the same approval step and `confirmSend: true`. Never set `confirmSend` without the user's explicit OK for those exact recipients and that exact content.
