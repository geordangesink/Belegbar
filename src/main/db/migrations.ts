/**
 * Minimal forward-only migration runner.
 *
 * Migration 0001 creates the schema exactly as declared in ./schema.ts
 * (drizzle definitions are the source of truth; this SQL mirrors them,
 * including defaults). New migrations append to MIGRATIONS — never edit
 * an applied migration.
 */
import type BetterSqlite3 from 'better-sqlite3'

interface Migration {
  id: number
  name: string
  statements: string[]
}

const MIGRATION_0001: Migration = {
  id: 1,
  name: '0001_initial',
  statements: [
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      stored_relative_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/pdf',
      page_count INTEGER,
      invoice_number TEXT,
      invoice_date TEXT,
      service_date_from TEXT,
      service_date_to TEXT,
      receipt_date TEXT,
      payment_date TEXT,
      due_date TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unknown',
      issuer_name TEXT,
      issuer_address TEXT,
      issuer_country_code TEXT,
      issuer_tax_number TEXT,
      issuer_vat_id TEXT,
      recipient_name TEXT,
      recipient_address TEXT,
      recipient_country_code TEXT,
      recipient_tax_number TEXT,
      recipient_vat_id TEXT,
      recipient_is_business INTEGER,
      description TEXT,
      expense_category TEXT,
      original_currency TEXT,
      net_amount_original REAL,
      vat_amount_original REAL,
      gross_amount_original REAL,
      exchange_rate_to_eur REAL,
      exchange_rate_date TEXT,
      exchange_rate_source TEXT,
      net_amount_eur REAL,
      vat_amount_eur REAL,
      gross_amount_eur REAL,
      vat_rates_json TEXT NOT NULL DEFAULT '[]',
      vat_treatment_code TEXT,
      vat_treatment_label TEXT,
      vat_legal_basis TEXT,
      vat_classification_json TEXT,
      tax_period_year INTEGER,
      tax_period_quarter INTEGER,
      tax_period_month INTEGER,
      extracted_text TEXT,
      extraction_provider TEXT NOT NULL DEFAULT 'none',
      extraction_version TEXT NOT NULL DEFAULT '0',
      extraction_confidence REAL,
      field_confidence_json TEXT NOT NULL DEFAULT '{}',
      extraction_raw_json TEXT,
      review_status TEXT NOT NULL DEFAULT 'processing',
      review_reasons_json TEXT NOT NULL DEFAULT '[]',
      issues_json TEXT NOT NULL DEFAULT '[]',
      user_confirmed_at TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_documents_sha256 ON documents (sha256)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_direction ON documents (direction)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_review_status ON documents (review_status)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_period ON documents (tax_period_year, tax_period_quarter)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_invoice_date ON documents (invoice_date)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON documents (deleted_at)`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      document_id TEXT,
      event_type TEXT NOT NULL,
      previous_value_json TEXT,
      next_value_json TEXT,
      created_at TEXT NOT NULL,
      source TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_document ON audit_events (document_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events (created_at)`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      currency TEXT NOT NULL,
      date TEXT NOT NULL,
      rate_to_eur REAL NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_rates_currency_date ON exchange_rates (currency, date)`,
    `CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      direction TEXT NOT NULL,
      status TEXT NOT NULL,
      document_id TEXT,
      error_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs (status)`,
    `CREATE TABLE IF NOT EXISTS ocr_cache (
      key TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      confidence REAL,
      created_at TEXT NOT NULL
    )`
  ]
}

export const MIGRATIONS: Migration[] = [MIGRATION_0001]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.id

/** Apply all pending migrations. Idempotent; safe to call on every boot. */
export function runMigrations(sqlite: BetterSqlite3.Database): void {
  sqlite
    .prepare(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )`
    )
    .run()

  const appliedRows = sqlite.prepare('SELECT id FROM schema_migrations').all() as {
    id: number
  }[]
  const applied = new Set(appliedRows.map((r) => r.id))

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue
    const apply = sqlite.transaction(() => {
      for (const statement of migration.statements) {
        sqlite.prepare(statement).run()
      }
      sqlite
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString())
    })
    apply()
  }
}

export function appliedSchemaVersion(sqlite: BetterSqlite3.Database): number {
  try {
    const row = sqlite
      .prepare('SELECT MAX(id) AS version FROM schema_migrations')
      .get() as { version: number | null }
    return row.version ?? 0
  } catch {
    return 0
  }
}
