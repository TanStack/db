import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Standalone pure preparation. This script registers no native tests and
 * imports no production, QueryClient, provider or receiving driver. A strict
 * Node assertion adapter evaluates extracted checker functions. It establishes
 * pure equivalence/sensitivity, not native Vitest or receiving execution.
 */
const root = "/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-h02-metadata-receiving-v1"
const require = createRequire(resolve(root, `package.json`))
const ts = require(`typescript`)
const originalRoot = resolve(root, `../codex-misfits-h02-progress-main-v1`)
const ownerPath = `packages/db/tests/query/virtual-row-fields-oracle.test.ts`
const sharedPath = `packages/db/tests/query/virtual-row-fields-publication-oracle.ts`
const digest = (value) => createHash(`sha256`).update(value).digest(`hex`)
const text = (path) => readFileSync(path, `utf8`)
const parse = (path) =>
  ts.createSourceFile(path, text(path), ts.ScriptTarget.Latest, true)
const oldOwner = parse(resolve(originalRoot, ownerPath))
const newOwner = parse(resolve(root, ownerPath))
const sharedSource = parse(resolve(root, sharedPath))
const expect = (actual) => ({
  toEqual: (expected) => assert.deepEqual(actual, expected),
  toBe: (expected) => assert.ok(Object.is(actual, expected)),
  toBeGreaterThan: (expected) => assert.ok(actual > expected),
  toThrow: () => assert.throws(actual),
})
const allowed = new Set([
  sharedPath,
  `packages/db/tests/query/virtual-row-fields-source-oracle.ts`,
  `packages/db/tests/query/virtual-row-fields-support.ts`,
  `packages/db/tests/query/virtual-row-fields-grammar-oracle.ts`,
  `packages/db/tests/query/load-subset-retained-publication-oracle.ts`,
  `packages/db/tests/oracle-declaration.ts`,
  `packages/query-db-collection/tests/queued-answer-progress-oracle.ts`,
  `packages/query-db-collection/tests/queued-answer-metadata-oracle.ts`,
])
const cache = new Map()
function evaluate(source, file, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText
  const module = { exports: {} }
  const load = (id) => {
    if (id in imports) return imports[id]
    if (id === `vitest`) return { expect }
    if (id === `node:util` || id === `fast-check`) return require(id)
    const path = resolve(dirname(file), id.replace(/\.js$/, `.ts`))
    const relative = path.slice(root.length + 1)
    if (!path.startsWith(`${root}/`) || !allowed.has(relative))
      throw new Error(`pure loader rejected undeclared module: ${id}`)
    if (!cache.has(path)) cache.set(path, evaluate(text(path), path))
    return cache.get(path)
  }
  new Function(`require`, `module`, `exports`, compiled)(
    load,
    module,
    module.exports,
  )
  return module.exports
}
const functions = (source, names) =>
  names
    .map((name) => {
      const node = source.statements.find(
        (part) => ts.isFunctionDeclaration(part) && part.name?.text === name,
      )
      assert.ok(node, name)
      return node.getText(source).replace(/^export /, ``)
    })
    .join(`\n`)
const names = [
  `sourceOwnsMetadata`,
  `expectedAttributedRows`,
  `checkAttributedRows`,
  `publishedModelRows`,
  `expectedMetadataChanges`,
  `checkMetadataPublications`,
  `expectedJoinedMetadata`,
  `captureMetadataRows`,
]
const support = evaluate(
  text(resolve(root, `packages/db/tests/query/virtual-row-fields-support.ts`)),
  resolve(root, `packages/db/tests/query/virtual-row-fields-support.ts`),
)
const sourceModel = evaluate(
  text(
    resolve(
      root,
      `packages/db/tests/query/virtual-row-fields-source-oracle.ts`,
    ),
  ),
  resolve(root, `packages/db/tests/query/virtual-row-fields-source-oracle.ts`),
)
const shared = evaluate(
  text(resolve(root, sharedPath)),
  resolve(root, sharedPath),
)
const prelude = `const { expect, virtualFieldNames, expectedSourceMetadata } = require('inputs');\n`
const old = evaluate(
  prelude +
    functions(oldOwner, names) +
    `\nmodule.exports = { ${names.join(`,`)} };`,
  resolve(root, `old-functions.ts`),
  {
    inputs: { expect, ...support, ...sourceModel },
  },
)
const ownerModels = [`expectedAttributedRows`, `expectedJoinedMetadata`]
const current = evaluate(
  `const { attributeMetadataRows, sourceOwnsMetadata } = require('shared');\n` +
    functions(newOwner, ownerModels) +
    `\nmodule.exports = { ${ownerModels.join(`,`)} };`,
  resolve(root, `new-functions.ts`),
  { shared },
)
const unchangedNames = [
  `sourceOwnsMetadata`,
  `checkAttributedRows`,
  `publishedModelRows`,
  `expectedMetadataChanges`,
  `checkMetadataPublications`,
]
const bodyHashes = Object.fromEntries(
  unchangedNames.map((name) => {
    const body = (source) =>
      source.statements
        .find(
          (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
        )
        .body.getText(source)
    const before = digest(body(oldOwner))
    const after = digest(body(sharedSource))
    assert.equal(before, after, `${name} body changed`)
    return [name, { before, after, byteEqual: true }]
  }),
)
const printer = ts.createPrinter({ removeComments: true })
const print = (node, source) =>
  printer.printNode(ts.EmitHint.Unspecified, node, source)
const topVariables = (source) =>
  Object.fromEntries(
    source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) =>
        statement.declarationList.declarations.map((node) => [
          node.name.getText(source),
          print(node, source),
        ]),
      ),
  )
