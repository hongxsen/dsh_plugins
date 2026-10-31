# Custom market sources — 0.2.0 spec

Both market plugins gain user-defined **market sources**. A source is either a
compatible remote API or a static JSON index. The user can add, remove and
select sources from the Web panel; the Host persists the list and selection.

This file supplements `2026-10-31-skills-mcp-market-design.md`. Treat the
earlier spec as still authoritative for everything not changed here.

## Shared source model

Each plugin owns one store:

- skills: `<dshHome>/storages/dsh-skills-market/sources.json`
- MCP: `<dshHome>/storages/dsh-mcp-market/sources.json`

```json
{
  "version": 1,
  "selected": "skills-sh",
  "sources": [
    {
      "id": "skills-sh",
      "kind": "skills-sh",
      "title": "skills.sh",
      "url": "https://www.skills.sh",
      "builtin": true
    },
    {
      "id": "custom-a1b2c3d4",
      "kind": "index",
      "title": "Team skills",
      "url": "https://example.com/skills-index.json",
      "builtin": false
    }
  ]
}
```

Rules:

- Builtins are created when the file is missing and cannot be removed or
  edited. A missing/invalid store falls back to the builtin source; do not
  erase an unreadable custom store silently.
- Custom ids are `custom-` + 8 lowercase hex characters from
  `crypto.randomBytes(4)`. The user never supplies an id.
- `title` is trimmed, 1–80 characters. `url` is absolute `http:`/`https:`,
  has no credentials and no fragment, and is at most 2048 characters.
- `kind` is one of the plugin's two kinds:
  - skills: `skills-sh` | `index`
  - MCP: `mcp-registry` | `index`
- At most 20 sources. Builtin is first.
- `selected` must name a present source; otherwise use the builtin.
- Store mode 0600, atomic temp+rename, serialized writes. Source mutations and
  selection are one queue. Unknown fields dropped. Invalid JSON fails loudly
  instead of resetting.
- On add, validate the source before persisting it:
  - `index`: fetch with a 10 s timeout, 2 MiB cap, JSON parse + schema
    validation. Reject with `sources/invalid-index`.
  - `skills-sh`: no network validation; require an http(s) base.
  - `mcp-registry`: no network validation; require an http(s) base.
- Do not cache a failed index forever. Index documents cache for 5 minutes,
  keyed by source id + URL; mutations clear the cache. A successful index fetch
  can be reused by search/detail/install.

Endpoints on the existing prefix routes:

| Method | Path | Body | Result |
|---|---|---|---|
| GET | `/api/sources` | — | `{ version, selected, sources }` |
| POST | `/api/sources` | `{ action: "add", kind, title, url }` | `{ selected, sources, source }` |
| POST | `/api/sources` | `{ action: "remove", id }` | `{ selected, sources }` |
| POST | `/api/sources` | `{ action: "select", id }` | `{ selected, sources }` |

Error codes: `sources/invalid`, `sources/limit`, `sources/not-found`,
`sources/builtin`, `sources/fetch-failed`, `sources/invalid-index`.
Builtin removal/rename is refused. Removing the selected custom source selects
the builtin.

## Skills custom sources

### Static index format

```json
{
  "format": 1,
  "title": "Team Skills",
  "description": "Internal skills",
  "skills": [
    {
      "name": "deploy-helper",
      "source": "acme/skills",
      "skillId": "deploy-helper",
      "description": "Deploy the internal service.",
      "installs": 42,
      "tags": ["ops", "deploy"],
      "homepage": "https://github.com/acme/skills"
    }
  ]
}
```

- `format` must be `1`; `skills` must be an array; at most 2000 entries.
- Each entry needs `name`, `source` (`owner/repo`, same GitHub grammar as the
  install pipeline) and `skillId`. Optional strings/numbers are normalized;
  `tags` is an array of short strings.
- `title` is used as the source's display title when the source title is empty.
- Search filters case-insensitively over `name`, `source`, `skillId`,
  `description` and `tags`; query tokens may appear in any field. Empty query
  returns all entries sorted by `installs` descending then `name`.
- Returned entries include `{ id, name, source, skillId, installs,
  description, pageUrl, market }` where `pageUrl` is `homepage` or
  `https://github.com/<source>`.
- Detail matches `source` + `skillId` exactly and returns
  `{ description, pageUrl, title }`.
- Installation still resolves the skill through GitHub (the existing preview
  pipeline). A custom index entry that is not on GitHub fails at preview with
  `skills/not-found`; say so in the README.

### `skills-sh` compatible base

