// Test-only preload for the real CLI subprocess. fd 3 is separate from public
// diagnostics. The parent forwards these actual calls to oracleProperty's
// collector; predictions and the public comparison never consume this stream.
import { writeSync } from 'node:fs'

globalThis.__oracleProbe = (probe, condition) => {
  writeSync(3, `${JSON.stringify([probe, Boolean(condition)])}\n`)
}
