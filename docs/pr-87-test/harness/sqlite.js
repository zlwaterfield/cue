// expo-sqlite's sync API over sql.js (in memory), for rendering in a browser.
class Result {
  constructor(stmt, db) { this.stmt = stmt; this.changes = db.getRowsModified() }
  getFirstSync() { return this.rows[0] ?? null }
  getAllSync() { return this.rows }
  resetSync() {}
}
class Statement {
  constructor(db, sql) { this.db = db; this.stmt = db.prepare(sql) }
  executeSync(params) {
    const rows = []
    this.stmt.bind(params)
    while (this.stmt.step()) rows.push(this.stmt.getAsObject())
    this.stmt.reset()
    const r = new Result(this.stmt, this.db)
    r.rows = rows
    return r
  }
}
export function openDatabaseSync() {
  const db = new globalThis.__SQL.Database()
  const one = (sql, params = []) => new Statement(db, sql).executeSync(params)
  return {
    execSync: (sql) => void db.exec(sql),
    prepareSync: (sql) => new Statement(db, sql),
    runSync: (sql, ...params) => one(sql, params.flat()),
    getFirstSync: (sql, ...params) => one(sql, params.flat()).getFirstSync(),
    getAllSync: (sql, ...params) => one(sql, params.flat()).getAllSync(),
    withTransactionSync: (fn) => fn()
  }
}
