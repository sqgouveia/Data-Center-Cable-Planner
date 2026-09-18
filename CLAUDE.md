# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stratum: a static-site (no build step) tool for planning and documenting a data center's physical layout — rows/racks, cable tray paths, cable routing with computed length, and equipment (asset) inventory with U-position, ports, power, weight and lifecycle (warranty/EOL) tracking. Runs entirely as HTML/CSS/JS served from GitHub Pages, with Supabase as the only backend (auth + project sync). See `PRODUCT.md` for product intent/positioning and `DESIGN.md` for the visual design system (both are Impeccable-generated; keep them in sync with UI changes via the Impeccable skill/hooks already configured in `.claude/settings.local.json`).

## Commands

Run tests (Node's built-in test runner, no framework/dependencies):
```
node --test "js/test/*.test.mjs"
```
Run a single test file:
```
node --test js/test/routing.test.mjs
```
There is no build step, bundler, package.json, linter, or dev server config — `index.html` loads `app.js` directly as an ES module (`<script type="module" src="app.js">`). To preview locally, serve the directory with any static file server (e.g. `npx serve .` or `python -m http.server`) and open `index.html`; opening the file directly (`file://`) will not work because it's an ES module.

## Architecture

**No bundler, no framework.** `index.html` loads three CDN libraries (`@supabase/supabase-js`, SheetJS `xlsx`, `exceljs`) as globals, then `app.js` as a native ES module that imports from `js/*.js`. There is no compile/transpile step — what's on disk is what ships.

**`app.js` (~3.1k lines) is what remains of the application after the extractions listed below**: undo/redo history, all canvas rendering (SVG-based pan/zoom/minimap), row/rack/tray editing UI, asset CRUD and the assets table, the cable properties panel, rack bayface (front-view) rendering, modals, and search. It is intentionally monolithic — everything that touches the DOM or app-level side effects (`render`, `toast`, modal open/close) lives here, not in `js/`.

**`js/` holds the framework-free, DOM-light modules `app.js` imports from**, split by concern:
- `state.js` — the single mutable `state` object. It is a module-level singleton: every file that imports `state` shares live mutations. **Never reassign `state`** (e.g. `state = {...}`) — always mutate its properties in place, or every importer's reference goes stale.
- `geometry.js` — physical layout math: row/rack positions, tray endpoints/bounds, snapping, rack↔tray connection points, segment intersection. Deliberately has no rendering or app-level side effects — this is the part of the app whose numbers must be physically correct.
- `routing.js` — cable routing on top of `geometry.js`: builds the rack+tray graph and computes the shortest physical path (automatic mode) or validates a user-picked waypoint path (manual mode), converting to real cable length in meters.
- `utils.js` — pure helpers (id generation, deep clone, date/number parsing and formatting in pt-BR, catalog fuzzy-matching, Excel column/port-template helpers).
- `dialogs.js` / `styled-select.js` — small custom UI primitives (confirm/prompt modals, dropdown widget) used in place of native browser dialogs/`<select>`.
- `pdf-report.js` — PDF report generation and its options modal (first slice split out of `app.js`). It needs a few `app.js` helpers (`toast`, `capacityIssues`, …), which `app.js` injects once via `configurePdfReport({...})` right after its imports; this avoids a circular import. Follow the same pattern when extracting further sections of `app.js`: new module gets the code verbatim, `app.js` passes in what it still owns.
- `inventory-import.js` — Excel/CSV import of assets and single catalogs: template generation, workbook parsing, row validation, and the editable preview modal. Same injection pattern (`configureInventoryImport({...})`), except its call sits where the code used to live because it also injects two `const`s (`DEFAULT_ASSET_STATUSES`, `ASSET_COLUMN_HEADER_LABELS`) that must already be initialized. The preview state that `app.js` also reads/writes (`pending`, `modelIndex`, `catalogCreate`) lives in the exported `importSession` object, since a module-level `let` cannot be reassigned by an importer.
- `cloud-sync.js` — Supabase client, auth screens, cloud autosave/load, project dashboard and project CRUD, and the asset audit log/history. State only this code touches (`cloudReady`, timers, …) stays private; `cloudProjectId` and `cloudDirty`, which `app.js` also uses, live in the exported `cloud` object. `configureCloudSync({...})`.
- `bulk-assets.js` — bulk asset registration modal (free-U calculation, resizable table) and the import-modal bindings (`bindImportUI`). `configureBulkAssets({...})`.
- `cables.js` — cable creation, the cable list (search/filter/multi-select, state in the exported `cables` object), U/port validation summaries, and cable template/import/export XLSX. `configureCables({...})`. `exportAssetsXLSX` still lives in `app.js`.
- `catalogs.js` — asset catalogs modal (types, manufacturers, models, status/substatus, cable types), catalog editor, room editor, locations, and the `DEFAULT_ASSET_*` lists. `configureCatalogs({...})`.
- `runtime.js` — the exported `runtime` object holds app-level mutable variables used by both `app.js` and the extracted modules (`STORAGE`, the localStorage key that switches per user, and `pan`, the canvas pan state).

When moving more code out of `app.js`, keep the code verbatim: a `let` referenced on both sides of the boundary becomes a property of an exported object (rewrite every reference), functions/constants the module still needs from `app.js` are passed to its `configureX({...})` call, and `node --check` is not enough — run the tests, compare unresolved globals before/after, and load the page in a browser.

**Data model**: a project can contain multiple `rooms` (each with its own rows/racks/trays/cables — see `ROOM_KEYS` in `app.js`), and `assets` are project-global with a `roomId`/`rackId` pointing into whichever room they're mounted in (see `migrateGlobalAssets`/`ensureRooms` in `app.js` for the legacy-data migration from an earlier per-room asset model). Cloud sync persists a project as a single Supabase row per save (`projectCloudPayload`/`scheduleCloudSave` in `js/cloud-sync.js`), with local autosave to `localStorage` as a fallback (`dc-planner-autosave`) when offline or logged out ("guest mode").

**Testing**: `js/test/*.test.mjs` covers `geometry.js`, `routing.js`, and `utils.js` using only `node:test` + `node:assert` — no test framework, no jsdom. `js/test/helpers.mjs` stubs the minimum `globalThis.localStorage`/`globalThis.document` those modules need at import time (it must be imported before `state.js`/`geometry.js`/`routing.js` in any new test file). `js/test/modules.test.mjs` also reads the source of `app.js` and `js/*.js` and fails if any named import has no matching `export` (a bug class no other check catches, since `node --check` only validates syntax). `app.js`, `dialogs.js`, `styled-select.js` and the extracted feature modules (`pdf-report.js`, `inventory-import.js`, `cloud-sync.js`, `bulk-assets.js`, `cables.js`, `catalogs.js`) are not covered — they're DOM-driven and not currently designed to run outside a browser.

Language: UI strings, `state`/variable comments, and formatting logic (e.g. `formatAssetDate`) target pt-BR throughout; keep new user-facing strings in Portuguese consistent with the rest of the app.
