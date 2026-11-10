const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const W = '/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-progress-main-v1'
const H = '/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1'
const P = path.join(H, 'prepared-neighbor-controls-v3')
const C = path.join(P, 'native-calibration')
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const write = (p, v) => fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n', {flag:'wx'})
fs.mkdirSync(C, {recursive:true})
const ts = require(path.join(W, 'node_modules/typescript'))
const sourcePath = 'packages/query-db-collection/tests/queued-answer-progress-neighbors.test.ts'
const source = fs.readFileSync(path.join(W, sourcePath), 'utf8')
const sf = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let paths, title, suite
function visit(n) {
  if (ts.isVariableDeclaration(n) && n.name.getText(sf) === 'paths') paths = n.initializer
  if (ts.isCallExpression(n) && n.expression.getText(sf) === 'describe') suite = n.arguments[0]
  if (ts.isCallExpression(n) && ts.isCallExpression(n.expression) && n.expression.expression.getText(sf) === 'it.each') title = n.arguments[0]
  ts.forEachChild(n, visit)
}
visit(sf)
if (!paths || !ts.isArrayLiteralExpression(paths) || paths.elements.length !== 5 || !title || !suite || !ts.isStringLiteral(title) || !ts.isStringLiteral(suite)) throw Error('unexpected native registration source')
const names = paths.elements.map((e) => {
  if (!ts.isObjectLiteralExpression(e)) throw Error('unexpected path object')
  const prop = e.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'name')
  if (!prop || !ts.isStringLiteral(prop.initializer)) throw Error('unexpected path name')
  return prop.initializer.text
})
const table = paths.getText(sf)
const fixture = `import { describe, expect, it } from 'vitest'\n\n// Inert native registration calibration. No DB driver/model/production import.\n// The actual table initializer and title expressions are extracted unchanged.\nconst queuedAnswerExample = {}\nconst paths = ${table}\n\ndescribe(${suite.getText(sf)}, () => {\n  it.each(paths)(${title.getText(sf)}, ({ name }) => {\n    console.info('H02 inert native selection', { name, sourceModule: import.meta.url, testName: expect.getState().currentTestName })\n  })\n})\n`
write(path.join(C,'native-titles.test.ts'),fixture)
const config = `import { defineConfig } from 'vitest/config'\nexport default defineConfig({\n  root: ${JSON.stringify(C)},\n  test: { include: ['native-titles.test.ts'], environment: 'node', pool: 'forks', maxWorkers: 1, fileParallelism: false, execArgv: ['--max-old-space-size=384'], silent: false, reporters: ['verbose'], coverage: { enabled: false }, typecheck: { enabled: false }, testTimeout: 5000 },\n})\n`
write(path.join(C,'native.config.ts'),config)
write(path.join(C,'extraction-receipt.json'),{
  kind:'inert native registration only; no DB receiving execution',
  sourcePath: path.join(W,sourcePath),sourceSha256:sha(source),
  tableInitializer:table,tableSha256:sha(table),
  titleExpression:title.getText(sf),titleExpressionSha256:sha(title.getText(sf)),
  suiteExpression:suite.getText(sf),names,
  fixtureSha256:sha(fixture),configSha256:sha(config),
  substitution:'queuedAnswerExample is an inert empty object; only native names/selection/console retention are examined',
  limits:{nodeHeapMiB:384,workerHeapMiB:384,maxWorkers:1,testTimeoutMs:5000},
})
const v2 = JSON.parse(fs.readFileSync(path.join(H,'prepared-neighbor-controls-v2/source-freeze-v2.json')))
let count=0
for (const key of ['productionFiles','instrumentFiles','sharedInstrumentFiles']) for (const [file,hash] of Object.entries(v2[key])) {
  if (sha(fs.readFileSync(path.join(W,file))) !== hash) throw Error('V2 source changed: '+file)
  count++
}
write(path.join(P,'v2-source-before-edit-verification.json'),{allMatched:true,mapEntries:count,productionIdentity:v2.productionIdentity,sourceFreezeV2Sha256:sha(fs.readFileSync(path.join(H,'prepared-neighbor-controls-v2/source-freeze-v2.json')))})
console.log(JSON.stringify({directory:P,names,verifiedV2Entries:count}))
