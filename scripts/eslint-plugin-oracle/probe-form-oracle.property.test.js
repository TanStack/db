/**
 * Law (lint rule `oracle/probe-form`): a state probe in production source is
 * one expression statement of this exact form, and every other mention of
 * `__oracleProbe` is reported:
 *
 *   probing && globalThis.__oracleProbe?.(name, condition)
 *
 * `probing` is a declaration at the top of the probe's nearest enclosing
 * function, in exactly this form:
 *
 *   const probing = typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production'
 *
 * The guard is that identifier on the left of `&&`, resolved to that
 * declaration. A `let`, a declaration in another form, a missing declaration,
 * a declaration at module level, in a block, or in an outer function, or a
 * nearer `probing` that shadows it, makes the probe illegal. Why this form:
 * a bundler that sets `NODE_ENV` folds the initializer to the literal `false`,
 * and esbuild inlines a function-local constant, so a production build drops
 * every probe. esbuild does not inline a module-level constant once the module
 * imports anything (it keeps `var t=!1` and every probe), and it folds the
 * `&&` form `typeof process !== 'undefined' && ...` only to
 * `typeof process < "u" && false`, so both ship their probes. The `typeof`
 * check keeps an unbundled module from throwing where `process` does not
 * exist, and the function reads `process.env` once per call, not once per
 * record of a loop. The quoted strings may be written with any of the three
 * quote styles, because the repository writes strings with backticks. The
 * bare comparison `process.env.NODE_ENV !== 'production'` is no longer a guard. The receiver is `globalThis`, or `globalThis` cast with `as`. The name is a
 * string literal or a template literal without substitutions, and it names a
 * state as `package#name`. The statement has exactly two arguments,
 * and the condition contains no assignment, update, `new`, `delete`, `await`,
 * `yield`, function expression, class expression, or arrow function with a
 * block body. An arrow function with an expression body is allowed, under the
 * same rule for its body, so a condition can scan a collection
 * (`rows.every((row) => …)`). A call is allowed in a condition: a lint cannot
 * prove that a call is pure, which is a limit of this law.
 *
 * Authority: the maintainer's decision on the probe form, which replaces the
 * `devBuild()` guard ("this is a standalone framework now so we can't use the
 * devBuild() stuff", "our default lint forces the guard"); the maintainer's
 * decision of 2026-11-08 (option B, with the function-local placement that
 * the coordinator confirmed after the esbuild measurement), which replaces
 * the bare `NODE_ENV` comparison with a `probing` constant, because the bare
 * comparison throws in an unbundled browser module and reads `process.env`
 * per record inside loops; and the state probe
 * entry in docs/contributing/glossary.md, which names the call
 * `globalThis.__oracleProbe?.("package#name")`. AGENTS.md "Lint feedback while
 * you work" requires that an oracle-owned shortcut is reported, not disabled.
 *
 * Structure, following ORC-003:
 *   1. The grammar draws a program: one `probing` declaration at the top of
 *      the function, legal or one near-miss of its form or placement (or
 *      none), and a list of sites.
 *      Each site has a kind: a legal probe, or one near-miss that breaks
 *      exactly one part of the form.
 *   2. The model predicts the reports from the drawn kinds alone. A legal
 *      site under a legal declaration has no report. Every other site has one
 *      report for each mention of `__oracleProbe` on its line. The model does
 *      not read the rule.
 *   3. The drivers render the program as one TypeScript module: a module
 *      line, then one function whose first line is the declaration, then one
 *      site per line. They
 *      lint it on two receiving paths: the repository's root ESLint
 *      config, which is what CI and `pnpm lint` use, and the plugin's
 *      `production` config alone. The root config also lints the same program
 *      under a test file name, which must report nothing: the rule covers
 *      production source only.
 *   4. The comparison checks that each path's reports equal the prediction,
 *      as sorted (line, message) pairs.
 *   5. A census lints every kind and every pool value once. Random campaigns
 *      draw programs with fixed and random seeds. Declared reach fails when a
 *      legal form or a near-miss kind is never generated.
 */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import tsParser from '@typescript-eslint/parser'
