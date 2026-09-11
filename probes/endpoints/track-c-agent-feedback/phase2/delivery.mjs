import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export const checker = resolve(import.meta.dirname, '../../track-a-analysis/phase2/cli.mjs')
export const sha256 = text => createHash('sha256').update(text).digest('hex')
export function runCheck(file, expectedRevision, run = spawnSync) {
  file = resolve(file)
  let current
  try { current = sha256(readFileSync(file, 'utf8')) } catch(error) { return { status: 'error', code: 'SOURCE_UNAVAILABLE', source: { uri: pathToFileURL(file).href }, message: error.message, diagnostics: [] } }
  if (expectedRevision && current !== expectedRevision) return { status: 'stale', code: 'SOURCE_REVISION_CHANGED', source: { uri: pathToFileURL(file).href, sha256: current }, expectedRevision, diagnostics: [] }
  const result = run(process.execPath, [checker, 'check', '--adapter', 'drizzle', '--file', file], { encoding: 'utf8', timeout: 30000 })
  if (result.error || !result.stdout) return { status: 'error', code: 'CHECK_EXECUTION_FAILED', source: { uri: pathToFileURL(file).href, sha256: current }, message: result.error?.message ?? result.stderr, diagnostics: [] }
  const report = JSON.parse(result.stdout)
  if (report.status !== 'error' && expectedRevision && report.source?.sha256 !== expectedRevision) return { status: 'stale', code: 'SOURCE_REVISION_CHANGED_DURING_CHECK', source: report.source, expectedRevision, diagnostics: [], rerun: report.rerun }
  return { ...report, delivery: { checkerExit: result.status, adapter: 'drizzle', producer: 'Track A actual checker; disposable schema' } }
}
export function consume(report, currentRevision) {
  if (report.status === 'error') return { status: 'error', success: false, diagnostics: report.diagnostics ?? [], source: report.source, code: report.code }
  if (!report.source?.sha256 || report.source.sha256 !== currentRevision || report.status === 'stale') return { status: 'stale', success: false, diagnostics: [], source: report.source }
  if (report.status === 'supported') return { status: 'supported', success: true, diagnostics: report.diagnostics, source: report.source, evidence: report.check?.evidence }
  return { status: report.status, success: false, diagnostics: report.diagnostics ?? [], source: report.source, evidence: report.check?.evidence }
}
