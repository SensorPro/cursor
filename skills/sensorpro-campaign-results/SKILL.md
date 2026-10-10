---
name: sensorpro-campaign-results
description: Report on SensorPro campaign performance, including sends, deliveries, opens, clicks, bounces, opt-outs and per-link clicks, and check whether a broadcast has finished. Use when the user asks how a campaign or newsletter did, wants a results summary, or asks about broadcast status.
---

# SensorPro: campaign results

## When to use

- "How did last week's newsletter do?"
- Comparing recent campaigns
- Checking whether a broadcast is queued, sending or finished

## Instructions

1. Find the campaign. If the user does not give a campaign id, call `sensorpro_list_campaigns` with a `fromDate` and `toDate` (yyyy-mm-dd) around when it was sent. It returns id, title, subject, total sent and last broadcast date.
2. Get headline stats with `sensorpro_get_campaign_results` (`campaignId`): sent, delivered, opens, clicks, bounces, opt-outs, spam reports and percentages, per segment and broadcast.
3. For link performance call `sensorpro_get_campaign_link_results` and list the top links by unique clicks.
4. For delivery progress call `sensorpro_get_broadcast_status`. Status codes: -10 Error, 2 Queued, 10 Ready To Send, 20 Scheduled, 30 Sending, 40 Finished. Numbers are still moving until the broadcast is Finished, so say so.
5. Summarise in a few lines: audience size, delivery rate, unique open rate, click rate, opt-outs and bounces, then the top 3 links. Compare with previous campaigns only if the user asks or you have fetched them.

## Do not

- Do not call `sensorpro_get_metrics_from_queue` for reporting. It permanently consumes SensorPro's metrics export queue (one-time read), which can break the customer's own data integrations.