import { ESLint, Linter } from 'eslint'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.js'
import {
  oraclePropertyOptions,
  oracleRuns,
} from '../../packages/db/tests/oracle-config.js'
import { createOracleReach } from '../../packages/db/tests/oracle-reach.js'
import oraclePlugin from './index.js'

const PROPERTY = `lint.probe-form`
const RULE = `oracle/probe-form`
const MESSAGE_ID = `probeForm`
const FIXED_SEED = 2234
const BASE_RUNS = 40
const repoRoot = fileURLToPath(new URL(`../../`, import.meta.url))
// Neither file has to exist: ESLint lints the text under this name. The
// production name must match the production glob, and the test name must not.
// Both sit under packages/db, whose tsconfig includes `src` and `tests`, so
// the typed rules of the root config can parse them.
const PRODUCTION_FILE = join(repoRoot, `packages/db/src/probe-form-scratch.ts`)
const TEST_FILE = join(repoRoot, `packages/db/tests/probe-form-scratch.test.ts`)

// -- Kinds: the model's spec -------------------------------------------------
//
// A kind is legal, or it is a near-miss that breaks one part of the form. The
// table below is the law's spec: the grammar draws kinds from it, the model
// predicts reports from it, and the renderer below writes each kind's text.
// `mentions` counts the `__oracleProbe` references that a near-miss writes: a
// cast receiver adds one, the cast's type member.

const castMentions = (site) => 1 + (site.cast ? 1 : 0)
const one = () => 1
const two = () => 2

const MODEL = {
  // `legal: 'declared'`: legal exactly when the function's declaration is.
  probe: { legal: `declared`, mentions: castMentions },
  // Its own arrow function declares `probing` in the exact form, so it is
  // legal under any outer declaration.
  'inner-declared': { legal: true, mentions: castMentions },
  // Its nearest function is an arrow without a declaration; the outer
  // function's `probing` does not count.
  'nested-function': { legal: false, mentions: castMentions },
  // The exact declaration in a block is not at the top of a function.
  'block-declared': { legal: false, mentions: castMentions },
  'if-guard': { legal: false, mentions: castMentions },
  'devbuild-and-guard': { legal: false, mentions: castMentions },
  'devbuild-only': { legal: false, mentions: castMentions },
  'no-guard': { legal: false, mentions: castMentions },
  'or-guard': { legal: false, mentions: castMentions },
  'negated-guard': { legal: false, mentions: castMentions },
  'other-guard': { legal: false, mentions: castMentions },
  'env-guard': { legal: false, mentions: castMentions },
  'shadowed-guard': { legal: false, mentions: castMentions },
  'optional-receiver': { legal: false, mentions: one },
  'non-optional-call': { legal: false, mentions: castMentions },
  'one-argument': { legal: false, mentions: castMentions },
  'three-arguments': { legal: false, mentions: castMentions },
  'spread-argument': { legal: false, mentions: castMentions },
  'bad-condition': { legal: false, mentions: castMentions },
  'bad-name': { legal: false, mentions: castMentions },
  'receiver-window': { legal: false, mentions: one },
  'cast-other-receiver': { legal: false, mentions: two },
  'double-cast': { legal: false, mentions: two },
  'computed-key': { legal: false, mentions: castMentions },
  alias: { legal: false, mentions: castMentions },
  'declared-type-key': { legal: false, mentions: one },
  'variable-initializer': { legal: false, mentions: castMentions },
  sequence: { legal: false, mentions: castMentions },
  ternary: { legal: false, mentions: castMentions },
}

