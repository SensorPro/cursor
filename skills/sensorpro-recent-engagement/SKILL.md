---
name: sensorpro-recent-engagement
description: Find the SensorPro contacts who engaged most recently (opened, clicked or replied), for example to build a re-engagement list, a VIP list or a small test audience. Use when the user asks for recent responders, most engaged contacts, or who interacted lately.
---

# SensorPro: recent engagement

## When to use

- "Who are our most engaged contacts?" or "who responded in the last 30 days?"
- Picking a small, real audience for a test campaign
- Building a list to tag or segment for a follow-up

## Instructions

1. Call `sensorpro_check_connection` once if this is the first SensorPro call in the session. If it reports an IP whitelist or credential problem, stop and explain the fix (see the README). Do not retry a failed sign-in: SensorPro locks the account after 3 failed logins.
2. Page through contacts with `sensorpro_list_contacts`, `filter: "all"`, a `pageSize` of up to 1000 and only the fields you need, for example:
   `fields: ["personalemail", "firstname", "lastname", "lastreponsedate", "status", "optoutstatus"]`
   Keep incrementing `page` until a page comes back empty.
3. Use the contact field `LastReponseDate` (SensorPro spells it without the "s") as the recent-activity signal. Sort descending, drop empty dates, and keep only contacts that are active (`Status` 0) and subscribed (`OptOut` 0).
4. Report the top results as a short table (email, name, last response date) plus the total count found. Do not dump the whole database into chat.
5. If the user wants to act on the list, hand over to `sensorpro-contacts` (tag them) or `sensorpro-campaign-build` (segment them).

## Do not

- Do not use `sensorpro_get_metrics_from_queue` to measure engagement. It consumes SensorPro's export queue: metrics it returns are marked done and cannot be fetched again, which breaks any integration that relies on that queue.
- Do not change opt-out or status values while exploring.