const oldVariables = topVariables(oldOwner)
const newVariables = topVariables(newOwner)
assert.deepEqual(
  newVariables,
  oldVariables,
  `owner grammars/reaches/budgets changed`,
)
const registrations = (source) =>
  source.statements
    .filter(
      (node) =>
        ts.isExpressionStatement(node) &&
        /^(?:test|describe|afterAll)\b/.test(node.expression.getText(source)),
    )
    .map((node) => print(node, source))
assert.deepEqual(
  registrations(newOwner),
  registrations(oldOwner),
  `owner registrations or controls changed`,
)

let attributionComparisons = 0
let joinedComparisons = 0
const shapes = [
  `structured-projection`,
  `structured-spread`,
  `functional-projection`,
  `functional-spread`,
  `functional-direct`,
]
for (const shape of shapes)
  for (const rows of [
    [],
    [{ id: 1, parentId: `a`, label: `one` }],
    [
      { id: 1, parentId: `a`, label: `one` },
      { id: `1`, parentId: `b`, label: `two` },
    ],
  ])
    for (const pending of [
      new Set(),
      new Set([1]),
      new Set([`1`]),
      new Set([1, `1`]),
    ])
      for (const key of [(id) => id, (id) => `projection-${typeof id}:${id}`]) {
        const args = [rows, shape, pending, `source`, `output`, key]
        assert.deepEqual(
          current.expectedAttributedRows(...args),
          old.expectedAttributedRows(...args),
        )
        attributionComparisons++
      }
for (const shape of shapes)
  for (const reverse of [false, true])
    for (const right of [
      [],
      [{ id: `r`, parentId: `a`, label: `right` }],
      [{ id: `r`, parentId: `missing`, label: `right` }],
    ])
      for (const pending of [
        new Set(),
        new Set([`a`]),
        new Set([`r`]),
        new Set([`a`, `r`]),
      ])
        for (const origin of [`local`, `remote`]) {
          const args = [
            [
              { id: `a`, parentId: `unused`, label: `left` },
              { id: `anchor`, parentId: `unused`, label: `untouched` },
            ],
            right,
            shape,
            reverse,
            pending,
            origin,
            `left`,
            `right`,
            `output`,
          ]
          assert.deepEqual(
            current.expectedJoinedMetadata(...args),
            old.expectedJoinedMetadata(...args),
          )
          joinedComparisons++
        }

// Replay the old owner's pure hostile calibrations through both formulations.
// Extract only their expressions/callbacks, never the owner test module.
let retainedHostileControls = 0
for (const wanted of [
  `rejects a hostile complete metadata result: %j`,
  `rejects a hostile metadata publication: %s`,
]) {
  let call
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments[0]?.text === wanted)
      call = node
    ts.forEachChild(node, visit)
  }
  visit(oldOwner)
  assert.ok(call)
  const corpus = call.expression.arguments[0].getText(oldOwner)
  const callback = call.arguments[1].getText(oldOwner)
  for (const formulation of [{ ...old }, { ...shared, ...current }]) {
    const result = evaluate(
      `const { expect, ...functions } = require('inputs');\n` +
        `const { ${names.filter((name) => name in formulation).join(`,`)} } = functions;\n` +
        `const cases = ${corpus}; const callback = ${callback}; for (const input of cases) callback(input); module.exports = cases.length;`,
      resolve(root, `old-controls.ts`),
      { inputs: { expect, ...formulation } },
    )
    retainedHostileControls += result
  }
}