// The module-level declaration of `probing`. Only `declared` is legal; each
// other kind breaks one part of its form, and `absent` writes none. A
// declaration that is not legal makes every probe site of the module illegal.
const DECLARATIONS = {
  declared: { legal: true },
  'let-declared': { legal: false },
  'no-typeof': { legal: false },
  'and-combined': { legal: false },
  'typeof-not-equal': { legal: false },
  'typeof-other-global': { legal: false },
  'true-branch': { legal: false },
  'equal-env': { legal: false },
  'reversed-env': { legal: false },
  'computed-env': { legal: false },
  // The exact form, but at module level, where esbuild keeps it.
  'module-level': { legal: false },
  absent: { legal: false },
}

// -- 1. Grammar ---------------------------------------------------------------
//
// Each site draws every pool, and its kind decides which pools apply. The
// pools are small on purpose: the census enumerates them, and the random
// campaigns combine them.

const QUOTES = [`'`, `"`, '`']

// Legal names, as written without their quotes. Each is `package#name`.
const LEGAL_NAMES = [
  `db#multiset.consolidate`,
  `db-ivm#multiset`,
  `offline-transactions#key-scheduler.retry`,
  `db#indexedDb.open`,
]

// Illegal names, as raw source. Each breaks the name form: no `#`, an empty
// package or name, an uppercase package, a second `#`, a space, or an
// expression instead of a literal.
const BAD_NAMES = [
  `'probe'`,
  `'db#'`,
  `'#name'`,
  `'Db#multiset'`,
  `'db#multiset#x'`,
  `'db#name with space'`,
  `nameVar`,
  '`db#${name}`',
]

// Conditions that the rule must accept. Some contain calls, which are allowed.
const LEGAL_CONDITIONS = [
  { text: `flag`, calls: false },
  { text: `input > 2`, calls: false },
  { text: `helper(input)`, calls: true },
  { text: `obj.value !== undefined`, calls: false },
  { text: `flag ? 1 : 0`, calls: false },
  { text: `typeof flag === 'boolean'`, calls: false },
  { text: `[input].length > 0`, calls: false },
  { text: `(flag || input === 3)`, calls: false },
  { text: `input?.toString() !== ''`, calls: true },
  { text: `probeCount(input, flag)`, calls: true },
  { text: `!flag`, calls: false },
  { text: `-input`, calls: false },
  { text: `void 0`, calls: false },
  // Arrows with an expression body (maintainer decision, 2026-11-05).
  { text: `items.every((item) => item > 0)`, calls: true, arrow: true },
  {
    text: `items.some(([a, b]) => a === b && typeof a === 'string')`,
    calls: true,
    arrow: true,
  },
  { text: `(() => flag)()`, calls: true, arrow: true },
]

// Each expression is a forbidden form: an assignment, an update, `new`,
// `delete`, `await`, `yield`, a function or class expression, an arrow with a
// block body, or an arrow whose expression body holds a forbidden form.
// The generated program is an async generator, so `await` and `yield` parse.
const FORBIDDEN_CONDITIONS = [
  `(flag = true)`,
  `(input += 1)`,
  `(input++)`,
  `(--input)`,
  `new Set()`,
  `delete obj.key`,
  `(await flag)`,
  `(yield input)`,
  `(() => { return flag })()`,
  `items.every((item) => (item = 1))`,
  `items.some((item) => item++)`,
  `(function () { return flag })()`,
  `(class {})`,
]

// A forbidden form can sit inside a larger condition, which the rule must
// still find. `X` marks where the form goes.
const WRAPS = [`X`, `helper(X)`, `[X]`, `{ key: X }`, `flag ? X : 0`, `(X, 0)`]

const CAST = `(globalThis as { __oracleProbe?: (name: string, condition: unknown) => void })`

const quoteArb = fc.constantFrom(...QUOTES)
const siteArbitrary = fc.record({
  kind: fc.constantFrom(...Object.keys(MODEL)),
  quote: quoteArb,
  cast: fc.boolean(),
  paren: fc.boolean(),
  guardParens: fc.boolean(),
  name: fc.constantFrom(...LEGAL_NAMES),
  badName: fc.constantFrom(...BAD_NAMES),
  cond: fc.constantFrom(...LEGAL_CONDITIONS),
  badCond: fc.constantFrom(...FORBIDDEN_CONDITIONS),
  wrap: fc.constantFrom(...WRAPS),
})

