# Skills Market and MCP Market — implementation spec

Status: approved by the Lead for the 0.1.0 build. This file is the shared contract
for the two plugins; edit code, not this document, unless the Lead asks for a
design change.

## Product

Two independent DSH bundle packages in this repository:

| Package | Directory | Panel |
|---|---|---|
| `@hongxsen/dsh-skills-market` | `plugins/skills-market` | sidebar entry **Skills / 技能** |
| `@hongxsen/dsh-mcp-market` | `plugins/mcp-market` | sidebar entry **MCP / MCP** |

Both are full-page sidebar panels (same pattern as the built-in Plugins page),
with two views:

1. **Discover / 发现** — search a remote catalog, open an entry, install.
2. **Installed / 已安装** — inspect, enable/disable where supported, remove.

No settings page is required. All strings are localized (zh + en). Both plugins
work when the profile has HMR and degrade to "restart required" when it does not.

## Non-negotiable UX rules

- Use the existing DSH design language: page shell max width 960–1080 px,
  `padding: 0 clamp(24px,4vw,48px) 48px`, 20/28 page title, 13/20 secondary
  text, 12.5/18 tertiary text, 1px `--dsw-alias-border-l2` borders, 12px radius,
  `--dsw-alias-bg-layer-1/2`, `--dsw-alias-interactive-bg-hover`, brand color
  for primary actions. No bespoke fonts, no gradients except a deterministic
  avatar fallback.
- Every asynchronous state has a visible state: idle, loading (skeleton or
  inline spinner), empty, error with retry, and success toast.
- Search is debounced 300 ms; Enter searches immediately. Results keep the
  previous page visible while a new query loads, with a subtle busy bar.
- Cards are keyboard-focusable; Enter opens the detail page. Buttons have
  `aria-label`s. Esc closes dialogs. Focus-visible rings use
  `--dsw-focus-ring-color` / brand color.
- No remote images are required. Use a deterministic monogram avatar
  (first letter, hue from a hash). Remote icon URLs may be shown only when they
  are `https:` and must use `referrerpolicy="no-referrer"` with a monogram
  fallback.
- Show a trust notice before installing anything: catalog text and code are
  third-party content.
- No layout shift when toggling between views. The page scrolls as a whole.

## Package conventions

Copy the structure of `plugins/wallpaper`:

```
plugins/<name>/
  package.json          # independent package, exports "." and "./client"
  cordis.patch.yml      # insert one row: id <panel-id>, name <package>
  index.js              # Host entry
  lib/*.js              # Host modules (plain ESM, no external deps)
  src/entry.js          # browser entry: inject + apply
  src/ui.js             # React components + CSS (no JSX)
  src/model.mjs         # pure browser helpers (optional)
  build.mjs             # concatenates src into client.js
  client.js             # generated, committed
  locale/zh.json, en.json
  icon.svg
  README.md
  tests/*.test.mjs
```

`package.json`:

```json
{
  "name": "@hongxsen/dsh-skills-market",
  "version": "0.1.0",
  "type": "module",
  "description": "...",
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "skills", "marketplace"],
  "license": "MIT",
  "exports": {
    ".": "./index.js",
    "./client": "./client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["index.js", "lib/**/*.js", "client.js", "cordis.patch.yml", "locale/*.json", "icon.svg", "README.md"],
  "scripts": {
    "build": "node build.mjs",
    "test": "node --test tests/*.test.mjs"
  },
  "engines": { "dsh": ">=0.2.1-0 <0.3.0" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-sidebar",
        "@deepseek-ai/dsh-client-ui-layout"
      ]
    }
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/hongxsen/dsh_plugins.git",
    "directory": "plugins/skills-market"
  },
  "homepage": "https://github.com/hongxsen/dsh_plugins#readme"
}
```

`cordis.patch.yml`:

```yaml
- insert:
    - id: skills-market
      name: '@hongxsen/dsh-skills-market'
```

