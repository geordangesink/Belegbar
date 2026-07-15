# Belegbar

**Belege rein. Steuern klar.**

Belegbar is a local-first desktop application for German freelancers, sole
proprietors and small service businesses. Drop income and expense PDFs into
two fields and see your current tax position: revenue, expenses, profit,
VAT payable, and an estimated income-tax reserve — with every number
traceable to its underlying documents.

> **Important:** Belegbar provides estimates for orientation only. It is
> **not tax advice** and none of its exports are official tax filings.
> Always verify figures with a tax adviser (Steuerberater:in) before filing.

## Highlights

- Two drop zones — **Einnahmen** and **Ausgaben** — that accept single or
  batched PDFs.
- Original PDFs are stored unchanged; imports are verified (SHA-256) before
  the source file is ever touched.
- Local extraction pipeline: native PDF text first, local OCR (German +
  English) for scanned documents. Nothing is sent to external services by
  default.
- Deterministic, versioned VAT classification (domestic 19 %/7 %, input VAT,
  EU B2B reverse charge, third-country services under § 3a Abs. 2 UStG,
  § 13b candidates, Kleinunternehmer) — uncertain cases always ask.
- Versioned income-tax estimate engines per tax year (§ 32a EStG).
- Foreign currencies preserved alongside EUR conversions with auditable
  exchange-rate sources.
- German and English UI; system/light/dark themes; works offline.

## Requirements

- Node.js ≥ 22 and npm
- macOS, Windows or Linux

## Development

```bash
npm install        # also rebuilds native modules for Electron
npm run dev        # start Electron + Vite dev server with HMR
```

Application data lives in the OS application-data directory
(e.g. `~/Library/Application Support/Belegbar` on macOS).
Set `BELEGBAR_DATA_DIR=/some/dir` to use an isolated data directory
(used by tests; handy during development).

## Testing

```bash
npm run typecheck        # strict TypeScript over main + renderer projects
npm test                 # Vitest unit + integration suites
npm run test:e2e         # Playwright end-to-end (launches the built app)
```

`better-sqlite3` is a native module compiled either for your Node (unit
tests) or for Electron (running the app / E2E). The npm scripts rebuild it
automatically: `npm test` targets Node, `npm run test:e2e` and
`npm run dev`/`package` target Electron. If you ever hit an ABI error, run
`npm rebuild better-sqlite3` (Node) or
`npx electron-builder install-app-deps` (Electron).

The example documents under `example/` are **confidential local fixtures**
and are gitignored. Parser accuracy tests against them are opt-in:

```bash
BELEGBAR_FIXTURE_TEXTS=/path/to/fixture-texts npm test -- tests/local
```

## Packaging

```bash
npm run package         # unpacked build into release/ for the current OS
npm run package:mac     # dmg (arm64 + x64)
npm run package:win     # NSIS installer
npm run package:linux   # AppImage + deb
```

## Architecture

```
src/
  shared/    Frozen contracts: domain model, IPC schemas (zod), preload API
  core/      Pure domain logic — no Electron/React imports
    parsing/   locale-aware number/date/invoice-text extraction
    vat/       versioned VAT classification engine
    tax/       versioned income-tax engines per year (§ 32a EStG)
    currency/  conversion + exchange-rate provider boundary
    files/     stored-filename generation + sanitization
    period/    tax-period + EÜR/accrual recognition rules
    summary/   overview / VAT / income-tax period summaries
  main/      Electron main: SQLite (drizzle), storage, import pipeline,
             extraction worker (pdf.js + tesseract.js), validated IPC
  preload/   contextBridge exposing the typed `window.belegbar` API
  renderer/  React UI (overview, documents, review, taxes, settings)
```

Security posture: `contextIsolation: true`, sandboxed renderer,
`nodeIntegration: false`, allowlisted IPC channels with zod-validated
payloads, no remote content, CSP `default-src 'self'`. The renderer never
receives filesystem paths beyond what the user explicitly drops or picks.

Tax rules are versioned and live exclusively in `src/core` — never in UI or
extraction code. GoBD-aware design (originals immutable, audit trail,
content hashes), but **no GoBD compliance claim** is made.
