// The Electron app passes its own database; constructing one here is a bug.
module.exports = function BetterSqlite3Unavailable() {
  throw new Error(`better-sqlite3 cannot load under Electron's ABI`)
}
