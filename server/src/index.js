#!/usr/bin/env node
// SensorPro MCP server (stdio). Endpoints from https://sensorpro.net/api/ (contacts, campaigns, sendemail, account, imports).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SensorProClient, SensorProError } from "./client.js";

const client = new SensorProClient();
const server = new McpServer({ name: "sensorpro", version: "0.1.0" });

const SEND_WARNING = "⚠️ SENDS REAL EMAIL to real recipients. Only call after the user has explicitly approved the exact recipients and content. Requires confirmSend: true.";

function ok(data, note) {
  const { total, errors } = SensorProClient.resultErrors(data);
  const header = total > 0
    ? `SensorPro reported ${total} error(s) (operation may have partially failed): ${client.redact(errors.map((e) => `${e.Code}: ${e.Description}${e.Sequence !== undefined ? ` [item ${e.Sequence}]` : ""}`).join(" | "))}\n\n`
    : "";
  return {
    content: [{ type: "text", text: header + (note ? note + "\n\n" : "") + client.redact(JSON.stringify(data, null, 2)) }],
    isError: false,
  };
}

function fail(e) {
  const msg = e instanceof SensorProError ? e.message : `Unexpected error: ${e?.message || e}`;
  return { content: [{ type: "text", text: client.redact(msg) }], isError: true };
}

function tool(name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return await handler(args || {});
    } catch (e) {
      return fail(e);
    }
  });
}

function requireConfirm(args) {
  if (args.confirmSend !== true) {
    throw new SensorProError("Refusing to send: confirmSend must be true. This tool sends real email; get the user's explicit approval first.", { kind: "guard" });
  }
}

