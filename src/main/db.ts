import { DatabaseSync } from 'node:sqlite'
import { migrate, PRAGMAS } from '../shared/sqlite'

/** SQLite connection for the Mac app. The schema and migrations are shared (`shared/sqlite.ts`). */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec(PRAGMAS)
  migrate(db)
  return db
}

export { migrate, transaction } from '../shared/sqlite'
