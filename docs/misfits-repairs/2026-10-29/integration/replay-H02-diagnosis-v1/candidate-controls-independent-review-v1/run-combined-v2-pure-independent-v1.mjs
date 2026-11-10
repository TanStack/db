import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const root = '/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-candidate-controls-v1'
const here = new URL('./combined-v2-pure-independent-v1/', import.meta.url)
const require = createRequire(resolve(root, 'package.json'))
const ts = require('typescript')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const files = {
  driver: resolve(root, 'packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts'),
  fixture: resolve(root, 'packages/query-db-collection/tests/queued-answer-completion-fixture.ts'),
  reference: resolve(root, 'packages/db/tests/reference-expression-oracle.ts'),
  declaration: resolve(root, 'packages/db/tests/oracle-declaration.ts'),
  original: "/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/candidate-controls-receiving-source-preparation-v1/frozen-own-source-v1/sources/packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts",
}
const hashes = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, sha(readFileSync(path))]))
const source = (path) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const transpile = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const fixture = source(files.fixture)
const domain = fixture.statements.find((part) => ts.isFunctionDeclaration(part) && part.name?.text === 'isCompletionFullDomainLoad')
if (!domain) throw new Error('exact domain helper not found')
writeFileSync(new URL('domain-helper.mjs', here), `import { evaluateReferenceExpression } from './reference-expression.mjs'\n` + transpile(domain.getText(fixture)))
writeFileSync(new URL('reference-expression.mjs', here), transpile(readFileSync(files.reference, 'utf8')).replace("'./oracle-declaration.js'", "'./oracle-declaration.mjs'"))
writeFileSync(new URL('oracle-declaration.mjs', here), transpile(readFileSync(files.declaration, 'utf8')))
const blocks = {}
for (const name of ['driver', 'original']) {
  const tree = source(files[name]); let found
  const visit = (node) => {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === 'step.kind === `semantic`') found = node.thenStatement
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (!found) throw new Error('exact semantic dispatch block not found')
  const body = found.getText(tree).slice(1, -1)
  blocks[name] = { line: tree.getLineAndCharacterOfPosition(found.pos).line + 1, sha256: sha(body) }
  writeFileSync(new URL(`dispatch-${name}.mjs`, here), transpile(`export async function probe(action, rejectPhysical = false) {
    const events = []; const step = { action }; const model = {};
    const physicalAction = async () => { events.push('physical'); if (rejectPhysical) throw new Error('authored physical failure') };
    const stepCompletionModel = () => events.push('model'); const emit = () => events.push('emit');
    try { ${body} } catch (error) { return { events, error: String(error) } }
    return { events };
  }`))
}
const { isCompletionFullDomainLoad: full } = await import(new URL('domain-helper.mjs', here))
const { probe: current } = await import(new URL('dispatch-driver.mjs', here))
const { probe: original } = await import(new URL('dispatch-original.mjs', here))
const controls = []; let accepted = 0; let rejected = 0
const check = (name, actual, expected) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(name); controls.push({ name, actual, expected }); expected ? accepted++ : rejected++ }
const ref = (field) => ({ type: 'ref', path: [field] }); const val = (value) => ({ type: 'val', value });
const eq = (field, key) => ({ type: 'func', name: 'eq', args: [ref(field), val(key)] })
for (const [source, field] of [['children', 'parent'], ['marked', 'rowId']]) {
  check(`${source} complete key`, full(source, { where: eq(field, 3) }, 3), true)
  check(`${source} different key`, full(source, { where: eq(field, 4) }, 3), false)
  check(`${source} cap`, full(source, { where: eq(field, 3), limit: 2 }, 3), false)
  check(`${source} offset`, full(source, { where: eq(field, 3), offset: 1 }, 3), false)
  check(`${source} cursor`, full(source, { where: eq(field, 3), cursor: { whereFrom: eq(field, 3), whereCurrent: eq(field, 3) } }, 3), false)
}
check('children row-id-only is incomplete', full('children', { where: eq('id', 301) }, 3), false)
check('children narrowed conjunction is incomplete', full('children', { where: { type: 'func', name: 'and', args: [eq('parent', 3), eq('id', 301)] } }, 3), false)
check('children complete source', full('children', {}, 3), true)
const sequences = []
for (const type of ['source-answer', 'source-failure', 'apply-output', 'settle-optimistic', 'cleanup']) {
  for (const failure of [false, true]) {
    const actual = await current({ type }, failure); const prior = await original({ type }, failure)
    const expected = failure ? ['physical'] : ['physical', 'model', 'emit']
    if (JSON.stringify(actual.events) !== JSON.stringify(expected)) throw new Error(`current sequencing ${type}`)
    sequences.push({ type, failure, current: actual, original: prior, originalRejected: JSON.stringify(prior.events) !== JSON.stringify(expected) })
  }
}
for (const type of ['request-window', 'source-write']) {
  const actual = await current({ type });
  if (JSON.stringify(actual.events) !== JSON.stringify(['model', 'emit', 'physical'])) throw new Error(`authored cause sequence ${type}`)
  sequences.push({ type, failure: false, current: actual })
}
for (const [name, path] of Object.entries(files)) if (sha(readFileSync(path)) !== hashes[name]) throw new Error(`source changed during pure check: ${name}`)
const result = { status: 'pure instrument controls only; no receiving/product imports/histories/testCollection', sourceHashes: hashes, exactExtractedBlocks: blocks, domainControls: { total: controls.length, accepted, rejected, controls }, sequenceControls: sequences, limits: 'Extracted actual semantic block runs against trace-only callbacks. This calibrates source sequencing, not a native Collection or product RED.' }
writeFileSync(new URL('pure-source-controls.json', here), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ domainControls: controls.length, lawfulAccepted: accepted, hostileRejected: rejected, sequenceControls: sequences.length, originalSequenceRejections: sequences.filter((entry) => entry.originalRejected).length }))