`index.js` exports `name`, `inject = ['webServer']`, and `apply(ctx)`. Register a
prefix route `/dsh-skills-market` (MCP: `/dsh-mcp-market`) inside
`ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path, handler }), 'label')`.
The handler is an `IncomingMessage`/`ServerResponse` callback. Read JSON bodies
yourself with a 1 MiB cap. Always send `Cache-Control: no-store` for API
responses. Reject non-JSON content types on POST with 415. Reject a present
`Origin` header whose host does not equal the request `Host` header with 403.
Return JSON errors as `{ error: { code, message, details? } }` with a stable
`code` string; never return stack traces.

`build.mjs` concatenates `src/model.mjs` (exports stripped), `src/ui.js`, and
`src/entry.js` (exports stripped) into:

```js
window.__ModuleLoader__.load({
  id: '@hongxsen/dsh-skills-market',
  factory(require) {
    const React = require('react')
    const LOCALES = {...}          // embedded from locale/*.json
    /* sources */
    return { inject, apply }
  },
})
```

Reject any remaining top-level `import`/`export` in the concatenated sources.
`client.js` is committed.

## Browser plugin registration

```js
export const inject = ['slots', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, LOCALES), 'skills-market: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => { /* inject <style data-plugin="..."> and remove on dispose */ }, '...: styles')

  ctx.slots.inject('main', function* () {
    yield ctx.slots.register({
      name: 'main',
      key: 'skills-market',
      locale: NS,
    }, SkillsMarketPage)
  })

  ctx.slots.inject('sidebar.panellist', function* () {
    yield ctx.slots.register({
      name: 'sidebar.panellist',
      id: 'skills-market',
      order: 20,
      label: () => t('panel'),
      locale: NS,
    }, PanelIcon)
  })
}
```

The `main` slot key and the `sidebar.panellist` id must match. MCP uses
`mcp-market` and order 21. The page receives no owner props that matter; it
uses `t` from the slot's locale injection (the slot system passes `t` to the
component). If not available, close over `ctx.locale.bind(NS)`.

Client/server transport: `fetch('/dsh-skills-market/api/...')` same-origin.
Wrap with an `AbortController` timeout (20 s search/detail, 120 s preview,
30 s mutations). Parse `{ error }` into a thrown `Error` with `code`.

## Skills market

Catalog: `https://www.skills.sh`. Use its public JSON search endpoint from the
Host (no CORS):

```
GET https://www.skills.sh/api/search?q=<query>
→ { query, skills: [{ id, source, skillId, name, installs }], count }
```

A query shorter than 2 characters returns an API error; show the initial
"popular/curated" state instead (the static seed list below). Cache responses in
memory for 5 minutes, keyed by query. Limit results to 30. Search text is
untrusted; never render HTML.

Static seed (used before the first query and offline), name/source/skillId/installs:

- frontend-design — anthropics/skills — 1052099
- find-skills — vercel-labs/skills — 4100000
- agent-browser — vercel-labs/agent-browser — 1300000
- tdd — mattpocock/skills — 1200000
- handoff — mattpocock/skills — 1100000
- skill-creator — anthropics/skills — 900000
- docx — anthropics/skills — 800000
- pdf — anthropics/skills — 750000
- xlsx — anthropics/skills — 700000
- pptx — anthropics/skills — 650000

Detail description: fetch `https://www.skills.sh/<source>/<skillId>`, parse the
server-rendered `<meta name="description" content="...">` (decode the five HTML
entities only), cap 280 chars for cards and 1200 for detail. Fail soft: an empty
description still opens the detail page.

### Install pipeline (Host)

1. Validate `source` against `^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$` and
   `skillId` against `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`.
2. GitHub API:
   - `GET https://api.github.com/repos/<source>` for `default_branch`
     (fallback `main`).
   - `GET https://api.github.com/repos/<source>/git/trees/<branch>?recursive=1`.
     If `truncated`, still try the paths in the partial tree. Respect
     `GITHUB_TOKEN` from the host env if present.
