import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ESLint, Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-direct-collection-mutations.js'
import config from '../eslint.config.mjs'

/**
 * The README permits Collection reads and forbids direct mutation calls in
 * feature code. Lexical shadowing cannot make an unrelated value a Collection.
 * Equivalent alias, relative, and barrel import spellings preserve that boundary.
 * Unrelated TypeScript import forms must not abort linting. Static template
 * member names have the same meaning as quoted string member names.
 * Moving a callback definition before an alias cannot change that alias's value
 * when the callback runs after initialization.
 *
 * This finite syntax oracle covers the bindings, call forms, and scopes below.
 * It does not model execution paths, inter-module re-exports, function arguments,
 * factory returns, dynamic method names, or aliases stored in new containers.
 * Mutable aliases conservatively retain their Collection classification.
 * There was no rule test owner before this suite; core Collection oracles do
 * not exercise ESLint's lexical binding boundary.
 */
const linter = new Linter()
const ruleId = 'architecture/no-direct-collection-mutations'

// Production driver: parse actual TypeScript and run the installed ESLint rule.
// The checkpoint is the complete diagnostic list returned by Linter.verify.
function check(code, expectedCount, options = {}) {
  const messages = linter.verify(code, [
    {
      languageOptions: { parser: tsParser, sourceType: 'module' },
      plugins: {
        architecture: { rules: { 'no-direct-collection-mutations': rule } },
      },
      rules: { [ruleId]: ['error', options] },
    },
  ])
  assert.deepEqual(
    messages.map(({ ruleId: id, messageId }) => ({ id, messageId })),
    Array.from({ length: expectedCount }, () => ({
      id: ruleId,
      messageId: 'noDirectMutation',
    })),
    code,
  )
}

// Reference model: every binding below denotes the imported Collection by
// construction. The operation table supplies the expected diagnostic count,
// independently of production's scope traversal or alias propagation.
const namedImport =
  "import { todoCollection as source } from '@/db/collections/todoCollection';"
const namespaceImport =
  "import * as source from '@/db/collections/todoCollection';"
const bindings = [
  ['direct', namedImport, '', 'source'],
  [
    'default',
    "import source from '@/db/collections/todoCollection';",
    '',
    'source',
  ],
  ['alias', namedImport, 'const target = source;', 'target'],
  [
    'two aliases',
    namedImport,
    'const middle = source; const target = middle;',
    'target',
  ],
  ['assignment', namedImport, 'let target; target = source;', 'target'],
  ['namespace member', namespaceImport, '', 'source.todoCollection'],
  [
    'namespace alias',
    namespaceImport,
    'const target = source.todoCollection;',
    'target',
  ],
  [
    'destructured',
    namespaceImport,
    'const { todoCollection } = source;',
    'todoCollection',
  ],
  [
    'renamed destructured',
    namespaceImport,
    'const { todoCollection: target } = source;',
    'target',
  ],
  [
    'destructuring assignment',
    namespaceImport,
    'let target; ({ todoCollection: target } = source);',
    'target',
  ],
  [
    'destructured alias chain',
    namespaceImport,
    'const { todoCollection: middle } = source; const target = middle;',
    'target',
  ],
  [
    'cyclic assignments',
    namedImport,
    'let target; let other; target = other; other = source; target = other; other = target;',
    'target',
  ],
]
const operations = [
  ['insert', 1],
  ['update', 1],
  ['delete', 1],
  ['upsert', 1],
  ['get', 0],
  ['has', 0],
]
const callForms = [
  (receiver, method) => `${receiver}.${method}('id')`,
  (receiver, method) => `${receiver}['${method}']('id')`,
  (receiver, method) => `${receiver}[\`${method}\`]('id')`,
  (receiver, method) => `${receiver}?.${method}?.('id')`,
  (receiver, method) => `(${receiver} as typeof ${receiver}).${method}('id')`,
  (receiver, method) => `${receiver}!.${method}('id')`,
]

// Grammar: all 12 bindings x 6 operations x 6 call forms x 2 callback orders.
// Imports and initialization always precede invocation: a temporal-dead-zone
// call is excluded. Each axis preserves value identity but challenges a
// different syntax path; removing it loses the corresponding witness above.
for (const [name, imports, declaration, receiver] of bindings) {
  test(`preserves Collection identity for ${name}`, () => {
    for (const [method, expected] of operations) {
      for (const call of callForms) {
        const callback = `function run() { ${call(receiver, method)}; }`
        check(`${imports} ${callback} ${declaration} run();`, expected)
        check(`${imports} ${declaration} ${callback} run();`, expected)
      }
    }
  })
}

