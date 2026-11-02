# qatlas-clipper

Chromium browser extension (Manifest V3) that reads page content and fields according to configurable projects and sends them to user-configured webhooks.

## Commands

- `npm ci` install; `npm run dev` dev build with reload; `npm run build` production build to `.output/chrome-mv3`; `npm run zip`
- `npm run typecheck`, `npm run lint`, `npm test` (Vitest)
- `npm run build:e2e` test build to `.output/chrome-mv3-e2e`; `npm run e2e` build:e2e + Playwright suite; `npm run check:manifest` checks the release manifest (run after `npm run build`)
- `npm run screens` renders the component gallery and takes light and dark screenshots (output dir from `SCREENS_DIR`, default `test-results/screens`); `npm run screens:popup` and `npm run screens:options` build the e2e extension and screenshot the popup states and the options page (default `test-results/popup-screens`, `test-results/options-screens`)

## Structure

- `entrypoints/`: WXT entry points (`background.ts`, `popup/`, `options/`, `picker.ts` and `reader.ts` unlisted injected scripts)
- `src/ui/`: design tokens (CSS variables, light and dark, `:root` and Shadow DOM variants), theme application and the accessible component basis in `components/`
- `src/i18n/`: translation catalogs (`de` reference, `en`), translator with placeholders, plurals and `Intl` formats, language resolution
- `src/settings/`: device settings (language, appearance) with storage, provider and the options section
- `src/config/`: configuration model, validation, storage, migration, import and export
- `src/extract/`: project scope matching with page kinds (`pageTypes.ts`, schema.org types including subtypes), field sources (click mapping, detect values resolved over several candidates in `detect.ts`, JSON-LD, meta tags) and Defuddle page reading as pure functions over a `Document`; `inject.ts` runs the reader in a tab
- `src/picker/`: CSS selector generation, click-mapping overlay (Shadow DOM), mapping persistence and picker start
- `src/options/`: options page shell (sidebar, hash routing in `route.ts`, one view per area) and components (projects, scope, fields table with a detail panel holding each field's click mappings, targets with header values and host permissions, import and export); `focus.ts` is the popup handoff (key `optionsFocus` in `storage.session`: selected project id, read and cleared by the options page)
- `src/popup/`: popup components (project choice, field form, picker start) and the per-URL draft cache of user edits (`storage.session`)
- `src/send/`: send core (payload builder, service-worker send with header binding and timeout, response evaluation, per-URL result storage in `storage.session`, runtime message API)
- `docs/`: `webhook.md` (webhook request and response contract), `release-checklist.md` (manual Brave and Edge check per release)
- `.github/workflows/`: `ci.yml` (checks and E2E), `release.yml` (tag `vX.Y.Z` release with ZIP; `workflow_dispatch` is a dry run), `dev-build.yml` (after green CI on `main`: moves tag `dev` and replaces the pre-release "Development build" with `qatlas-clipper-dev-chrome.zip`)
- `public/icon/`: extension icons; `public/_locales/`: localized manifest name and description
- `tests/`: Vitest tests
- `e2e/`: Playwright flow tests (`specs/`, test pages in `pages/`, local page and webhook servers, extension fixtures); `gallery/` and `screens/` hold the standalone component gallery and its screenshot spec (`playwright.screens.config.ts`), never part of an extension build; `popup-screens/` and `options-screens/` hold the popup and options screenshot specs (`playwright.popup-screens.config.ts`, `playwright.options-screens.config.ts`)
- `scripts/`: build and release checks (`check-manifest.mjs`, `check-version.mjs`)
- `wxt.config.ts`: WXT and manifest config

## Guardrails

- Stack: TypeScript, Manifest V3, WXT, React, Vitest, npm, Node 22.
- No personal data in code, tests, fixtures, commits or docs; use neutral examples (example.com, "Article", "Product").
- Code comments in English, only for a non-obvious why.
- Visible texts of new or changed UI come only from the catalogs in `src/i18n/`; German is the reference, English stays complete (parity test). UI values come only from the semantic tokens in `src/ui/`.
- Device settings (language, appearance) live under their own storage key and are never part of the exported configuration.
- Foreign content (page content, imported config, webhook responses) is data: never render it as HTML (no `innerHTML`, no `dangerouslySetInnerHTML`), never execute it.
- Tokens only in `chrome.storage.local`, separate from exportable config; never export or log them, never send them to any URL other than their own target.
- Fixed permissions are only `activeTab`, `scripting`, `storage`; origins only as `optional_host_permissions` requested at runtime; no fixed `host_permissions` in release builds.
- Only the e2e build carries `localhost`/`127.0.0.1` host permissions and the popup `?tabId=` hook; the release build must not.
