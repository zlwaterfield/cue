import { openDatabaseSync, type SQLiteBindValue, type SQLiteDatabase, type SQLiteStatement } from 'expo-sqlite'
import { migrate, PRAGMAS, type SqlDatabase, type SqlStatement, type SqlValue } from '@shared/sqlite'

/**
 * expo-sqlite's synchronous API in the shape the shared repository expects (the same one
 * `node:sqlite` has on the Mac), with the same schema, migrations and durability settings.
 *
 * Statements are cached by SQL and live as long as the app: the repository keeps some of
 * them, and its other queries come in a small, bounded set of shapes, so each is compiled
 * once per launch.
 */

function bind(params: SqlValue[]): SQLiteBindValue[] {
  return params.map((value) => (typeof value === 'bigint' ? Number(value) : value))
}

class Statement implements SqlStatement {
  constructor(private readonly statement: SQLiteStatement) {}

  // Each call resets the statement afterwards: a statement left mid-read would hold its
  // snapshot open and keep the WAL from being checkpointed.

  run(...params: SqlValue[]): unknown {
    const result = this.statement.executeSync(bind(params))
    result.resetSync()
    return { changes: result.changes }
  }

  get(...params: SqlValue[]): unknown {
    const result = this.statement.executeSync(bind(params))
    const row = result.getFirstSync()
    result.resetSync()
    return row ?? undefined
  }

  all(...params: SqlValue[]): unknown[] {
    const result = this.statement.executeSync(bind(params))
    const rows = result.getAllSync()
    result.resetSync()
    return rows
  }
}

class Database implements SqlDatabase {
  private cache = new Map<string, Statement>()

  constructor(private readonly db: SQLiteDatabase) {}

  exec(sql: string): void {
    this.db.execSync(sql)
  }

  prepare(sql: string): SqlStatement {
    let statement = this.cache.get(sql)
    if (!statement) {
      statement = new Statement(this.db.prepareSync(sql))
      this.cache.set(sql, statement)
    }
    return statement
  }
}

export function openDatabase(name = 'cue.sqlite'): SqlDatabase {
  const db = new Database(openDatabaseSync(name))
  db.exec(PRAGMAS)
  migrate(db)
  return db
}