// Legal declarations are weighted, so most programs judge their sites under a
// legal declaration, and every near-miss declaration still appears.
const declarationArbitrary = fc.record({
  kind: fc.oneof(
    { weight: 3, arbitrary: fc.constant(`declared`) },
    { weight: 1, arbitrary: fc.constantFrom(...Object.keys(DECLARATIONS)) },
  ),
  quote: quoteArb,
  parens: fc.boolean(),
})

// A program is a declaration and a list of sites. Each site is one line in the
// rendered function.
const programArbitrary = fc.record({
  declaration: declarationArbitrary,
  sites: fc.array(siteArbitrary, { minLength: 1, maxLength: 6 }),
})

// The census gives every kind every pool value once, by index, so the
// declared reach does not depend on random draws, and it runs every site kind
// under every declaration kind. Each program is a fixed history, and it runs
// through the same model, drivers, and comparison.
function censusPrograms() {
  return Object.keys(DECLARATIONS).map((kind, i) => ({
    ...censusSites(),
    declaration: {
      kind,
      quote: QUOTES[i % QUOTES.length],
      parens: i % 2 === 0,
    },
  }))
}

function censusSites() {
  const sites = []
  const width = Math.max(
    LEGAL_NAMES.length,
    BAD_NAMES.length,
    LEGAL_CONDITIONS.length,
    FORBIDDEN_CONDITIONS.length,
    WRAPS.length,
    QUOTES.length,
    2,
  )
  for (const kind of Object.keys(MODEL)) {
    for (let i = 0; i < width; i++) {
      sites.push({
        kind,
        quote: QUOTES[i % QUOTES.length],
        cast: i % 2 === 0,
        paren: i % 3 === 0,
        guardParens: i % 2 === 1,
        name: LEGAL_NAMES[i % LEGAL_NAMES.length],
        badName: BAD_NAMES[i % BAD_NAMES.length],
        cond: LEGAL_CONDITIONS[i % LEGAL_CONDITIONS.length],
        badCond: FORBIDDEN_CONDITIONS[i % FORBIDDEN_CONDITIONS.length],
        wrap: WRAPS[i % WRAPS.length],
      })
    }
  }
  return { sites }
}

// -- 2. Model -----------------------------------------------------------------
//
// The model is the spec, written from the law. A kind is legal or it is not,
// and a near-miss predicts reports on its own line. `mentions` counts the
// references to `__oracleProbe` that the site writes, which the grammar knows
// from the kind and the cast flag. A legal probe exempts its own mentions: the
// callee property, and the cast's type member when it casts.

// The module line is 1, the function header 2, and the declaration 3, so
// site `index` is on line `index + 4`.
const siteLine = (index) => index + 4

function predictReports(program) {
  const declared = DECLARATIONS[program.declaration.kind].legal
  return program.sites.flatMap((site, index) => {
    const form = MODEL[site.kind]
    if (form.legal === true || (form.legal === `declared` && declared))
      return []
    return Array.from({ length: form.mentions(site) }, () => ({
      line: siteLine(index),
      messageId: MESSAGE_ID,
    }))
  })
}

// The root config's scope: production source has the rule as an error, and a
// test file has it off. Production source is `packages/*/src`, as the
// production config's globs say.
function predictSeverity(filePath) {
  return filePath.includes(`/src/`) ? `error` : `off`
}

// -- 3. Drivers ---------------------------------------------------------------

const envText = (q) => `process.env.NODE_ENV !== ${q}production${q}`
const paren = (text, parens) => (parens ? `(${text})` : text)
const typeofText = (q) => `typeof process === ${q}undefined${q}`
const ternary = (test, env, parens) =>
  `${paren(test, parens)} ? false : ${paren(env, parens)}`
