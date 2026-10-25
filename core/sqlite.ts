/**
 * The SQLite schema and the small slice of a SQLite driver Cue relies on. The Mac
 * app passes `node:sqlite`'s `DatabaseSync` as is; the iPhone app adapts expo-sqlite's
 * synchronous API to the same shape. Both run the same migrations, so a database is
 * the same file format on every device.
 */

export type SqlValue = string | number | bigint | null | Uint8Array

export interface SqlStatement {
  run(...params: SqlValue[]): unknown
  get(...params: SqlValue[]): unknown
  all(...params: SqlValue[]): unknown[]
}

export interface SqlDatabase {
  exec(sql: string): void
  prepare(sql: string): SqlStatement
}

export const MIGRATIONS: string[] = [
  // v1 — items, outbox, meta
  `
  CREATE TABLE items (
    id          TEXT PRIMARY KEY NOT NULL,
    date        TEXT NOT NULL,
    parent_id   TEXT,
    position    TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('text', 'bullet', 'todo')),
    text        TEXT NOT NULL DEFAULT '',
    done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
    version     TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT ''
  ) STRICT;

  CREATE INDEX items_live_by_date ON items (date) WHERE deleted = 0;
  CREATE INDEX items_by_version ON items (version);

  -- Local changes not yet acknowledged by a sync server (one row per item; the
  -- current row is what gets pushed, so repeated edits coalesce naturally).
  CREATE TABLE outbox (
    item_id TEXT PRIMARY KEY NOT NULL,
    version TEXT NOT NULL
  ) STRICT;

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  ) STRICT;
  `
]

/**
 * Durability settings: WAL journaling with synchronous=FULL means every committed
 * transaction survives an application crash *and* an OS crash / power loss, at the
 * cost of an fsync per commit (edits are batched, so this is cheap).
 */
export const PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`

export function migrate(db: SqlDatabase): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  if (version > MIGRATIONS.length) {
    throw new Error(
      `This database was created by a newer version of Cue (schema v${version}). Please update Cue.`
    )
  }
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[version])
      version += 1
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}

export function transaction<T>(db: SqlDatabase, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