3. Find the skill directory: prefer a blob whose directory basename equals
   `skillId` (case-insensitive) and whose path ends `/SKILL.md`; else a blob
   whose filename without `.md` equals `skillId`; else fetch up to 20 candidate
   `SKILL.md` files (paths below `skills/`, `plugins/`, `.claude/skills/`, or
   anywhere when fewer than 40 SKILL.md files exist) and match the frontmatter
   `name` exactly. If nothing matches, fail with `skill/not-found`.
4. Collect every blob under the chosen directory, cap 200 files and 8 MiB
   total. Download in parallel (concurrency 6) from
   `https://raw.githubusercontent.com/<source>/<branch>/<path>` with each path
   segment `encodeURIComponent`ed. Preserve relative paths. Reject `..`,
   absolute paths, symlinks, and entries outside the chosen directory.
5. Parse `SKILL.md` frontmatter: a `---` fence, top-level `name` and
   `description` (quoted or plain), optional booleans. `name` must be
   kebab-case (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), `description` non-empty. The
   installed directory name is the frontmatter name.
6. Security scan every text file ≤ 256 KiB for: `curl ... | sh`,
   `wget ... | sh`, `eval(`, `new Function(`, `child_process`, `rm -rf /`,
   `sudo `, `process.env` plus `fetch(`/`http`, base64-decoded execution,
   `~/.ssh`, `~/.aws`. Return warnings with `{ file, line, snippet }` (snippet
   capped 160 chars). Warnings do not block install; they require the second
   confirm click.
7. Write a staging preview under
   `<dshHome>/storages/dsh-skills-market/staging/<token>/`; token is
   `crypto.randomUUID()`. Keep at most 5 previews, each <15 min old. Return:
   `{ token, name, description, source, skillId, repo, branch, path,
      files: [{ path, size }], totalBytes, skillMd, warnings, existing }`.
   `skillMd` is capped at 128 KiB. `existing` says a skill with that name is
   already installed.
8. `POST /api/install { token, replace? }`: re-validate the staged files,
   ensure the target `<dshHome>/skills/<name>` is inside the root, refuse when
   it exists and `replace` is not true, otherwise move the old directory to a
   temporary trash path, rename the staged directory into place, and record
   metadata in `<dshHome>/storages/dsh-skills-market/installed.json`:
   `{ version: 1, skills: { <name>: { name, source, skillId, repo, branch,
   path, installedAt, files, totalBytes } } }`. Delete the trash on success;
   restore it on failure. `replace` may only replace a directory recorded in
   that metadata file or one we manage; never delete an unknown directory.
9. Installed list: scan direct children of `<dshHome>/skills` (directory with
   `SKILL.md`, or flat `<name>.md`). Parse frontmatter, join metadata, mark
   `writable` true only under `<dshHome>/skills`; include `managed` (metadata
   exists) and `warnings` count from a fresh scan of the installed files.
10. Remove: only a managed directory under `<dshHome>/skills`; rename to
    `.trash/<name>-<timestamp>`, then delete; remove metadata. Refuse anything
    else with `skill/not-managed`.

Endpoints:

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/dsh-skills-market/api/search?q=` | — | `{ seed, query, skills, cached }` |
| GET | `/dsh-skills-market/api/detail?source=&skill=` | — | `{ description, pageUrl }` |
| POST | `/dsh-skills-market/api/preview` | `{ source, skillId }` | preview object above |
| POST | `/dsh-skills-market/api/install` | `{ token, replace }` | `{ installed: true, name }` |
| GET | `/dsh-skills-market/api/installed` | — | `{ skills: [...] }` |
| POST | `/dsh-skills-market/api/remove` | `{ name }` | `{ removed: true }` |
| GET | `/dsh-skills-market/api/health` | — | `{ ok: true, root, version }` |

Error codes: `skills/invalid-query`, `skills/fetch-failed`, `skills/not-found`,
`skills/invalid-skill`, `skills/too-large`, `skills/exists`,
`skills/not-managed`, `skills/staging-expired`, `skills/install-failed`.

## MCP market

Catalog: `https://registry.modelcontextprotocol.io/v0/servers?search=<q>&limit=24&version=latest`
(omit `search` for the initial list, use `limit=24`). Follow `metadata.nextCursor`
only for the explicit `loadMore` request (v1 may omit; return the first page).
Cache 5 minutes. Normalize each entry to:

