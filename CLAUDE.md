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

**`app.js` (~5.5k lines) is the application itself**: Supabase auth wiring, cloud autosave/sync, undo/redo history, all canvas rendering (SVG-based pan/zoom/minimap), row/rack/tray editing UI, the asset inventory (CRUD, catalogs, bulk XLSX import/export, PDF reports), cable management UI, rack bayface (front-view) rendering, modals, and search. It is intentionally monolithic — everything that touches the DOM or app-level side effects (`render`, `toast`, modal open/close) lives here, not in `js/`.

**`js/` holds the framework-free, DOM-light modules `app.js` imports from**, split by concern:
- `state.js` — the single mutable `state` object. It is a module-level singleton: every file that imports `state` shares live mutations. **Never reassign `state`** (e.g. `state = {...}`) — always mutate its properties in place, or every importer's reference goes stale.
- `geometry.js` — physical layout math: row/rack positions, tray endpoints/bounds, snapping, rack↔tray connection points, segment intersection. Deliberately has no rendering or app-level side effects — this is the part of the app whose numbers must be physically correct.
- `routing.js` — cable routing on top of `geometry.js`: builds the rack+tray graph and computes the shortest physical path (automatic mode) or validates a user-picked waypoint path (manual mode), converting to real cable length in meters.
- `utils.js` — pure helpers (id generation, deep clone, date/number parsing and formatting in pt-BR, catalog fuzzy-matching, Excel column/port-template helpers).
- `dialogs.js` / `styled-select.js` — small custom UI primitives (confirm/prompt modals, dropdown widget) used in place of native browser dialogs/`<select>`.

**Data model**: a project can contain multiple `rooms` (each with its own rows/racks/trays/cables — see `ROOM_KEYS` in `app.js`), and `assets` are project-global with a `roomId`/`rackId` pointing into whichever room they're mounted in (see `migrateGlobalAssets`/`ensureRooms` in `app.js` for the legacy-data migration from an earlier per-room asset model). Cloud sync persists a project as a single Supabase row per save (`projectCloudPayload`/`scheduleCloudSave` in `app.js`), with local autosave to `localStorage` as a fallback (`dc-planner-autosave`) when offline or logged out ("guest mode").

**Testing**: `js/test/*.test.mjs` covers `geometry.js`, `routing.js`, and `utils.js` using only `node:test` + `node:assert` — no test framework, no jsdom. `js/test/helpers.mjs` stubs the minimum `globalThis.localStorage`/`globalThis.document` those modules need at import time (it must be imported before `state.js`/`geometry.js`/`routing.js` in any new test file). `app.js`, `dialogs.js`, and `styled-select.js` are not covered — they're DOM-driven and not currently designed to run outside a browser.

Language: UI strings, `state`/variable comments, and formatting logic (e.g. `formatAssetDate`) target pt-BR throughout; keep new user-facing strings in Portuguese consistent with the rest of the app.