const metadata = evaluate(
  text(
    resolve(
      root,
      `packages/query-db-collection/tests/queued-answer-metadata-oracle.ts`,
    ),
  ),
  resolve(
    root,
    `packages/query-db-collection/tests/queued-answer-metadata-oracle.ts`,
  ),
)
const progress = cache.get(
  resolve(
    root,
    `packages/query-db-collection/tests/queued-answer-progress-oracle.ts`,
  ),
)
const clone = structuredClone
function lawful(history) {
  const raw = (final, layer) => {
    const payload = progress.modelProgressValue(history, final)
    return payload.map((row) => ({
      ...row,
      ...(layer === `downstream`
        ? {
            observedKey:
              history.metadataKeys === `authored`
                ? `metadata-root-${row.id}`
                : `opaque-root-${row.id}`,
            observedCollectionId: `root`,
            observedOrigin: `remote`,
            observedPending: false,
          }
        : {}),
      $key:
        history.metadataKeys === `authored`
          ? `metadata-${layer}-${row.id}`
          : `opaque-${layer}-${row.id}`,
      $collectionId: layer,
      $hasPendingWrites: false,
      $origin: `remote`,
    }))
  }
  const prior = raw(false, `root`),
    final = raw(true, `root`)
  const priorDown = raw(false, `downstream`),
    finalDown = raw(true, `downstream`)
  const entries = (rows) => rows.map((row) => [row.$key, clone(row)])
  const delta = (before, after) => [
    ...before.map((value) => ({ type: `delete`, key: value.$key, value })),
    ...after.map((value) => ({ type: `insert`, key: value.$key, value })),
  ]
  const receipts = [
    {
      phase: `metadata-identities`,
      sourceId: `source`,
      rootId: `root`,
      downstreamId: `downstream`,
      keyLane: history.metadataKeys,
    },
    {
      phase: `initial-publication`,
      rows: prior,
      entries: entries(prior),
      downstream: priorDown,
      downstreamEntries: entries(priorDown),
    },
    { phase: `reload-start` },
    {
      phase: `retained-publication`,
      reason: `provider-hold-before-release`,
      pendingProviderAnswers: 1,
      rows: prior,
      entries: entries(prior),
      downstream: priorDown,
      downstreamEntries: entries(priorDown),
    },
    { phase: `answer-queued`, enqueueReturned: true },
    { phase: `answer-executed` },
    {
      phase: `public-change`,
      rows: prior,
      entries: entries(prior),
      changes: [],
    },
    {
      phase: `public-change`,
      rows: final,
      entries: entries(final),
      changes: delta(prior, final),
    },
    // A prior downstream no-op may follow a final root callback.
    {
      phase: `downstream-change`,
      rows: priorDown,
      entries: entries(priorDown),
      upstreamEntries: entries(final),
      changes: [],
    },
    {
      phase: `downstream-change`,
      rows: finalDown,
      entries: entries(finalDown),
      upstreamEntries: entries(final),
      changes: delta(priorDown, finalDown),
    },
    {
      phase: `final-publication`,
      rows: final,
      entries: entries(final),
      downstream: finalDown,
      downstreamEntries: entries(finalDown),
    },
    { phase: `cleanup-start` },
    { phase: `worker-cleaned` },
  ]
  // Match the real receipt transport's independent JSON value captures.
  return receipts.map((receipt) => JSON.parse(JSON.stringify(receipt)))
}
const pureResults = []
for (const history of metadata.metadataReceivingHistories) {
  const check = (receipts) => {
    const seen = new Set()
    const observe = metadata.createMetadataReceiptCheck(history, (state) =>
      seen.add(state),
    )
    for (const receipt of receipts) observe(receipt)
    for (const state of metadata.metadataReceivingStates)
      assert.ok(seen.has(state), state)
  }
  check(lawful(history))
  if (history.metadataKeys === `default`)
    check(
      JSON.parse(
        JSON.stringify(lawful(history)).replaceAll(`opaque-`, `renamed-`),
      ),
    )
  const faults = []
  const reject = (name, mutate) => {
    const receipts = clone(lawful(history))
    mutate(receipts)
    assert.throws(() => check(receipts), name)
    faults.push(name)
  }
  for (const layer of [`root`, `downstream`]) {
    const phase = layer === `root` ? `public-change` : `downstream-change`
    const event = (receipts) =>
      receipts.findLast((receipt) => receipt.phase === phase)
    for (const field of [
      `$key`,
      `$collectionId`,
      `$hasPendingWrites`,
      `$origin`,
    ]) {
      reject(`${layer}/missing-${field}`, (receipts) => {
        delete event(receipts).rows[0][field]
      })
      reject(`${layer}/message-${field}`, (receipts) => {
        event(receipts).changes[0].value[field] = `wrong`
      })
      for (const cut of [1, 3, 10])
        reject(`${layer}/snapshot-${cut}-${field}`, (receipts) => {
          receipts[cut][layer === `root` ? `rows` : `downstream`][0][field] =
            `wrong`
        })
    }
    reject(`${layer}/wrong-owner`, (receipts) => {
      event(receipts).rows[0].$collectionId = `source`
    })
    reject(`${layer}/wrong-origin`, (receipts) => {
      event(receipts).rows[0].$origin = `local`
    })
    reject(`${layer}/wrong-pending`, (receipts) => {
      event(receipts).rows[0].$hasPendingWrites = true
    })
    reject(`${layer}/stale-key`, (receipts) => {
      event(receipts).rows[0].$key =
        receipts[1][layer === `root` ? `rows` : `downstream`][0].$key
    })
    reject(`${layer}/duplicate-message`, (receipts) => {
      event(receipts).changes.push(clone(event(receipts).changes[0]))
    })
    reject(`${layer}/missing-message`, (receipts) => {
      event(receipts).changes.pop()
    })
    reject(`${layer}/duplicate-entry`, (receipts) => {
      event(receipts).entries.push(clone(event(receipts).entries[0]))
    })
    reject(`${layer}/no-callback`, (receipts) => {
      receipts.splice(
        receipts.findLastIndex((receipt) => receipt.phase === phase),
        1,
      )
    })
    reject(`${layer}/duplicate-batch`, (receipts) => {
      receipts.splice(10, 0, clone(event(receipts)))
    })
    reject(`${layer}/partial`, (receipts) => {
      event(receipts).rows = []
    })
    reject(`${layer}/held-identity-drift`, (receipts) => {
      const rows = receipts[3][layer === `root` ? `rows` : `downstream`]
      const entries =
        receipts[3][layer === `root` ? `entries` : `downstreamEntries`]
      rows[0].$key = `drifted-key`
      entries[0][0] = `drifted-key`
      entries[0][1].$key = `drifted-key`
    })
    reject(`${layer}/entry-key-disagrees-with-row`, (receipts) => {
      event(receipts).entries[0][0] = `wrong-entry-key`
    })
  }
  for (const field of [
    `observedKey`,
    `observedCollectionId`,
    `observedOrigin`,
    `observedPending`,
  ])
    reject(`downstream/wrong-${field}`, (receipts) => {
      receipts.findLast(
        (receipt) => receipt.phase === `downstream-change`,
      ).rows[0][field] = `wrong`
    })
  reject(`missing-final-cut`, (receipts) => {
    receipts.splice(10, 1)
  })
  reject(`missing-held-provider`, (receipts) => {
    receipts[3].pendingProviderAnswers = 0
  })
  reject(`callback-only-corruption-final-correct`, (receipts) => {
    receipts[7].rows[0].$origin = `local`
  })
  pureResults.push({
    cacheIdentity: history.cacheIdentity,
    keyLane: history.metadataKeys,
    accepted: history.metadataKeys === `default` ? 2 : 1,
    permittedGeneratedKeyRename: history.metadataKeys === `default`,
    rejected: faults.length,
    faults,
  })
}