Use `<base>/api/search?q=` and `<base>/<source>/<skillId>` for detail, with the
existing parsing. Normalize a trailing slash. Page URLs use the custom base.
Cache search/detail by `${sourceId}\0${query}` and `${sourceId}\0${source}\0${skillId}`.

### API changes

- `GET /api/search?q=&source=<id>`: `source` is optional; default = selected.
  Response gains `source: { id, kind, title, url }` and each skill gains
  `pageUrl` and `market`.
- `GET /api/detail?market=<id>&repo=<owner/repo>&skill=<skillId>`: `market` is
  optional; keep `source` as a legacy alias for `repo`.
- `POST /api/sources` as above.
- `/api/health` includes `sources: { count, selected }`.

## MCP custom sources

### Static index format

```json
{
  "format": 1,
  "title": "Team MCP",
  "servers": [
    {
      "name": "com.acme/weather",
      "title": "Acme Weather",
      "description": "Weather tools for internal services.",
      "version": "1.0.0",
      "remotes": [
        { "type": "streamable-http", "url": "https://mcp.acme.test/mcp" }
      ],
      "packages": []
    }
  ]
}
```

- `format` must be `1`; `servers` max 2000 entries. Each entry may be either a
  raw server object or `{ "server": {...} }` from the official registry.
- Normalize with the existing registry normalizer; drop unsupported
  remotes/packages exactly as the official registry path does.
- Search filters `name`, `title`, `description`; empty query returns all sorted
  by title then name, capped at 30.
- Detail matches `name` exactly.
- Install/preview resolve the entry from the source at request time; never
  trust a client-supplied config. Store `sourceId` and `sourceTitle` in
  `servers.json` and show them in the installed list.

### `mcp-registry` compatible base

Use `<base>/v0/servers?search=…&limit=…&version=latest` and the existing
exact-name fallback. Normalize a trailing slash. Cache per base + query.

### API changes

- `GET /api/search?q=&source=<id>` includes `source: { id, kind, title, url }`
  and each server `market`.
- `GET /api/detail?name=&source=<id>`.
- `POST /api/preview { registryName, source }`.
- `POST /api/install` body gains `source`; resolve the registry entry from that
  source. Installed records gain optional `sourceId`, `sourceTitle`.
- `POST /api/sources` as above.
- `/api/health` includes `sources: { count, selected }`.

## Browser UI

Both panels get:

1. A **market switcher** in the discover toolbar (left of search):
   a native `<select>` with the source title for each source, plus a final
   option `管理市场源…` that opens the dialog. Selecting a source calls
   `POST /api/sources {action:"select"}` then resets detail/descriptions and
   searches with `source=<id>`. While sources load, show the builtin title or
   a disabled "加载市场…" option.
2. A **source dialog**:
   - Existing sources list: title, kind label, URL, `内置` badge for builtins,
     a select control, and a remove button for custom sources.
   - Add form: title input, URL input, kind radio/segmented control with the
     two kinds, submit button, inline validation error, and a note that a JSON
     index must match the documented format.
   - Removing the selected source falls back to the builtin; the list and
     selected source update immediately.
   - Dialog is keyboard accessible: Esc closes, focus moves to the title
     input when opened, and buttons have labels.
3. Result header shows the active source title. For index sources, cards seed
   their description from the search entry and use the provided `pageUrl`;
   for `skills-sh`, keep lazy description loading.
4. Errors from a custom source show the normal error state with retry, plus a
   button to open the source dialog.
5. All new strings in zh + en dictionaries with parity enforced by build.

Do not use a remote icon for a source. Use a monogram/dot.

## Versioning and docs

- Bump both packages to `0.2.0`.
- Add a "自定义市场 / Custom markets" section to each README: supported source
  kinds, add/remove/select, storage path, full JSON index example, security
  note (index content is third-party; install still previews/validates), and
  the fact that custom skills still must be GitHub-hosted.
- Update `docs/index.json` only after the Lead commits; do not touch it from
  the plugin work.
- Add tests for source store validation/mutations/persistence, index parsing,
  custom base URL paths, search/detail from each kind, MCP install source
  resolution, and bundle smoke. Keep existing tests passing.

## Constraints

- No new npm dependencies. Node built-ins and global fetch only.
- Keep write scope inside the plugin directory.
- Preserve the existing API/behavior for clients that omit `source`.
- Never expose secrets or arbitrary client URLs to the network without the
  source URL validation above.
- SSRF surface: custom sources intentionally allow user-chosen HTTP(S) hosts.
  Document that the user chooses them; still reject credentials/fragments and
  enforce the size/time caps.
