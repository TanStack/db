import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
export const fixtureText = (mode) => `// SYNTHETIC delivery fixture; no Drizzle or PostgreSQL analysis\nconst order = ${mode === 'clear' ? "['createdAt', 'id']" : mode === 'changed' ? "['text']" : "['createdAt']"}\n`
export const revision = (text) => createHash('sha256').update(text).digest('hex')
export function check(file, version = 1, expectedRevision) {
  file = resolve(file)
  const text = readFileSync(file, 'utf8')
  const sourceRevision = revision(text)
  const status = expectedRevision && expectedRevision !== sourceRevision ? 'stale' : text.includes("'id'") ? 'pass' : 'fail'
  return {
    producer: { name: 'SYNTHETIC-endpoints-delivery-fixture', version: '0.1.0', analysis: 'string fixture only; no database facts' },
    source: { uri: pathToFileURL(file).href, revision: sourceRevision, documentVersion: version },
    status,
    findings: status !== 'fail' ? [] : [{ rule: 'ENDPOINT_ORDER_NOT_TOTAL', status: 'fail', severity: 'error', marker: text.includes("'text'") ? 'TRACK_C_CHANGED_28' : 'TRACK_C_INITIAL_17', message: 'Fixture order lacks id tie-breaker. Synthetic assumption: id is a non-null primary key.', range: { start: { line: 1, character: 14 }, end: { line: 1, character: text.split('\n')[1].length } }, suggestedReplacement: "['createdAt', 'id']" }],
    rerun: { command: process.execPath, args: ['cli.mjs', file], cwd: import.meta.dirname },
  }
}
