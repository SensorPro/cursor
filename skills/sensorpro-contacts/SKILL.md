---
name: sensorpro-contacts
description: Look up, add, update, tag, unsubscribe or remove SensorPro contacts safely. Use when the user asks to find a contact, import or sync a few contacts, apply a tag or list, change subscription status, or handle a GDPR erase request.
---

# SensorPro: contacts

## When to use

- Looking up one or more contacts by email, external id (`ExtLinkId`) or `ContactId`
- Adding or updating a small batch of contacts, or tagging them
- Unsubscribing someone, or handling a delete or GDPR "forget me" request

## Instructions

1. Look up with `sensorpro_get_contacts` (emails, extLinkIds or contactIds). Keys that are not found come back as `GetFailed` errors while found contacts are still returned. Report both.
2. Add or update with `sensorpro_upsert_contacts`:
   - Default `mode: "update_add"`, matched on `updateByKey: "email"`.
   - Use `tags` to put contacts on a list or tag. A tag or import name is what an `import` segment selects on later.
   - For more than a few hundred records use `mode: "update_add_async"`, then poll `sensorpro_get_async_upsert_status` with the returned RequestId.
   - Keep `sendWelcomeEmail: false` unless the user explicitly wants new contacts to get the signup welcome email. That sends real email, so confirm first.
3. Subscription status: `sensorpro_change_optout_status` with `opted_out`, `pending_opt_in` or `opted_in`. Only opt someone back in with their documented consent.
4. General status (active, inactive, bounced): `sensorpro_change_contact_status`.
5. To list bounced or opted-out contacts, use `sensorpro_list_contacts` with `filter: "Bounce"` or `filter: "Optout"`.

## Destructive actions need explicit approval

- `sensorpro_delete_contacts`: contacts that have already been mailed cannot be deleted (SensorPro keeps them to preserve opt-out history). With `setToInactiveIfCannotDelete` they are set inactive instead.
- `sensorpro_forget_contacts`: irreversible GDPR erase that also removes the contact from suppression lists, so they could be re-imported and emailed again. Only use it when the user confirms the request and that the contact is gone from their source systems.
- `sensorpro_clear_tag` removes a tag from every contact. Confirm the tag name first.

State exactly what will change (which contacts, which field, old and new value) and wait for the user's OK before any of these.
