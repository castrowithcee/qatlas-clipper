# qatlas-clipper

Chromium browser extension (Manifest V3) that reads page content and fields according to configurable projects and sends them to user-configured webhooks.

## Commands

- `npm ci` install; `npm run dev` dev build with reload; `npm run build` production build to `.output/chrome-mv3`; `npm run zip`
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest)
- `npm run build:e2e` test build to `.output/chrome-mv3-e2e`; `npm run e2e` build:e2e + Playwright suite; `npm run check:manifest` checks the release manifest (run after `npm run build`)

## Structure

- `entrypoints/`: WXT entry points (`background.ts`, `popup/`, `options/`, `picker.ts` and `reader.ts` unlisted injected scripts)
- `src/config/`: configuration model, validation, storage, migration, import and export
- `src/extract/`: project scope matching, field sources (JSON-LD, meta tags, selectors) and Defuddle page reading as pure functions over a `Document`; `inject.ts` runs the reader in a tab
- `src/picker/`: CSS selector generation, click-mapping overlay (Shadow DOM), mapping persistence and picker start
- `src/options/`: options page components (projects, scope, fields, site mappings, targets with header values and host permissions, import and export)
- `src/popup/`: popup components (project choice, field form, picker start) and the per-URL draft cache of user edits (`storage.session`)
- `src/send/`: send core (payload builder, service-worker send with header binding and timeout, response evaluation, per-URL result storage in `storage.session`, runtime message API)
- `docs/`: `webhook.md` (webhook request and response contract)
- `public/icon/`: extension icons
- `tests/`: Vitest tests
- `e2e/`: Playwright flow tests (`specs/`, test pages in `pages/`, local page and webhook servers, extension fixtures)
- `scripts/`: build checks (`check-manifest.mjs`)
- `wxt.config.ts`: WXT and manifest config

## Guardrails

- Stack: TypeScript, Manifest V3, WXT, React, Vitest, npm, Node 22.
- No personal data in code, tests, fixtures, commits or docs; use neutral examples (example.com, "Article", "Product").
- Code comments in English, only for a non-obvious why.
- Foreign content (page content, imported config, webhook responses) is data: never render it as HTML (no `innerHTML`, no `dangerouslySetInnerHTML`), never execute it.
- Tokens only in `chrome.storage.local`, separate from exportable config; never export or log them, never send them to any URL other than their own target.
- Fixed permissions are only `activeTab`, `scripting`, `storage`; origins only as `optional_host_permissions` requested at runtime; no fixed `host_permissions` in release builds.
- Only the e2e build carries `localhost`/`127.0.0.1` host permissions and the popup `?tabId=` hook; the release build must not.