const DECLARATION_RENDER = {
  declared: (d) =>
    `const probing = ${ternary(typeofText(d.quote), envText(d.quote), d.parens)}`,
  'let-declared': (d) =>
    `let probing = ${ternary(typeofText(d.quote), envText(d.quote), false)}`,
  'no-typeof': (d) => `const probing = ${envText(d.quote)}`,
  'and-combined': (d) =>
    `const probing = typeof process !== ${d.quote}undefined${d.quote} && ${envText(d.quote)}`,
  'typeof-not-equal': (d) =>
    `const probing = typeof process !== ${d.quote}undefined${d.quote} ? false : ${envText(d.quote)}`,
  'typeof-other-global': (d) =>
    `const probing = typeof window === ${d.quote}undefined${d.quote} ? false : ${envText(d.quote)}`,
  'true-branch': (d) =>
    `const probing = ${typeofText(d.quote)} ? true : ${envText(d.quote)}`,
  'equal-env': (d) =>
    `const probing = ${typeofText(d.quote)} ? false : process.env.NODE_ENV === ${d.quote}production${d.quote}`,
  'reversed-env': (d) =>
    `const probing = ${typeofText(d.quote)} ? false : ${d.quote}production${d.quote} !== process.env.NODE_ENV`,
  'computed-env': (d) =>
    `const probing = ${typeofText(d.quote)} ? false : process.env[${d.quote}NODE_ENV${d.quote}] !== ${d.quote}production${d.quote}`,
  'module-level': () => `// declared at module level`,
  absent: () => `// no probing declaration`,
}
// The exact declaration, for a site that declares its own.
const exactDeclaration = (q) =>
  `const probing = ${ternary(typeofText(q), envText(q), false)}`
// The module line: the exact declaration for `module-level`, else a comment.
const moduleLine = (d) =>
  d.kind === `module-level`
    ? `const probing = ${ternary(typeofText(d.quote), envText(d.quote), d.parens)}`
    : `// module`
const guardText = () => `probing`
const receiverText = (site) => {
  if (!site.cast) return `globalThis`
  return site.paren ? `(${CAST})` : CAST
}
const nameText = (site) => `${site.quote}${site.name}${site.quote}`
const legalCall = (site) =>
  `${receiverText(site)}.__oracleProbe?.(${nameText(site)}, ${site.cond.text})`
const withBadCondition = (site) => site.wrap.split(`X`).join(site.badCond)