test('keeps shadowed bindings and sibling scopes independent', () => {
  for (const name of ['todoCollection', 'c']) {
    const imports = `import { todoCollection as ${name} } from '@/db/collections/todoCollection';`
    check(
      `${imports} function clear(${name}: Set<string>) { ${name}.delete('id'); }`,
      0,
    )
    check(
      `${imports} { const ${name} = new Set(); ${name}.delete('id'); } ${name}.delete('id');`,
      1,
    )
    check(
      `${namedImport} function write() { const ${name} = source; ${name}.delete('id'); }
      function clear(${name}: Map<string, string>) { ${name}.delete('id'); }`,
      1,
    )
    check(
      `${imports} function clear(${name}: Set<string>) { const alias = ${name}; alias.delete('id'); }`,
      0,
    )
  }
})

test('resolves alias dependencies independently of function definition order', () => {
  check(
    `${namedImport}
    let first, second;
    function linkSecond() { second = first; }
    function write() { second.insert({ id: 'id' }); }
    function linkFirst() { first = source; }
    linkFirst(); linkSecond(); write();`,
    1,
  )
})

test('terminates for alias cycles without Collection imports', () => {
  check(
    "let first, second; first = second; second = first; first.delete('id');",
    0,
  )
})

test('honors configured import paths and mutation names', () => {
  const code =
    "import { todoCollection } from 'custom/collections'; todoCollection.save('id'); todoCollection.get('id');"
  check(code, 0)
  check(code, 1, {
    collectionImportPatterns: ['^custom/'],
    mutationMethods: ['save'],
  })
  check(
    "import { todoCollection } from '@/other/module'; todoCollection.insert('id');",
    0,
  )
})

test('keeps mutable aliases classified after a Collection assignment', () => {
  check(
    `${namedImport} let target = source; target = new Set(); target.delete('id');`,
    1,
  )
})

// These literals describe the intended import boundary, independently of the
// rule's regular expressions. Near-neighbor paths must remain unrelated.
const collectionPaths = [
  '@/db/collections/todoCollection',
  '@/db/collections',
  '@/db/collections/',
  './db/collections/todoCollection',
  '../db/collections/todoCollection',
  '../../db/collections/todoCollection',
  '../../../db/collections/todoCollection',
  '../../db/collections',
]
const unrelatedPaths = [
  '@/db/collections-extra/todoCollection',
  '../../db/collections-extra/todoCollection',
  '@/other/collections/todoCollection',
  'other/db/collections/todoCollection',
]

for (const source of [...collectionPaths, ...unrelatedPaths]) {
  test(`classifies the import boundary for ${source}`, () => {
    for (const [method, mutationCount] of operations) {
      check(
        `import { todoCollection } from '${source}'; todoCollection.${method}('id');`,
        collectionPaths.includes(source) ? mutationCount : 0,
      )
    }
  })
}

test('keeps TypeScript import-equals from aborting unrelated lint diagnostics', () => {
  for (const imports of [
    "import fs = require('fs');",
    "import type fs = require('fs');",
    'declare namespace library { const fs: Set<string> } import fs = library.fs;',
  ]) {
    check(`${imports} fs.delete('id');`, 0)
    check(`${imports} ${namedImport} source.insert('id');`, 1)
  }
})

test('distinguishes escaped static templates from dynamic member names', () => {
  check(namedImport + ' source[`\\u0069nsert`]({ id: "id" });', 1)
  check(namedImport + ' const method = "insert"; source[`${method}`]({});', 0)
  check(namedImport + ' const suffix = ""; source[`insert${suffix}`]({});', 0)
})

// Receiving boundary: the real example config must enable this rule for features
// and permit the same write in an action. Unit-rule success alone cannot prove it.
test('enforces the configured feature boundary and permits action writes', async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    overrideConfigFile: true,
    overrideConfig: config,
  })
  for (const source of [...collectionPaths, ...unrelatedPaths]) {
    for (const [filename, method, expected] of [
      [
        'src/features/todos/probe.ts',
        'insert',
        collectionPaths.includes(source)
          ? ['tanstack-architecture/no-direct-collection-mutations']
          : [],
      ],
      ['src/db/actions/probe.ts', 'insert', []],
      ['src/features/todos/probe.ts', 'get', []],
    ]) {
      const [result] = await eslint.lintText(
        `import { todoCollection as source } from '${source}'; source.${method}({ id: 'id' });`,
        { filePath: filename },
      )
      assert.deepEqual(
        result.messages.map(({ ruleId }) => ruleId),
        expected,
        `${filename}: ${source}`,
      )
    }
  }
})
