#!/usr/bin/env node
// Offline checks for the Cursor plugin submission checklist (https://cursor.com/docs/reference/plugins).
// Usage: node scripts/validate.mjs
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
let errors = 0;
const fail = (m) => { console.error("ERROR:", m); errors++; };
const okMsg = (m) => console.log("ok:", m);
const readJSON = (p) => {
  try { return JSON.parse(readFileSync(join(root, p), "utf8")); }
  catch (e) { fail(`${p} does not parse: ${e.message}`); return null; }
};
const relOk = (p, what) => {
  if (typeof p !== "string" || !p) return fail(`${what}: empty path`);
  if (/^https?:\/\//.test(p)) return true;
  if (isAbsolute(p) || p.split(/[\\/]/).includes("..")) return fail(`${what}: "${p}" must be relative with no ".."`);
  if (!existsSync(join(root, normalize(p)))) return fail(`${what}: "${p}" does not exist`);
  return true;
};

// Manifest
const m = readJSON(".cursor-plugin/plugin.json");
const allowed = ["name","displayName","description","version","minClientVersions","author","publisher","homepage","repository","license","logo","keywords","category","tags","commands","agents","skills","rules","hooks","variables","mcpServers"];
if (m) {
  for (const k of Object.keys(m)) if (!allowed.includes(k)) fail(`plugin.json: unknown field "${k}"`);
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(m.name || "")) fail(`plugin.json: name "${m.name}" is not lowercase kebab-case`);
  if (!m.description || m.description.length < 20) fail("plugin.json: description missing or too short");
  if (m.version && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(m.version)) fail("plugin.json: version is not semver");
  if (!m.author?.name) fail("plugin.json: author.name required");
  for (const k of Object.keys(m.author || {})) if (!["name", "email"].includes(k)) fail(`plugin.json: author.${k} not allowed`);
  if (m.logo) relOk(m.logo, "logo");
  for (const k of ["skills", "rules", "agents", "commands"]) for (const p of [].concat(m[k] || [])) relOk(p, k);
  for (const p of [].concat(typeof m.mcpServers === "string" ? m.mcpServers : [])) relOk(p, "mcpServers");
  const v = m.variables;
  if (v) {
    if (v.type !== "object" || typeof v.properties !== "object") fail("variables: top level must be { type: object, properties }");
    const kw = new Set(["type","title","description","default","enum","const","properties","required","items","minLength","maxLength","minimum","maximum","pattern","minItems","maxItems"]);
    for (const [name, s] of Object.entries(v.properties || {})) {
      for (const k of Object.keys(s)) if (!kw.has(k)) fail(`variables.${name}: keyword "${k}" not accepted`);
      if (!s.description) fail(`variables.${name}: add a description`);
    }
    for (const r of v.required || []) if (!(r in (v.properties || {}))) fail(`variables.required lists undeclared "${r}"`);
  }
  okMsg(".cursor-plugin/plugin.json parsed and checked");
}

// mcp.json: every ${VAR} declared
const mcpPath = typeof m?.mcpServers === "string" ? normalize(m.mcpServers) : "mcp.json";
const mcp = readJSON(mcpPath);
if (mcp) {
  const declared = new Set(Object.keys(m?.variables?.properties || {}));
  const builtins = new Set(["CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]);
  const used = [...JSON.stringify(mcp).matchAll(/\$\{([A-Za-z0-9_:.-]+)\}/g)].map((x) => x[1]);
  for (const u of used) if (!declared.has(u) && !builtins.has(u) && !u.startsWith("env:")) fail(`mcp.json uses \${${u}} but plugin.json variables do not declare it`);
  for (const [n, s] of Object.entries(mcp.mcpServers || {})) {
    if (!s.command && !s.url) fail(`mcp.json server ${n}: needs command or url`);
  }
  okMsg(`${mcpPath} parsed; variables used: ${[...new Set(used)].join(", ") || "none"}`);
}

// Skills
const skillsDir = join(root, "skills");
if (existsSync(skillsDir)) {
  for (const d of readdirSync(skillsDir)) {
    if (!statSync(join(skillsDir, d)).isDirectory()) continue;
    const f = join(skillsDir, d, "SKILL.md");
    if (!existsSync(f)) { fail(`skills/${d}: missing SKILL.md`); continue; }
    const fm = readFileSync(f, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
    if (!fm) { fail(`skills/${d}/SKILL.md: missing YAML frontmatter`); continue; }
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(`skills/${d}: name must be kebab-case`);
    if (name !== d) fail(`skills/${d}: frontmatter name "${name}" should match folder`);
    if (!desc) fail(`skills/${d}: description required`);
    okMsg(`skills/${d}/SKILL.md frontmatter`);
  }
}

// Other JSON files and required docs
for (const p of ["package.json", "server/package.json"]) if (existsSync(join(root, p))) readJSON(p) && okMsg(`${p} parses`);
for (const p of ["README.md", "LICENSE", "CHANGELOG.md"]) existsSync(join(root, p)) ? okMsg(`${p} present`) : fail(`${p} missing`);

if (errors) { console.error(`\n${errors} problem(s) found.`); process.exit(1); }
console.log("\nAll plugin checks passed.");