// Each kind renders one site, on one line, ending in a semicolon.
const RENDER = {
  probe: (s) =>
    `${s.guardParens ? `(${guardText(s)})` : guardText(s)} && ${legalCall(s)};`,
  'inner-declared': (s) =>
    `void (() => { ${exactDeclaration(s.quote)}; ${guardText(s)} && ${legalCall(s)}; })();`,
  'nested-function': (s) =>
    `void (() => { ${guardText(s)} && ${legalCall(s)}; })();`,
  'block-declared': (s) =>
    `if (flag) { ${exactDeclaration(s.quote)}; ${guardText(s)} && ${legalCall(s)}; }`,
  'negated-guard': (s) => `!${guardText(s)} && ${legalCall(s)};`,
  'other-guard': (s) => `debugging && ${legalCall(s)};`,
  'env-guard': (s) =>
    `process.env.NODE_ENV !== ${s.quote}production${s.quote} && ${legalCall(s)};`,
  'shadowed-guard': (s) =>
    `{ const probing = flag; ${guardText(s)} && ${legalCall(s)}; }`,
  'if-guard': (s) => `if (${guardText(s)}) ${legalCall(s)};`,
  'devbuild-and-guard': (s) =>
    `devBuild() && ${guardText(s)} && ${legalCall(s)};`,
  'devbuild-only': (s) => `devBuild() && ${legalCall(s)};`,
  'no-guard': (s) => `${legalCall(s)};`,
  'or-guard': (s) => `${guardText(s)} || ${legalCall(s)};`,
  'optional-receiver': (s) =>
    `${guardText(s)} && globalThis?.__oracleProbe?.(${nameText(s)}, ${s.cond.text});`,
  'non-optional-call': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe(${nameText(s)}, ${s.cond.text});`,
  'one-argument': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe?.(${nameText(s)});`,
  'three-arguments': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe?.(${nameText(s)}, ${s.cond.text}, 0);`,
  'spread-argument': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe?.(...[${nameText(s)}, ${s.cond.text}]);`,
  'bad-condition': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe?.(${nameText(s)}, ${withBadCondition(s)});`,
  'bad-name': (s) =>
    `${guardText(s)} && ${receiverText(s)}.__oracleProbe?.(${s.badName}, ${s.cond.text});`,
  'receiver-window': (s) =>
    `${guardText(s)} && window.__oracleProbe?.(${nameText(s)}, ${s.cond.text});`,
  'cast-other-receiver': (s) =>
    `${guardText(s)} && (window as { __oracleProbe?: (name: string, condition: unknown) => void }).__oracleProbe?.(${nameText(s)}, ${s.cond.text});`,
  'double-cast': (s) =>
    `${guardText(s)} && (globalThis as unknown as { __oracleProbe?: (name: string, condition: unknown) => void }).__oracleProbe?.(${nameText(s)}, ${s.cond.text});`,
  'computed-key': (s) =>
    `${guardText(s)} && ${receiverText(s)}[${s.quote}__oracleProbe${s.quote}]?.(${nameText(s)}, ${s.cond.text});`,
  alias: (s, index) =>
    `const probe${index} = ${receiverText(s)}.__oracleProbe;`,
  'declared-type-key': (s, index) =>
    `const declared${index}: { __oracleProbe?: () => void } = {};`,
  'variable-initializer': (s, index) =>
    `const result${index} = ${guardText(s)} && ${legalCall(s)};`,
  sequence: (s) => `${guardText(s)} && ${legalCall(s)}, 0;`,
  ternary: (s) => `${guardText(s)} ? ${legalCall(s)} : undefined;`,
}

// A declaration ends in a semicolon, so a site that starts with `(` cannot
// continue it as a call.
const statement = (line) => (line.startsWith(`//`) ? line : `${line};`)

function renderProgram(program) {
  return [
    statement(moduleLine(program.declaration)),
    `export async function* run(input: number, flag: boolean): AsyncGenerator<number> {`,
    `  ${statement(DECLARATION_RENDER[program.declaration.kind](program.declaration))}`,
    ...program.sites.map(
      (site, index) => `  ${RENDER[site.kind](site, index)}`,
    ),
    `}`,
  ].join(`\n`)
}

// The rule's behavior is linted through the plugin's production config alone:
// the root config also enables typed rules, which need each file on disk, and
// the scratch text is never written. The root config's enablement is checked
// by asking it which rules apply to a file name, which reads nothing.
const eslint = new ESLint({ cwd: repoRoot })
const linter = new Linter({ configType: `flat`, cwd: repoRoot })

function probeReports(messages) {
  const fatal = messages.find((message) => message.fatal)
  if (fatal) {
    throw new Error(`the rendered program does not parse: ${fatal.message}`)
  }
  return messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => ({ line: message.line, messageId: message.messageId }))
}

function lintWithProductionConfig(code, filePath) {
  return probeReports(
    linter.verify(
      code,
      [
        { languageOptions: { parser: tsParser } },
        oraclePlugin.configs.production,
      ],
      { filename: filePath },
    ),
  )
}

async function severityInRepository(filePath) {
  const config = await eslint.calculateConfigForFile(filePath)
  const entry = config.rules?.[RULE]
  const severity = Array.isArray(entry) ? entry[0] : entry
  return severity === 2 || severity === `error` ? `error` : `off`
}

// -- 4. Comparison ------------------------------------------------------------

const reportKeys = (reports) =>
  reports.map((report) => `${report.line}:${report.messageId}`).sort()

function compareReports(path, actual, expected) {
  expect(reportKeys(actual), path).toEqual(reportKeys(expected))
}

function compareSeverity(path, actual, expected) {
  expect(actual, path).toBe(expected)
}

// -- 5. Reach and campaigns ---------------------------------------------------

const LEGAL_SUBSTATES = [
  `legal:cast`,
  `legal:parenthesized-cast`,
  `legal:template-name`,
  `legal:guard-parens`,
  `legal:call-condition`,
  `legal:arrow-condition`,
]
const DECLARATION_STATES = Object.keys(DECLARATIONS).map(
  (kind) => `declaration:${kind}`,
)
const STATES = [
  ...Object.keys(MODEL),
  ...LEGAL_SUBSTATES,
  ...DECLARATION_STATES,
  `declaration:parenthesized`,
  `declaration:template-quotes`,
]
const reach = createOracleReach(PROPERTY, STATES, { minimum: 1 })

function recordStates(program) {
  const declaration = program.declaration
  reach.reach(`declaration:${declaration.kind}`)
  const declared = DECLARATIONS[declaration.kind].legal
  if (declared && declaration.parens) reach.reach(`declaration:parenthesized`)
  if (declared && declaration.quote === '`')
    reach.reach(`declaration:template-quotes`)
  for (const site of program.sites) {
    reach.reach(site.kind)
    if (MODEL[site.kind].legal !== `declared` || !declared) continue
    if (site.cast) reach.reach(`legal:cast`)
    if (site.cast && site.paren) reach.reach(`legal:parenthesized-cast`)
    if (site.quote === '`') reach.reach(`legal:template-name`)
    if (site.guardParens) reach.reach(`legal:guard-parens`)
    if (site.cond.calls) reach.reach(`legal:call-condition`)
    if (site.cond.arrow) reach.reach(`legal:arrow-condition`)
  }
}

async function checkProgram(program) {
  reach.beginHistory()
  recordStates(program)
  const code = renderProgram(program)
  compareReports(
    `production file, production config`,
    lintWithProductionConfig(code, PRODUCTION_FILE),
    predictReports(program),
  )
  // The root config enables the rule for production source and nowhere else.
  compareSeverity(
    `production file, root config`,
    await severityInRepository(PRODUCTION_FILE),
    predictSeverity(PRODUCTION_FILE),
  )
  compareSeverity(
    `test file, root config: the rule covers production source only`,
    await severityInRepository(TEST_FILE),
    predictSeverity(TEST_FILE),
  )
}

function campaign(name) {
  it(`${name}: fixed-seed campaign`, async () => {
    await fc.assert(fc.asyncProperty(programArbitrary, checkProgram), {
      numRuns: oracleRuns(BASE_RUNS),
      seed: FIXED_SEED,
    })
  }, 600_000)
  it(`${name}: random-seed campaign`, async () => {
    await fc.assert(
      fc.asyncProperty(programArbitrary, checkProgram),
      oraclePropertyOptions(BASE_RUNS, PROPERTY),
    )
  }, 600_000)
}

describe(`probe form in production source`, () => {
  it(`census: every kind and every pool value is linted as predicted`, async () => {
    for (const program of censusPrograms()) await checkProgram(program)
  }, 600_000)
  campaign(`random programs`)
  afterAll(() => {
    if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT)
      console.log(`REACH`, JSON.stringify([...reach.counts()]))
    reach.assertReached()
  })
})

// The comparison must reject a wrong observation: a report on the wrong line,
// and a missing report. Both feed the same check that the campaigns use.
describe(`the comparison rejects wrong reports`, () => {
  it(`rejects a report on a neighboring line`, () => {
    expect(() =>
      compareReports(
        `calibration`,
        [{ line: 3, messageId: MESSAGE_ID }],
        [{ line: 2, messageId: MESSAGE_ID }],
      ),
    ).toThrow()
  })
  it(`rejects a missing report`, () => {
    expect(() =>
      compareReports(`calibration`, [], [{ line: 2, messageId: MESSAGE_ID }]),
    ).toThrow()
  })
})

declareOracle({
  model: [predictReports, predictSeverity],
  check: [compareReports, compareSeverity],
  grammar: [programArbitrary],
})