// HTML entity-encode (docs: HTMLMessageEncoded / HTMLMessageStyle "should be HTML encoded").
function htmlEncode(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ---------- shared schemas ----------
const keySelector = {
  emails: z.array(z.string()).optional().describe("Contact email addresses (PersonalEMail)."),
  extLinkIds: z.array(z.string()).optional().describe("External/foreign keys (ExtLinkId) from your own system."),
  contactIds: z.array(z.number().int()).optional().describe("Native SensorPro ContactIds."),
};
function keysBody(a) {
  const body = { ExtLinkIds: a.extLinkIds || [], EmailAddress: a.emails || [], ContactIds: a.contactIds || [] };
  if (!body.ExtLinkIds.length && !body.EmailAddress.length && !body.ContactIds.length) {
    throw new SensorProError("Provide at least one of emails, extLinkIds or contactIds.", { kind: "input" });
  }
  return body;
}
const emailAddr = z.object({
  Email: z.string().describe("Email address"),
  DisplayName: z.string().optional().describe("Display name (optional)"),
});
const contactRecord = z
  .object({
    PersonalEMail: z.string().describe("Email address (required)."),
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    ExtLinkId: z.string().optional().describe("Your external/foreign key for this contact."),
    PhoneMobile: z.string().optional().describe("Digits only incl. country code, e.g. 353871234567 (used for SMS)."),
    OptOut: z.number().int().optional().describe("Email opt-out: 0 subscribed, -10 unsubscribed, -5 pending opt-in."),
    Status: z.number().int().optional().describe("0 Active, 20 Inactive, -10 Bounced/Rejected."),
  })
  .passthrough()
  .describe(
    "Contact record. Any other documented SensorPro contact field may be included verbatim, e.g. Title, Gender, DateofBirth, DateOfLastPurchase, PersonalEmail1, BusinessEmail, PhoneHome, PhoneBusiness, PerStreet, PerCity, PerState, PerZip, PerCountry, BusName, BusStreet, BusCity, BusCountry, BusWebSite, GroupBy1-3, GroupByIndustry, MessagePreference (HTML/TEXT), JobTitle, SMSOptOut, SMSStatus, ImportName, InFix, YearlyPurchase, UserChar2-UserChar15 (max 100 chars), Date1-Date5 ('yyyy-mm-dd hh:mm:ss'), Num1-Num5 (integers)."
  );

// ---------- connection ----------
tool(
  "sensorpro_check_connection",
  {
    title: "Check SensorPro connection",
    description:
      "Signs in to SensorPro with the configured credentials and reports whether it worked (token lifetime and API endpoint; the token itself is never shown). Use this to diagnose IP-whitelist or credential problems. SensorPro's API has no 'get account info' endpoint; this is the closest equivalent. After a bad-credential failure, further sign-ins are blocked (SensorPro locks accounts after 3 failed logins) unless force is true.",
    inputSchema: { force: z.boolean().default(false).describe("Retry sign-in even after a previous credential failure. Only use once the credentials have been corrected.") },
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    client.invalidate();
    const r = await client.signin({ force: !!a.force });
    return ok({ signedIn: true, tokenExpiresInSeconds: r.expiresIn, apiEndpoint: r.apiEndpoint, organization: process.env.SENSORPRO_ORG, user: process.env.SENSORPRO_USER });
  }
);

// ---------- contacts ----------
tool(
  "sensorpro_get_contacts",
  {
    title: "Get contacts",
    description: "Retrieve full contact records by email address, external key (ExtLinkId) and/or native ContactId (POST api/Contact/GetContacts). Keys that are not found are reported as GetFailed errors while found contacts are still returned.",
    inputSchema: keySelector,
    annotations: { readOnlyHint: true },
  },
  async (a) => {
    const k = keysBody(a);
    return ok(await client.call("POST", "api/Contact/GetContacts", {
      ExtLinkIds: k.ExtLinkIds.length ? k.ExtLinkIds : null,
      EmailAddress: k.EmailAddress.length ? k.EmailAddress : null,
      ContactIds: k.ContactIds.length ? k.ContactIds : null,
    }));
  }
);

tool(
  "sensorpro_list_contacts",
  {
    title: "List contacts (paged)",
    description: "Page through the contact database (POST api/Contact/GetContactsPaged). Optionally restrict to bounced, opted-out, SMS-opted-out or SMS-failed contacts. Increment page until no contacts are returned.",
    inputSchema: {
      page: z.number().int().min(1).default(1).describe("Page number, starting at 1."),
      pageSize: z.number().int().min(1).max(1000).default(50).describe("Contacts per page."),
      filter: z.enum(["all", "Bounce", "Optout", "Smsoptout", "Smsstatus"]).default("all").describe("all = every contact; Bounce = bounced emails; Optout = opted-out emails; Smsoptout = SMS opt-outs; Smsstatus = failed SMS numbers."),
      fields: z.array(z.string()).optional().describe("Fields to populate, e.g. ['personalemail','firstname','status','optoutstatus']. Omit for all fields."),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) =>
    ok(await client.call("POST", "api/Contact/GetContactsPaged", {
      Page: a.page ?? 1,
      PageSize: a.pageSize ?? 50,
      Options: { Action: !a.filter || a.filter === "all" ? "" : a.filter },
      Fields: a.fields || [],
    }))
);

tool(
  "sensorpro_upsert_contacts",
  {
    title: "Add / update contacts",
    description:
      "Add and/or update one or more contacts. mode: 'update_add' (default; update if exists else add — POST api/Contact/UpdateAdd), 'add' (add only; errors if exists — POST api/Contact/Add), 'update' (update only; errors if missing — PUT api/Contact/Update), 'update_add_async' (queued server-side for large batches — POST api/Contact/UpdateAddAsync; check with sensorpro_get_async_upsert_status using the returned RequestId). Writes to the live contact database. If sendWelcomeEmail is true, SensorPro may send a real welcome email to new contacts.",
    inputSchema: {
      contacts: z.array(contactRecord).min(1).describe("Contact records; PersonalEMail is required on each."),
      mode: z.enum(["update_add", "add", "update", "update_add_async"]).default("update_add"),
      tags: z.array(z.string()).optional().describe("Tags/lists applied to the contacts (AddToList)."),
      updateByKey: z.enum(["email", "extlinkid", "contactid"]).default("email").describe("Key used to match existing contacts: email, extlinkid (external key) or contactid (native key)."),
      sendWelcomeEmail: z.boolean().default(false).describe("⚠️ true = treat as new sign-up: triggers the signup form's welcome email (real email) and a signup audit record. Leave false for imports/syncs."),
      signupFormId: z.string().optional().describe("Signup form GUID holding the welcome email design (needed if sendWelcomeEmail is true)."),
      returnFailedRequests: z.boolean().default(false).describe("Return failed records in FailedRequests (slower, larger response)."),
    },
    annotations: { destructiveHint: false, idempotentHint: true },
  },
  async (a) => {
    const paths = { update_add: ["POST", "api/Contact/UpdateAdd"], add: ["POST", "api/Contact/Add"], update: ["PUT", "api/Contact/Update"], update_add_async: ["POST", "api/Contact/UpdateAddAsync"] };
    const [method, path] = paths[a.mode || "update_add"];
    return ok(await client.call(method, path, {
      AddToList: a.tags || [],
      Contact: a.contacts,
      Options: { Parameters: {}, Action: "" },
      ReturnFailedRequests: !!a.returnFailedRequests,
      UpdateByKey: a.updateByKey === "contactid" ? "" : a.updateByKey || "email",
      SendWelcomeEmail: !!a.sendWelcomeEmail,
      SignupFormId: a.signupFormId || "00000000-0000-0000-0000-000000000000",
    }, { sends: !!a.sendWelcomeEmail }));
  }
);

tool(
  "sensorpro_get_async_upsert_status",
  {
    title: "Get async contact upsert status",
    description: "Check the status of a batch submitted with mode 'update_add_async' (POST api/Contact/GetUpdateAddAsyncStatus). Pass the RequestId returned by that call.",
    inputSchema: { requestId: z.string().describe("RequestId returned by the async upsert.") },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/Contact/GetUpdateAddAsyncStatus", { Id: a.requestId }))
);

tool(
  "sensorpro_change_optout_status",
  {
    title: "Change email opt-out status",
    description: "Set the email opt-out (subscription) status for contacts (PUT api/Contact/ChangeOptOutStatus). Opted-out contacts are not emailed. Only opt someone back in with their consent.",
    inputSchema: {
      ...keySelector,
      status: z.enum(["opted_out", "pending_opt_in", "opted_in"]).describe("opted_out (-10), pending_opt_in (-5), opted_in (0)."),
      returnFailedRequests: z.boolean().default(false),
    },
    annotations: { idempotentHint: true },
  },
  async (a) => {
    const map = { opted_out: -10, pending_opt_in: -5, opted_in: 0 };
    return ok(await client.call("PUT", "api/Contact/ChangeOptOutStatus", { Status: map[a.status], ReturnFailedRequests: !!a.returnFailedRequests, ...keysBody(a) }));
  }
);

tool(
  "sensorpro_change_contact_status",
  {
    title: "Change contact status",
    description: "Set the general status of contacts (PUT api/Contact/ChangeStatus): active, referred, inactive or bounced/rejected.",
    inputSchema: {
      ...keySelector,
      status: z.enum(["active", "referred", "inactive", "bounced"]).describe("active (0), referred (10, 'tell a friend'), inactive (20), bounced (-10, bounced/rejected)."),
      returnFailedRequests: z.boolean().default(false),
    },
    annotations: { idempotentHint: true },
  },
  async (a) => {
    const map = { active: 0, referred: 10, inactive: 20, bounced: -10 };
    return ok(await client.call("PUT", "api/Contact/ChangeStatus", { Status: map[a.status], ReturnFailedRequests: !!a.returnFailedRequests, ...keysBody(a) }));
  }
);

tool(
  "sensorpro_delete_contacts",
  {
    title: "Delete contacts",
    description: "⚠️ Permanently delete contacts (DELETE api/Contact/DeleteContacts). Contacts that have already been broadcast to cannot be deleted (to preserve opt-out status); with setToInactiveIfCannotDelete they are set inactive instead. Get the user's approval first.",
    inputSchema: {
      ...keySelector,
      setToInactiveIfCannotDelete: z.boolean().default(true),
      returnFailedRequests: z.boolean().default(false),
    },
    annotations: { destructiveHint: true },
  },
  async (a) => ok(await client.call("DELETE", "api/Contact/DeleteContacts", {
    SetToInactiveIfCannotDelete: a.setToInactiveIfCannotDelete !== false,
    ReturnFailedRequests: !!a.returnFailedRequests,
    ...keysBody(a),
  }))
);

tool(
  "sensorpro_forget_contacts",
  {
    title: "Forget contacts (GDPR erase)",
    description: "⚠️ IRREVERSIBLE GDPR 'forget me': deletes contacts and ALL associated data, including from suppression lists, so they could be re-imported and emailed again (DELETE api/Contact/ForgetMe). Asynchronous; track in SensorPro under Admin > Setup > API > Forget Me Async Queue. Only use when the contact has been removed from the source system and the user explicitly approved.",
    inputSchema: {
      ...keySelector,
      notifyOnCompletionEmail: z.string().optional().describe("Email address to notify when the task completes."),
      setToInactiveIfCannotDelete: z.boolean().default(true),
    },
    annotations: { destructiveHint: true },
  },
  async (a) => {
    const body = { SetToInactiveIfCannotDelete: a.setToInactiveIfCannotDelete !== false, ...keysBody(a) };
    if (a.notifyOnCompletionEmail) body.NotifyOnCompletionEmail = a.notifyOnCompletionEmail;
    return ok(await client.call("DELETE", "api/Contact/ForgetMe", body));
  }
);

// ---------- campaigns ----------
tool(
  "sensorpro_list_campaigns",
  {
    title: "List campaigns by last broadcast date",
    description: "List campaigns whose last broadcast falls between fromDate and toDate (POST api/Campaign/GetCampaignByLastBroadcastDate). Returns campaign id, title, manager, subject, from address, total sent and last broadcast date.",
    inputSchema: {
      fromDate: z.string().describe("Start date, yyyy-mm-dd."),
      toDate: z.string().describe("End date, yyyy-mm-dd."),
      listName: z.string().optional().describe("Optional list name filter."),
    },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/Campaign/GetCampaignByLastBroadcastDate", { ListName: a.listName || "", FromDate: a.fromDate, ToDate: a.toDate }))
);

tool(
  "sensorpro_get_campaign_results",
  {
    title: "Get campaign results / stats",
    description: "Dashboard results for a campaign (POST api/campaign/GetCampaignResults): segments, broadcasts, sent, delivered, opens, bounces, opt-outs, clicks, spam reports and percentages.",
    inputSchema: { campaignId: z.number().int().describe("Campaign id.") },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/campaign/GetCampaignResults", { CampaignId: a.campaignId }))
);

tool(
  "sensorpro_get_campaign_link_results",
  {
    title: "Get campaign link-click stats",
    description: "Campaign results including per-link unique/total click counts (POST api/campaign/GetCampaignResultsLinks).",
    inputSchema: { campaignId: z.number().int().describe("Campaign id.") },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/campaign/GetCampaignResultsLinks", { CampaignId: a.campaignId }))
);

tool(
  "sensorpro_get_broadcast_status",
  {
    title: "Get broadcast status",
    description: "Status of every broadcast in a campaign (POST api/Campaign/GetBroadcastStatus). Status codes: -10 Error, 2 Queued, 10 Ready To Send, 20 Scheduled, 30 Sending, 40 Finished.",
    inputSchema: { campaignId: z.number().int().describe("Campaign id.") },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/Campaign/GetBroadcastStatus", { CampaignId: a.campaignId }))
);

tool(
  "sensorpro_create_campaign",
  {
    title: "Create campaign",
    description: "Create a campaign container (POST api/campaign/AddCampaign). Does not send anything. Typical flow: create_campaign -> add_design -> add_segment -> add_broadcast (which sends).",
    inputSchema: {
      title: z.string(),
      manager: z.string().describe("Campaign manager name."),
      campaignType: z.enum(["standard", "pending", "recurring", "trigger", "sms", "sms_recurring", "sms_trigger"]).default("standard"),
      endDate: z.string().optional().describe("yyyy-mm-dd"),
      googleAnalytics: z.boolean().default(false),
      doNotTrackLinks: z.boolean().default(false),
      serviceMessage: z.boolean().default(false).describe("⚠️ true = service messages that IGNORE opt-out status. Only for genuine transactional/service mail."),
      emailResultsAfter: z.number().int().default(0).describe("Days after broadcast to email results."),
      emailResultsMinSize: z.number().int().default(0).describe("Only email results for broadcasts larger than this."),
      emailResultsTo: z.string().default(""),
      extLinkId: z.string().default(""),
    },
  },
  async (a) => {
    const t = { standard: 0, pending: 10, recurring: 30, trigger: 40, sms: 50, sms_recurring: 60, sms_trigger: 70 };
    const body = {
      Title: a.title, Manager: a.manager, CampaignType: t[a.campaignType || "standard"],
      GoogleAnalytics: !!a.googleAnalytics, DoNotTrackLinks: !!a.doNotTrackLinks, Categories: false, ServiceMessage: !!a.serviceMessage,
      EmailResultsAfter: a.emailResultsAfter ?? 0, EmailResultsMinSize: a.emailResultsMinSize ?? 0, EmailResultsTo: a.emailResultsTo || "", ExtLinkId: a.extLinkId || "",
    };
    if (a.endDate) body.EndDate = a.endDate;
    return ok(await client.call("POST", "api/campaign/AddCampaign", body));
  }
);

tool(
  "sensorpro_add_design",
  {
    title: "Add email design to campaign",
    description: "Add an HTML or text email design to a campaign (POST api/campaign/AddDesign). Returns DesignIdHTML / DesignIdTXT for use in add_broadcast. Does not send. Pass raw HTML; it is HTML-entity-encoded for SensorPro's HTMLMessageEncoded field unless htmlAlreadyEncoded is true. Include {unsubscribe} in the text version.",
    inputSchema: {
      campaignId: z.number().int(),
      name: z.string().regex(/^[A-Za-z0-9]+$/).describe("Design name; letters and digits only. Make it unique."),
      description: z.string(),
      designType: z.enum(["html", "text"]).default("html"),
      html: z.string().optional().describe("Raw HTML body (for designType html)."),
      styleSheet: z.string().optional().describe("CSS for the design."),
      textMessage: z.string().optional().describe("Text version (multipart alternative / text design), e.g. 'Hello ... {unsubscribe}'."),
      plainTextMessage: z.string().optional(),
      htmlMessageWidth: z.number().int().optional().describe("e.g. 650"),
      saveAsTemplate: z.boolean().default(false),
      extLinkId: z.string().default("").describe("External id; if a design with this id exists it will not be added again."),
      htmlAlreadyEncoded: z.boolean().default(false),
    },
  },
  async (a) => {
    const body = {
      CampaignId: a.campaignId, Name: a.name, DesignType: a.designType === "text" ? 25 : 20, Description: a.description,
      TextMessage: a.textMessage || "", ExtLinkId: a.extLinkId || "", SaveAsTemplate: !!a.saveAsTemplate, HTMLMessageBorderStyle: "",
    };
    if (a.html) body.HTMLMessageEncoded = a.htmlAlreadyEncoded ? a.html : htmlEncode(a.html);
    if (a.plainTextMessage) body.PlainTextMessage = a.plainTextMessage;
    if (a.styleSheet) body.StyleSheet = a.styleSheet;
    if (a.htmlMessageWidth) body.HTMLMessageWidth = a.htmlMessageWidth;
    if (body.DesignType === 20 && !a.html) throw new SensorProError("designType html requires html.", { kind: "input" });
    if (body.DesignType === 25 && !a.textMessage) throw new SensorProError("designType text requires textMessage.", { kind: "input" });
    return ok(await client.call("POST", "api/campaign/AddDesign", body));
  }
);

tool(
  "sensorpro_add_segment",
  {
    title: "Add segment (audience) to campaign",
    description: "Define who a campaign goes to (POST api/campaign/AddSegment). Returns SegmentId for add_broadcast. Does not send. segmentType: import (contacts from an import/tag — set ruleImportName), seed_list, everyone, or custom_rule (use customRules).",
    inputSchema: {
      campaignId: z.number().int(),
      segmentName: z.string(),
      description: z.string(),
      segmentType: z.enum(["import", "seed_list", "custom_rule", "everyone"]),
      ruleImportName: z.string().optional().describe("Import/list name when segmentType is import."),
      ruleSeedList: z.string().optional(),
      customRules: z.array(z.object({
        field: z.string().describe("Contact field, e.g. Personalemail, PerCountry"),
        condition: z.enum(["<", ">", "=", "Like", "NotLike", "Is Null", "Is Not Null"]),
        value: z.string().default(""),
        andOrNext: z.enum(["AND", "OR"]).default("AND").describe("How this rule joins the next one."),
      })).optional(),
      activeOnly: z.boolean().default(true).describe("Only active contacts (not opted out / bounced)."),
      restricted: z.boolean().default(false).describe("Force uniqueness across all segments in the campaign."),
      reBuildBeforeBroadcast: z.boolean().default(true),
      dupEmailInDays: z.number().int().default(-1).describe("Exclude contacts emailed within this many days; -1 = off."),
      extLinkId: z.string().default(""),
    },
  },
  async (a) => {
    const t = { import: 0, seed_list: 10, custom_rule: 20, everyone: 30 };
    return ok(await client.call("POST", "api/campaign/AddSegment", {
      CampaignId: a.campaignId, SegmentName: a.segmentName, Description: a.description, SegmentType: t[a.segmentType],
      MultiStep: false, Restricted: !!a.restricted, ActiveOnly: a.activeOnly !== false, ReBuildBeforeBroadcast: a.reBuildBeforeBroadcast !== false,
      // Docs list AND/OR; sample uses 0. Map AND=0, OR=1 (assumption).
      CustomRule: (a.customRules || []).map((r) => ({ Field: r.field, Condition: r.condition, Value: r.value ?? "", AndOrNext: r.andOrNext === "OR" ? 1 : 0 })),
      RuleSeedList: a.ruleSeedList || "", RuleImportName: a.ruleImportName || "", ExtLinkId: a.extLinkId || "", DupEmailInDays: a.dupEmailInDays ?? -1,
    }));
  }
);

tool(
  "sensorpro_add_broadcast",
  {
    title: "Add broadcast (SEND campaign)",
    description: `${SEND_WARNING} Creates a broadcast for a campaign segment + design (POST api/campaign/AddBroadcast). With executeBroadcast true it sends immediately to the whole segment, or at scheduleUtc if given. The from address must be an authorised sender in SensorPro.`,
    inputSchema: {
      confirmSend: z.literal(true).describe("Must be true; confirms the user approved this real send."),
      campaignId: z.number().int(),
      segmentId: z.number().int(),
      subject: z.string(),
      fromEmail: emailAddr,
      replyTo: emailAddr.optional(),
      designHtmlId: z.string().describe("DesignIdHTML from add_design."),
      designTxtId: z.string().optional().describe("DesignIdTXT (optional)."),
      msgType: z.enum(["html", "text"]).default("html"),
      broadcastType: z.enum(["email", "sms"]).default("email"),
      executeBroadcast: z.boolean().default(true).describe("true = execute now (or at scheduleUtc)."),
      scheduleUtc: z.string().optional().describe("Future send time in UTC, e.g. 2026-10-12T08:00:00Z."),
      mailEncoding: z.string().default("UTF8"),
      extLinkId: z.string().default(""),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (a) => {
    requireConfirm(a);
    return ok(await client.call("POST", "api/campaign/AddBroadcast", {
      CampaignId: a.campaignId, SegmentId: a.segmentId, Subject: a.subject,
      FromEmail: { DisplayName: a.fromEmail.DisplayName || "", Email: a.fromEmail.Email },
      ReplyTo: a.replyTo ? { DisplayName: a.replyTo.DisplayName || "", Email: a.replyTo.Email } : null,
      DesignHtmlId: a.designHtmlId, DesignTxtId: a.designTxtId || "00000000-0000-0000-0000-000000000000",
      MsgType: a.msgType === "text" ? 10 : 0, MailEncoding: a.mailEncoding || "UTF8",
      ExecuteBroadcast: a.executeBroadcast !== false, ExecuteOnUTCFormat: a.scheduleUtc || null, ExtLinkId: a.extLinkId || "",
      BroadcastType: a.broadcastType === "sms" ? 40 : 0,
    }, { sends: true }));
  }
);

tool(
  "sensorpro_trigger_email",
  {
    title: "Trigger campaign email to one contact (SEND)",
    description: `${SEND_WARNING} Sends a pre-configured triggered-email campaign broadcast to one contact, adding the contact if new (POST api/Campaign/TriggerEmail). Asynchronous/queued. namedParameters are substituted into the design as {Name}.`,
    inputSchema: {
      confirmSend: z.literal(true).describe("Must be true; confirms the user approved this real send."),
      campId: z.string().describe("Triggered-email campaign id (GUID from the trigger campaign)."),
      broadcastId: z.number().int().describe("Broadcast id to send."),
      delayMinutes: z.number().int().min(0).default(0),
      contact: contactRecord.describe("Recipient contact; PersonalEMail required (PhoneMobile for SMS)."),
      namedParameters: z.record(z.string(), z.string()).optional().describe("Transient values for the design, e.g. {\"Invoice\":\"IV001\"} -> {Invoice}."),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (a) => {
    requireConfirm(a);
    return ok(await client.call("POST", "api/Campaign/TriggerEmail", {
      CampId: a.campId, BroadcastId: a.broadcastId, Delay: a.delayMinutes ?? 0, ContactData: a.contact, NamedPairsParameters: a.namedParameters || {},
    }, { sends: true }));
  }
);

tool(
  "sensorpro_get_metrics_from_queue",
  {
    title: "Get queued metrics (consumes queue)",
    description: "Retrieve engagement metrics queued for export (POST api/Campaign/GetMetricsFromQueue). Requires export integration enabled in SensorPro (Admin | Setup | System Settings > FTP/ODBC > Integration Active). ⚠️ Retrieved metrics are marked completed and CANNOT be fetched again, so only call when the results will be stored/used.",
    inputSchema: {
      metricType: z.enum(["open", "microsite_click", "url_click", "unsubscribe", "bounce", "category_unsubscribe", "sms_unsubscribe"]).describe("open(-2), microsite_click(0), url_click(60), unsubscribe(40, incl. opt back in), bounce(70, incl. un-bounce), category_unsubscribe(170), sms_unsubscribe(230)."),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(1000).default(100),
    },
    annotations: { destructiveHint: true },
  },
  async (a) => {
    const t = { open: -2, microsite_click: 0, url_click: 60, unsubscribe: 40, bounce: 70, category_unsubscribe: 170, sms_unsubscribe: 230 };
    return ok(await client.call("POST", "api/Campaign/GetMetricsFromQueue", {
      Paging: { Page: a.page ?? 1, PageSize: a.pageSize ?? 100, Options: { Parameters: {}, Action: "" }, Fields: [] },
      MetricType: t[a.metricType],
    }));
  }
);

// ---------- relay email ----------
tool(
  "sensorpro_send_email",
  {
    title: "Send transactional email via relay (SEND)",
    description: `${SEND_WARNING} Sends an individual email through SensorPro's relay (POST api/Email/SendEmail). Up to 20 'to' recipients; each gets a separate email. From must be an authorised sender. Pass raw HTML in html (it is HTML-entity-encoded for SensorPro unless htmlAlreadyEncoded), or text for a plain-text email. Optional delay/schedule.`,
    inputSchema: {
      confirmSend: z.literal(true).describe("Must be true; confirms the user approved this real send."),
      from: emailAddr,
      to: z.array(emailAddr).min(1).max(20),
      cc: z.array(emailAddr).optional(),
      bcc: z.array(emailAddr).optional(),
      replyTo: emailAddr.optional(),
      returnPath: emailAddr.optional(),
      subject: z.string(),
      html: z.string().optional().describe("Raw HTML body (include CSS inline or via css)."),
      css: z.string().optional().describe("Stylesheet (HTMLMessageStyle)."),
      text: z.string().optional().describe("Plain-text body. If html is omitted the email is sent as text."),
      headers: z.record(z.string(), z.string()).optional().describe("Custom email headers."),
      delayByMinutes: z.number().int().min(0).default(0),
      delayUntilUtc: z.string().optional().describe("Send at this UTC date/time."),
      mailEncoding: z.string().default("UTF-8"),
      htmlAlreadyEncoded: z.boolean().default(false),
    },
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  async (a) => {
    requireConfirm(a);
    if (!a.html && !a.text) throw new SensorProError("Provide html and/or text.", { kind: "input" });
    const addr = (x) => (x ? { DisplayName: x.DisplayName || "", Email: x.Email } : null);
    const enc = (s) => (a.htmlAlreadyEncoded ? s : htmlEncode(s));
    return ok(await client.call("POST", "api/Email/SendEmail", {
      From: addr(a.from), To: a.to.map(addr), Cc: (a.cc || []).map(addr), Bcc: (a.bcc || []).map(addr),
      Headers: a.headers || {}, ReplyTo: addr(a.replyTo), ReturnPath: addr(a.returnPath), Subject: a.subject,
      HTMLMessageStyle: a.css ? enc(a.css) : "", HTMLMessageEncoded: a.html ? enc(a.html) : "", PlainTextMessage: a.text || "",
      MsgType: a.html ? 0 : 10, MailEncoding: a.mailEncoding || "UTF-8",
      Schedule: { DelayByMinutes: a.delayByMinutes ?? 0, DelayUntilUTC: a.delayUntilUtc || "" },
    }, { sends: true }));
  }
);

// ---------- imports ----------
tool(
  "sensorpro_get_import_status",
  {
    title: "Get import status",
    description: "Check whether an import has finished (POST api/import/GetImportStatus): status, active contacts, last file processed.",
    inputSchema: { importId: z.number().int() },
    annotations: { readOnlyHint: true },
  },
  async (a) => ok(await client.call("POST", "api/import/GetImportStatus", { ImportId: a.importId }))
);

tool(
  "sensorpro_execute_ftp_import",
  {
    title: "Run FTP CSV import",
    description: "Create and (optionally) run an import of a CSV file from an FTP/SFTP site into the contact database (POST api/import/ExecuteFTPImport). Asynchronous; poll sensorpro_get_import_status with the returned ImportId. Writes to the live contact database.",
    inputSchema: {
      importName: z.string().max(16).regex(/^[A-Za-z0-9]+$/).describe("Max 16 chars, a-z and 0-9 only."),
      description: z.string().default(""),
      fieldMap: z.array(z.object({ fromField: z.string().describe("CSV column heading"), toField: z.string().describe("SensorPro field, e.g. personalemail") })).min(1),
      ftpSite: z.string(),
      ftpUser: z.string(),
      ftpPassword: z.string(),
      ftpFileName: z.string(),
      ftpSecure: z.boolean().default(false).describe("Use SFTP."),
      ftpFileEncoding: z.string().default("UTF8"),
      deleteFileAfterImport: z.boolean().default(false),
      quoteChar: z.string().default('"'),
      clearCrossXRef: z.boolean().default(false).describe("Clear records from previous runs of this import."),
      executeImport: z.boolean().default(true),
    },
  },
  async (a) => ok(await client.call("POST", "api/import/ExecuteFTPImport", {
    ImportDefinition: {
      ImportName: a.importName, Description: a.description || "", MapDefinition: "", Status: -1, QuoteChar: a.quoteChar ?? '"', ClearCrossXRef: !!a.clearCrossXRef,
      FieldMap: a.fieldMap.map((f) => ({ FromField: f.fromField, ToField: f.toField, ToMacro: "" })),
      FTPConfiguration: { FTPFileName: a.ftpFileName, FTPFileEncoding: a.ftpFileEncoding || "UTF8", FTPUser: a.ftpUser, FTPSite: a.ftpSite, FTPPwd: a.ftpPassword, FTPSecure: !!a.ftpSecure, DeleteFileAfterImport: !!a.deleteFileAfterImport },
      ExecuteImport: a.executeImport !== false,
    },
    Options: { Parameters: {}, Action: "" },
  }))
);

tool(
  "sensorpro_clear_tag",
  {
    title: "Remove a tag from all contacts",
    description: "⚠️ Removes one tag/list from ALL contacts (DELETE api/import/ClearTagList). Call once per tag. Get approval first.",
    inputSchema: { tag: z.string() },
    annotations: { destructiveHint: true },
  },
  async (a) => ok(await client.call("DELETE", "api/import/ClearTagList", JSON.stringify(a.tag)))
);

// ---------- account ----------
tool(
  "sensorpro_add_sub_organization",
  {
    title: "Create sub-organization",
    description: "Create a sub-organization under the signed-in organization (POST api/Account/AddSubOrganization). Returns the new org's API key (treat as a secret). Changes the account; get approval first.",
    inputSchema: {
      company: z.string().describe("Short org code used to log in; no spaces/special characters."),
      user: z.string().describe("User email for the new org."),
      password: z.string().describe("Min 8 chars incl. 1 uppercase, 1 number, 1 special (@ ! $ .)."),
      isApiUser: z.boolean().default(false),
      shareCredit: z.boolean().default(false),
      copyAuthorizedSenderEmail: z.boolean().default(false),
    },
  },
  async (a) => ok(await client.call("POST", "api/Account/AddSubOrganization", {
    Company: a.company, User: a.user, IsAPIUser: !!a.isApiUser, Password: a.password, CnfPassword: a.password, ShareCredit: !!a.shareCredit, CopyAuthorizedSenderEmail: !!a.copyAuthorizedSenderEmail,
  }))
);

tool(
  "sensorpro_add_update_user",
  {
    title: "Add or update user",
    description: "Add or update a user in the organization (POST api/Account/AddUpdateUser). API users can only use the API; normal users only the UI. Changes the account; get approval first.",
    inputSchema: {
      user: z.string().describe("User id (the user's email)."),
      firstName: z.string(),
      lastName: z.string(),
      email: z.string(),
      password: z.string().optional().describe("Min 8 chars incl. 1 uppercase, 1 number, 1 special (@ ! $ .)."),
      role: z.string().default("Admin"),
      campaignAdmin: z.boolean().default(true),
      apiUser: z.boolean().default(false),
      enableAdvancedEdit: z.boolean().default(false),
      uiCulture: z.string().default("en-GB"),
      culture: z.string().default("en-GB"),
    },
  },
  async (a) => {
    const body = {
      User: a.user, FirstName: a.firstName, LastName: a.lastName, Email: a.email, UICulture: a.uiCulture || "en-GB", Culture: a.culture || "en-GB",
      Role: a.role || "Admin", Menu: "*sys", CampaignAdmin: a.campaignAdmin !== false, APIUser: !!a.apiUser, EnableAdvancedEdit: !!a.enableAdvancedEdit,
    };
    if (a.password) { body.Password = a.password; body.PasswordCnf = a.password; }
    // Docs show both /api/Account/AddUpdateUser (curl sample) and /Account/AddUpdateUser (endpoint box); fall back on 404.
    return ok(await client.call("POST", "api/Account/AddUpdateUser", body, { altPaths: ["Account/AddUpdateUser"] }));
  }
);

// ---------- start ----------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[sensorpro-mcp] ready on stdio");
  const shutdown = async () => { await client.logoff(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);
}
main().catch((e) => { console.error("[sensorpro-mcp] fatal:", client.redact(e?.message || e)); process.exit(1); });
