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
- Optional **local AI double-check** (Qwen 2.5 1.5B via llama.cpp): verifies
  extracted fields entirely on-device — agreement raises confidence,
  disagreement flags the field with a suggestion; it never changes values
  on its own. Off by default; ~1 GB one-time model download; invoice text
  never leaves the machine.

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
tests) or for Electron (running the app / E2E). `npm test`, `npm run dev`
and `npm run test:e2e` call `scripts/ensure-native-abi.mjs`, which probes
the compiled binary and rebuilds only on a mismatch — via node-gyp
directly, so it also works with `ignore-scripts=true` in your npmrc
(where `npm rebuild` silently does nothing). Manual invocation:
`node scripts/ensure-native-abi.mjs node|electron`.

The example documents under `example/` are **confidential local fixtures**
and are gitignored. Parser accuracy tests against them are opt-in:

```bash
BELEGBAR_FIXTURE_TEXTS=/path/to/fixture-texts npm test -- tests/local
```

## CI

- **Test** (`.github/workflows/test.yml`): every push/PR — typecheck + unit
  tests on Ubuntu/macOS/Windows, plus a fixture-free Electron E2E smoke test
  (Linux under xvfb).
- **Build** (`.github/workflows/build.yml`): pushing a `v*` tag (matching
  `package.json` version) packages all six platform × arch combinations —
  macOS/Windows/Linux, each x64 **and** arm64 — on native runners (several
  native deps resolve host-specific binary packages, so no cross-compiling)
  and attaches installers to a draft GitHub release. The ARM runners
  (`windows-11-arm`, `ubuntu-24.04-arm`) are free for public repos only.

```bash
npm version 0.2.0 && git push --follow-tags   # triggers a release build
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