const result = {
  kind: `standalone pure preparation; no native tests or production imported`,
  assertionAdapter: `node:assert/strict; native Vitest equality and compilation remain unexecuted`,
  byteEqualExtractedBodies: bodyHashes,
  unchangedOwnerTopVariables: Object.keys(oldVariables),
  unchangedOwnerRegistrations: registrations(oldOwner).length,
  attributionComparisons,
  joinedComparisons,
  retainedHostileControls,
  receivingCheckerControls: pureResults,
  limits: `Authored receipt controls are not real-host reach, production RED/GREEN, native collection, or a receiving mutant. Real update.previousValue path is not established.`,
}
const output = "/Users/kyle.mathews/programs/tanstack-db/.worktrees/codex-misfits-survey-open-items/docs/misfits-repairs/2026-10-29/integration/replay-H02-diagnosis-v1/metadata-receiving-independent-review-v1/independent-pure-result-v1.json"
writeFileSync(output, JSON.stringify(result, null, 2) + `\n`)
console.log(
  JSON.stringify(
    {
      attributionComparisons,
      joinedComparisons,
      retainedHostileControls,
      receivingCells: pureResults.length,
      rejected: pureResults.reduce((n, result) => n + result.rejected, 0),
      output,
    },
    null,
    2,
  ),
)