```
{
  name, title, description, version, repository, websiteUrl,
  remotes: [{ type, url, headers: [{ name, description, isRequired, isSecret, value }] }],
  packages: [{ registryType, identifier, version, runtimeHint, transport,
               runtimeArguments, packageArguments, environmentVariables }],
  updatedAt, isLatest
}
```

Keep only `streamable-http` remotes (`sse` entries are shown as "not supported"),
and `npm` / `pypi` / `oci` packages. `title` falls back to the last path
segment of `name`.

Detail endpoint re-reads the registry by exact name:
`GET /v0/servers/<urlencoded name>`; if that 404s, fall back to a search for the
name and pick the exact match, then a `version=latest` search. Cache the detail.

### Install pipeline (Host)

Build a config for `@deepseek-ai/dsh-mcp-client` and write it as a managed
block in the active profile patch (`ctx.get('profileContext').patchPath`).

Remote:

```yaml
- insert:
    - id: mcp-market-<slug>
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: <slug>
        transport: streamable-http
        url: <https url>
        headers:
          Authorization: 'Bearer ...'
```

Package:

```yaml
- insert:
    - id: mcp-market-<slug>
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: <slug>
        transport: stdio
        command: npx
        args: ['-y', '@scope/pkg@1.2.3', '--flag', 'value']
        env:
          TOKEN: '...'
```

Rules:

- `slug` = lowercased registry name's last segment, non-alphanumerics replaced
  by `_`, plus a 4-hex hash of the full registry name; cap 32 chars and match
  `^[A-Za-z0-9_-]{1,32}$`. Stable across installs.
- `rowId` = `mcp-market-<slug>`.
- Only `http:`/`https:` URLs; only `npx` for npm, `uvx` for pypi, `docker` for
  oci. Build args from `runtimeArguments`/`packageArguments`:
  positional → value; named → `--<name>` plus value when present. Avoid
  duplicate flags. No shell interpolation, no `sh -c`.
- Environment variables: required ones must have a value; optional ones use the
  user's value or the declared `default`. Header placeholders of the form
  `{key}` must be filled; if the header value is literal, keep it. Never write
  a secret into logs.
- Check command availability with `spawnSync('which', [command])`; report
  `mcp/runtime-missing` when absent (still allow preview, block install).
- Preview returns:
  `{ kind, rowId, serverName, title, transport, url?, command?, args?,
     headers: [{name, description, required, secret}], env: [...],
     warnings, existing, config }` where `config` has secrets redacted.
- Install body `{ registryName, choice: { kind: 'remote'|'package', index },
  values: { headers: {...}, env: {...} } }`. The Host re-fetches the registry
  entry by name; it never trusts client-provided URLs/commands. Validate every
  value is a string ≤ 8 KiB. Refuse if the same `serverName` is already
  installed (unless `replace`).
- Store records in `<dshHome>/storages/dsh-mcp-market/servers.json` (mode 0600):
  `{ version: 1, servers: { <rowId>: { rowId, serverName, registryName, title,
  description, version, transport, url?, command?, args?, headers?, env?,
  enabled, installedAt, updatedAt } } }`.
