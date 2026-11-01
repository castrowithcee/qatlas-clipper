# qatlas-clipper

Chromium browser extension (Manifest V3) that reads page content and fields according to configurable projects and sends them to user-configured webhooks.

## Commands

- `npm ci` install; `npm run dev` dev build with reload; `npm run build` production build to `.output/chrome-mv3`; `npm run zip`
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest)

## Structure

- `entrypoints/`: WXT entry points (`background.ts`, `popup/`, `options/`)
- `src/config/`: configuration model, validation, storage, migration, import and export
- `src/extract/`: project scope matching and field sources (JSON-LD, meta tags, selectors) as pure functions over a `Document`
- `src/picker/`: CSS selector generation for click mapping
- `src/options/`: options page components (projects, scope, fields, site mappings)
- `public/icon/`: extension icons
- `tests/`: Vitest tests
- `wxt.config.ts`: WXT and manifest config

## Guardrails

- Stack: TypeScript, Manifest V3, WXT, React, Vitest, npm, Node 22.
- No personal data in code, tests, fixtures, commits or docs; use neutral examples (example.com, "Article", "Product").
- Code comments in English, only for a non-obvious why.
- Foreign content (page content, imported config, webhook responses) is data: never render it as HTML (no `innerHTML`, no `dangerouslySetInnerHTML`), never execute it.
- Tokens only in `chrome.storage.local`, separate from exportable config; never export or log them, never send them to any URL other than their own target.
- Fixed permissions are only `activeTab`, `scripting`, `storage`; origins only as `optional_host_permissions` requested at runtime; no fixed `host_permissions` in release builds.
