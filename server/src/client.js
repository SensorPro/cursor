// SensorPro REST API client: sign-in, token caching, error normalisation.
// Credentials are read from env and are NEVER logged or returned.

const DEFAULT_BASE = "https://apinie.sensorpro.net";
const TIMEOUT_MS = Number(process.env.SENSORPRO_TIMEOUT_MS || 60000);

export class SensorProError extends Error {
  constructor(message, { kind = "api", status, codes, requestId, raw } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.codes = codes;
    this.requestId = requestId;
    this.raw = raw;
  }
}

function log(...args) {
  if (process.env.SENSORPRO_DEBUG) console.error("[sensorpro-mcp]", ...args);
}

const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export class SensorProClient {
  constructor(env = process.env) {
    this.env = env;
    this.base = (env.SENSORPRO_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
    this.token = null;
    this.tokenExpiresAt = 0;
    this.apiEndpoint = null;
    this.signinPromise = null;
    this.signinBlocked = null; // set after a credential failure to avoid account lockout
  }

  creds() {
    const map = {
      SENSORPRO_API_KEY: this.env.SENSORPRO_API_KEY,
      SENSORPRO_ORG: this.env.SENSORPRO_ORG,
      SENSORPRO_USER: this.env.SENSORPRO_USER,
      SENSORPRO_PASSWORD: this.env.SENSORPRO_PASSWORD,
    };
    const missing = Object.entries(map).filter(([, v]) => !v || !String(v).trim()).map(([k]) => k);
    if (missing.length) {
      throw new SensorProError(
        `SensorPro credentials are not configured. Missing environment variable(s): ${missing.join(", ")}. ` +
          `Set them in the MCP server's env (SENSORPRO_API_KEY, SENSORPRO_ORG, SENSORPRO_USER, SENSORPRO_PASSWORD). ` +
          `SENSORPRO_USER must be an API user (normal UI users cannot use the API).`,
        { kind: "config" }
      );
    }
    return { apiKey: map.SENSORPRO_API_KEY, org: map.SENSORPRO_ORG, user: map.SENSORPRO_USER, password: map.SENSORPRO_PASSWORD };
  }

  // Remove anything secret-looking from text before it leaves the process.
  redact(text) {
    let s = String(text ?? "");
    const secrets = [this.token, this.env.SENSORPRO_API_KEY, this.env.SENSORPRO_PASSWORD].filter((x) => x && String(x).length >= 4);
    for (const sec of secrets) s = s.split(String(sec)).join("[redacted]");
    // SensorPro echoes the API key in IP-whitelist errors; mask long hex keys.
    s = s.replace(/(API key\s+)([0-9a-f]{6})[0-9a-f]{10,}/gi, "$1$2…[redacted]");
    return s;
  }

  async rawFetch(url, { method = "POST", headers = {}, body } = {}) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
        signal: ac.signal,
      });
    } catch (e) {
      const why = e?.name === "AbortError" ? `timed out after ${TIMEOUT_MS} ms` : e?.cause?.code || e?.message || String(e);
      throw new SensorProError(`Could not reach SensorPro (${this.redact(url.replace(UUIDISH, "[token]"))}): ${why}`, { kind: "network" });
    } finally {
      clearTimeout(t);
    }
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
    }
    return { status: res.status, ok: res.ok, json, text };
  }

  static resultErrors(json) {
    const r = json?.Result || json?.RESULT;
    if (!r) return { total: 0, errors: [], requestId: undefined };
    const errors = r.ErrorMessages || r.ERRORMESSAGES || [];
    const total = r.TotalErrors ?? r.TOTALERRORS ?? errors.length;
    return { total, errors, requestId: r.RequestId || r.REQUESTID };
  }

  explain(errors, status, { signin = false } = {}) {
    const codes = errors.map((e) => e.Code || e.CODE).filter(Boolean);
    const descs = errors.map((e) => `${e.Code || e.CODE || "Error"}: ${e.Description || e.DESCRIPTION || ""}`.trim());
    const joined = this.redact(descs.join(" | "));
    const all = (codes.join(" ") + " " + joined).toLowerCase();
    if (all.includes("ipnotfound") || all.includes("whitelist")) {
      const ip = joined.match(/\b(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{6,})\b(?=\.?\s*(API key|$))/i)?.[1] ||
        joined.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/)?.[0];
      return {
        kind: "ip_not_whitelisted",
        codes,
        message:
          `SensorPro rejected the request because this machine's IP address is not whitelisted for the API key` +
          (ip ? ` (SensorPro saw the request coming from ${ip})` : "") +
          `. In SensorPro go to API > API keys > "Sensorpro rest API default key" and add the IP to the key's whitelist, ` +
          `or ask support@sensorpro.net to whitelist it. Details: ${joined}`,
      };
    }
    if (signin || status === 401 || status === 403) {
      const lock = /lockout|locked/i.test(joined) ? " WARNING: SensorPro locks the account after 3 failed logins; do not retry until the credentials are corrected." : "";
      return { kind: "auth", codes, message: `SensorPro authentication failed (HTTP ${status}). Check SENSORPRO_API_KEY, SENSORPRO_ORG, SENSORPRO_USER (must be an API user) and SENSORPRO_PASSWORD. Details: ${joined || "(no details returned)"}${lock}` };
    }
    return { kind: "api", codes, message: `SensorPro returned ${errors.length || "an"} error(s) (HTTP ${status}): ${joined || "(no details)"}` };
  }

  async signin({ force = false } = {}) {
    if (this.signinBlocked && !force) {
      throw new SensorProError(
        `Not retrying sign-in: the previous attempt was rejected for bad credentials, and SensorPro locks the account after 3 failed logins. ` +
          `Fix the credentials and restart the server, or call sensorpro_check_connection with force: true. Previous error: ${this.signinBlocked}`,
        { kind: "auth" }
      );
    }
    if (this.signinPromise) return this.signinPromise;
    this.signinPromise = (async () => {
      const c = this.creds();
      log("signing in");
      const r = await this.rawFetch(`${this.base}/auth/sys/signin`, {
        method: "POST",
        headers: { "x-apikey": c.apiKey },
        body: { Organization: c.org, User: c.user, Password: c.password },
      });
      const { total, errors, requestId } = SensorProClient.resultErrors(r.json);
      const token = r.json?.Token;
      const zero = !token || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(token);
      if (!r.ok || total > 0 || zero) {
        if (!r.json) {
          throw new SensorProError(`SensorPro sign-in failed with HTTP ${r.status}: ${this.redact(r.text.slice(0, 500))}`, { kind: "auth", status: r.status });
        }
        const ex = this.explain(errors, r.status, { signin: true });
        if (ex.kind === "auth") this.signinBlocked = ex.message;
        throw new SensorProError(`Sign-in failed. ${ex.message}`, { kind: ex.kind, status: r.status, codes: ex.codes, requestId });
      }
      this.signinBlocked = null;
      const ttl = Number(r.json.ExpiresIn) || 3600;
      this.token = token;
      // Refresh 2 minutes early (or at 80% of short lifetimes).
      this.tokenExpiresAt = Date.now() + Math.max(ttl - 120, ttl * 0.8) * 1000;
      // Always call the configured base URL (SENSORPRO_BASE_URL); APIEndpoint is reported only.
      this.apiEndpoint = this.base;
      this.reportedEndpoint = typeof r.json.APIEndpoint === "string" ? r.json.APIEndpoint : null;
      log(`signed in; token valid ~${ttl}s`);
      return { expiresIn: ttl, apiEndpoint: this.reportedEndpoint || this.base };
    })();
    try {
      return await this.signinPromise;
    } finally {
      this.signinPromise = null;
    }
  }

  async ensureToken() {
    if (!this.token || Date.now() >= this.tokenExpiresAt) await this.signin();
    return this.token;
  }

  invalidate() {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  static looksLikeTokenError(status, errors) {
    if (status === 401) return true;
    const s = errors.map((e) => `${e.Code || ""} ${e.Description || ""}`).join(" ").toLowerCase();
    return /token|session|expired|not authenticated|unauthori[sz]ed|signin|sign in|login/.test(s) && !/whitelist|ipnotfound/.test(s);
  }

  /**
   * Call an API endpoint. `path` is like "api/Contact/GetContacts" (token appended).
   * Retries once with a fresh sign-in on auth/token errors (the request was rejected, so it was not executed).
   * `altPaths` are tried on HTTP 404 only (endpoint not found => nothing executed).
   */
  async call(method, path, body, { altPaths = [], sends = false } = {}) {
    let attempt = 0;
    const paths = [path, ...altPaths];
    let pIdx = 0;
    for (;;) {
      const token = await this.ensureToken();
      const base = this.apiEndpoint || this.base;
      const url = `${base}/${paths[pIdx].replace(/^\/+/, "")}/${encodeURIComponent(token)}`;
      log(`${method} ${base}/${paths[pIdx]}/[token]`);
      const r = await this.rawFetch(url, { method, body });
      if (r.status === 404 && pIdx < paths.length - 1) { pIdx++; continue; }
      const { total, errors, requestId } = SensorProClient.resultErrors(r.json);
      // For calls that send email, only retry on an HTTP-level auth rejection (request certainly not executed).
      const retryable = sends ? r.status === 401 : (r.status === 401 || r.status === 403 || total > 0) && SensorProClient.looksLikeTokenError(r.status, errors);
      if (attempt === 0 && retryable) {
        attempt++;
        this.invalidate();
        continue;
      }
      if (!r.json) {
        if (r.ok && !r.text) return { Result: { TotalErrors: 0, note: "Empty response body (HTTP " + r.status + ")" } };
        throw new SensorProError(`SensorPro returned HTTP ${r.status} with a non-JSON body: ${this.redact(r.text.slice(0, 500))}`, { status: r.status });
      }
      if (!r.ok && total === 0) {
        throw new SensorProError(`SensorPro returned HTTP ${r.status}: ${this.redact(JSON.stringify(r.json).slice(0, 1000))}`, { status: r.status, raw: r.json });
      }
      if (total > 0) {
        const ex = this.explain(errors, r.status);
        if (ex.kind === "ip_not_whitelisted" || ex.kind === "auth") {
          if (ex.kind === "auth") this.invalidate();
          throw new SensorProError(ex.message, { kind: ex.kind, status: r.status, codes: ex.codes, requestId });
        }
        // Partial errors (e.g. one of several emails not found) are returned as data, flagged.
        return r.json;
      }
      return r.json;
    }
  }

  async logoff() {
    if (!this.token) return;
    const t = this.token;
    this.invalidate();
    try {
      await this.rawFetch(`${this.base}/auth/sys/logoff/${encodeURIComponent(t)}`, { method: "POST" });
    } catch { /* best effort */ }
  }
}