- Patch block (exact markers, one leading newline):
  ```
  # >>> dsh-mcp-market managed block — do not edit between the markers
  <one or more insert rows, enabled only>
  # <<< dsh-mcp-market managed block
  ```
  Rewrite only the text between markers (inclusive). If no block exists,
  append one. Preserve all other bytes. Write atomically (temp file + rename,
  mode 0600), with a one-time backup `<patch>.dsh-mcp-market.bak` before the
  first modification. Serialize a write queue so two mutations cannot
  interleave.
- Apply: after writing, `const hmr = ctx.get('hmr')`; return
  `{ applied: hmr !== undefined, restartRequired: hmr === undefined }`. HMR's
  watcher applies within a few seconds. Do not call internal recompose APIs.
- Toggle: set `enabled` in the store and rewrite the block (disabled rows are
  omitted). Remove: delete the record, rewrite. Refuse unknown row ids.
- External rows: parse the patch for `@deepseek-ai/dsh-mcp-client` rows outside
  the managed markers and return them read-only as
  `{ rowId, serverName, transport, enabled, external: true }`. Do not touch
  them.
- Installed list enriches managed records with `toolCount`: read
  `ctx.get('tools')?.schemas?.()` (wrap in try/catch) and count names starting
  `mcp__<serverName>__`. Also return `hmr` availability, `patchPath` (display
  as `~/.dsh/...`), and `profileName`.

Endpoints:

| Method | Path | Body/query | Result |
|---|---|---|---|
| GET | `/dsh-mcp-market/api/search?q=` | — | `{ query, servers, cached }` |
| GET | `/dsh-mcp-market/api/detail?name=` | — | normalized server |
| POST | `/dsh-mcp-market/api/preview` | `{ registryName }` | preview object |
| POST | `/dsh-mcp-market/api/install` | install body | `{ installed, applied, restartRequired }` |
| GET | `/dsh-mcp-market/api/installed` | — | `{ servers, external, hmr, patchPath, profileName, runtimes }` |
| POST | `/dsh-mcp-market/api/toggle` | `{ rowId, enabled }` | `{ applied, restartRequired }` |
| POST | `/dsh-mcp-market/api/remove` | `{ rowId }` | `{ removed, applied, restartRequired }` |
| GET | `/dsh-mcp-market/api/health` | — | `{ ok: true, profile, patchPath, hmr }` |

Error codes: `mcp/invalid-query`, `mcp/fetch-failed`, `mcp/not-found`,
`mcp/invalid-entry`, `mcp/runtime-missing`, `mcp/needs-input`,
`mcp/already-installed`, `mcp/invalid-value`, `mcp/not-managed`,
`mcp/patch-failed`, `mcp/install-failed`.

## Tests

Pure host helpers must be unit-testable without DSH. At minimum:

- skills: frontmatter parse (quoted/plain, malformed), kebab validation,
  security scan patterns, GitHub tree skill matching, path traversal refusal,
  installed scan with a temp dir, metadata round-trip.
- mcp: slug/rowId stability, registry normalization, args/env/header builder,
  secret redaction, YAML block render/parse/remove (including preserving
  surrounding text and other rows), patch write/rewrite idempotence with a temp
  file, external row detection.
- Run `node --test tests/*.test.mjs` from each plugin directory.
- `node build.mjs` must produce `client.js`; test that the bundle has no
  top-level `import`/`export`, contains the package id, and evaluates the
  factory under a tiny mock `window.__ModuleLoader__` with a mock `require`.
  (Do not run React rendering in that test.)

## README

Per package: what it does, a screenshot placeholder, install command (local and
market), where skills are installed / where the MCP rows are written, security
notes (third-party content, secrets stored in the profile patch, remove
behavior), HMR/restart behavior, development (`node build.mjs`,
`node --test`). Update the root `README.md` table and `docs/index.json` with
both plugins (version 0.1.0, category `extension`), source commit pinned by the
Lead after the final commit.

## Icons

64×64 SVG, no external assets. Skills: a stack of cards with a spark. MCP: a
node-link/plug motif. Keep the wallpaper/co-write visual weight; encode as a
data URI in `docs/index.json` by the Lead.
