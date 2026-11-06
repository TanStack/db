/**
 * The gap report oracles' shared history grammar, fixture rendering, and
 * model (see gap-report-oracle.property.test.mjs for the laws). The static
 * oracle runs the CLI's static half in-process on these fixtures; the
 * end-to-end oracle runs the real CLI on them.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'

const SOURCE = `src/sut.ts`
// A second source in the same package, which the first imports from.
const LIB = `src/lib.ts`
const ORACLE_FILES = [`a`, `b`]
const METHOD_NAMES = [`run`, `step`, `tick`]

// ## History grammar
//
// A history is a source file, the test files of its package, and how the
// CLI is run. The source holds one to three generated functions over `x`,
// each a free function or a method of class `C0` or `C1`; methods take
// names in order from `run`, `step`, `tick`, so the two classes share names.
// A statement pushes a label (quoted with `'` or a backtick), branches on
// one comparison against a constant, throws on a value no input reaches,
// fires a probe through a guard, a helper, a probe-only `if` or block, or
// calls a later function (by name, or through `this` within a class).
//
// Oracle files `a` and `b` declare owns entries: per function, or for the
// whole source, as strings or template literals. File `c` is an ordinary
// test file. A test calls one function with one input and observes the
// output, either through `__oracleObserve` or through `expect`; it may judge,
// reporting a verdict when the output differs from the unmutated one; it may
// register a route, chosen independently of its name; and it may also
// observe a clock, which makes it nondeterministic.
//
// A declaration fault breaks one owns declaration or one owner, and the run
// must then fail. The stability edit says how the source is changed for law
// 8. The steps are law 9's edits, applied one at a time between checks
// through the daemon (see `applyEdit`). The witness module adds functions whose outcomes the generated part
// reaches rarely, each with its own tests, so constructed histories reach
// every class.
const comparison = fc.constantFrom(`<`, `<=`, `>`, `>=`, `===`, `!==`)
const quote = fc.constantFrom(`'`, `\``)
const constant = fc.integer({ min: 0, max: 9 })
const statement = fc.oneof(
  fc.record({ kind: fc.constant(`push`), quote }),
  fc.record({
    kind: fc.constant(`if`),
    op: comparison,
    k: constant,
    not: fc.boolean(),
    quote,
  }),
  fc.record({
    kind: fc.constant(`throwIf`),
    message: fc.constantFrom(`plain`, `assertion`),
  }),
  fc.record({ kind: fc.constant(`guard`), op: comparison, k: constant, quote }),
  // The probe form before the maintainer's decision: production code now.
  fc.record({ kind: fc.constant(`oldProbe`) }),
  fc.record({ kind: fc.constant(`mixed`), op: comparison, k: constant, quote }),
  fc.record({
    kind: fc.constant(`helperCall`),
    helper: fc.constantFrom(`report`, `reportTwice`),
  }),
  fc.record({ kind: fc.constant(`mixedHelperCall`) }),
  fc.record({ kind: fc.constant(`probeIf`), op: comparison, k: constant }),
  fc.record({ kind: fc.constant(`probeBlock`), op: comparison, k: constant }),
  fc.record({ kind: fc.constant(`elseIf`), op: comparison, k: constant, quote }),
  fc.record({ kind: fc.constant(`call`), target: fc.nat({ max: 3 }) }),
  // A function passed as a value, a class constructed with `new`, a method
  // called through a field, and a method called through `.bind`.
  fc.record({ kind: fc.constant(`valueCall`), target: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant(`newCall`), target: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant(`fieldCall`), target: fc.nat({ max: 3 }) }),
  fc.record({ kind: fc.constant(`bindCall`), target: fc.nat({ max: 3 }) }),
  // A class passed as a value to a factory.
  fc.record({ kind: fc.constant(`factoryCall`), target: fc.nat({ max: 3 }) }),
  // A call to a function of the library file, by its name or an import alias.
  fc.record({
    kind: fc.constant(`libCall`),
    target: fc.nat({ max: 3 }),
    alias: fc.boolean(),
  }),
)
const libStatement = fc.oneof(
  fc.record({ kind: fc.constant(`push`), quote }),
  fc.record({
    kind: fc.constant(`if`),
    op: comparison,
    k: constant,
    not: fc.boolean(),
    quote,
  }),
)
const routes = [
  `fixed seed`,
  `fixed history`,
  `case`,
  `random seed`,
  `calibration`,
  `probe calibration`,
  `determinism`,
]
const testCase = fc.record({
  file: fc.constantFrom(`a`, `b`, `c`),
  route: fc.constantFrom(...routes),
  registered: fc.constantFrom(true, true, true, false),
  name: fc.constantFrom(`route`, `plain`),
  fn: fc.nat({ max: 7 }),
  input: constant,
  judges: fc.boolean(),
  law: fc.constantFrom(`L`, `reach agreement`),
  channel: fc.constantFrom(`observe`, `observe`, `expect`),
  flaky: fc.constantFrom(false, false, false, true),
  // A test may judge by an `expect` assertion instead of a verdict, as older
  // oracles do; that is a kill under an unnamed law. A soft assertion
  // (`expect.soft`) records its failure and lets the test go on to its next
  // campaign.
  judgeBy: fc.constantFrom(`verdict`, `verdict`, `assertion`, `soft`),
  // A test may run a second campaign, on its own route and input, as
  // `runOracleCampaign` does.
  then: fc.option(
    fc.record({ route: fc.constantFrom(...routes), input: constant }),
    { nil: null },
  ),
})
// Law 9's edits. Each content edit changes what some evidence depends on:
// a test file, a source statement, the source's line numbers, an owns list,
// the authored mutant, a helper module that only file b imports, the seed
// (file a judges only under seed 1), the set of oracle files, or the CLI's
// own code (`cli` changes the summary's wording in the copy of the CLI that
// the history runs). `restart` stops the daemon, and `revert` returns to the
// state before the last step.
const edits = [
  `test`,
  `source`,
  `prepend`,
  `owns`,
  `authored`,
  `helper`,
  `seed`,
  `newOracle`,
  `cli`,
  `restart`,
  `revert`,
]
const histories = fc.record({
  functions: fc.array(fc.array(statement, { minLength: 1, maxLength: 5 }), {
    minLength: 1,
    maxLength: 3,
  }),
  containers: fc.array(fc.constantFrom(`free`, `free`, `C0`, `C1`), {
    maxLength: 3,
  }),
  // A free function may carry an overload signature before its body.
  overloads: fc.array(fc.boolean(), { maxLength: 3 }),
  owners: fc.array(fc.constantFrom(`a`, `b`, `both`, `none`), { maxLength: 3 }),
  // The library file's functions and who owns each directly.
  library: fc.array(fc.array(libStatement, { minLength: 1, maxLength: 3 }), {
    maxLength: 2,
  }),
  libraryOwners: fc.array(fc.constantFrom(`a`, `b`, `none`, `none`), {
    maxLength: 2,
  }),
  wholeFile: fc.constantFrom(`none`, `none`, `none`, `a`, `b`),
  template: fc.boolean(),
  tests: fc.array(testCase, { minLength: 1, maxLength: 5 }),
  // The witness module: all of it, or only the functions whose outcomes
  // need real test runs (see `captureWitness`).
  witness: fc.constantFrom(false, true, `capture`),
  authored: fc.option(
    fc.record({
      stmt: fc.nat({ max: 20 }),
      kind: fc.constantFrom(`apply`, `apply`, `stale`, `ambiguous`),
    }),
    { nil: null },
  ),
  fault: fc.constantFrom(
    `none`,
    `none`,
    `none`,
    `none`,
    `none`,
    `none`,
    `badEntry`,
    `missingSource`,
    `nonLiteral`,
    `brokenOwner`,
  ),
  stability: fc.constantFrom(
    `none`,
    `none`,
    `none`,
    `prepend`,
    `insertGuard`,
    `reformat`,
  ),
  // Most histories have no steps, which keeps the campaign's cost down.
  // Whether the run asks for the ordinary tests' outcome (`--ordinary`).
  ordinary: fc.boolean(),
  // A second authored mutant, on the next statement, so that two patched
  // sources are judged in the same run and neither may see the other's.
  secondAuthored: fc.boolean(),
  steps: fc.oneof(
    { weight: 5, arbitrary: fc.constant(null) },
    {
      weight: 1,
      arbitrary: fc.array(fc.constantFrom(...edits), {
        minLength: 1,
        maxLength: edits.length,
      }),
    },
  ),
})

// The witness module: functions whose outcome classes generated histories
// reach rarely, each with its own owners and tests.
const kill = { kind: `if`, op: `>`, k: 4, not: false, quote: `'` }
const push = { kind: `push`, quote: `'` }
const judging = (file, route, input, extra = {}) => ({
  file,
  route,
  registered: true,
  name: `route`,
  input,
  judges: true,
  law: `L`,
  channel: `observe`,
  flaky: false,
  judgeBy: `verdict`,
  then: null,
  ...extra,
})
const witness = [
  { id: `w_kill`, owners: [`a`], body: [kill], tests: [judging(`a`, `fixed seed`, 7)] },
  { id: `w_both`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1), judging(`a`, `random seed`, 1)] },
  { id: `w_overloaded`, owners: [`a`], overload: true, body: [push], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_random`, owners: [`a`], body: [kill], tests: [judging(`a`, `random seed`, 7)] },
  { id: `w_agree`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1, { law: `reach agreement` })] },
  { id: `w_agreeboth`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1, { law: `reach agreement` }), judging(`a`, `case`, 1)] },
  { id: `w_crash`, owners: [`a`], body: [{ kind: `throwIf`, message: `assertion` }, push], tests: [judging(`a`, `case`, 3)] },
  { id: `w_frame`, owners: [`a`], body: [push], tests: [judging(`a`, `calibration`, 1)] },
  { id: `w_unregistered`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1, { registered: false })] },
  { id: `w_flaky`, owners: [`b`], body: [push], tests: [judging(`b`, `fixed seed`, 1, { flaky: true })] },
  { id: `w_observe`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed history`, 1, { judges: false })] },
  { id: `w_expect`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed history`, 1, { judges: false, channel: `expect` })] },
  { id: `w_noobs`, owners: [`a`], body: [kill], tests: [judging(`a`, `fixed seed`, 7), judging(`a`, `fixed seed`, 1)] },
  { id: `w_unreached`, owners: [`a`], body: [push], tests: [] },
  { id: `w_ordinary`, owners: [`a`], body: [push], tests: [judging(`c`, `case`, 1)] },
  { id: `w_mixed`, owners: [`a`], body: [{ kind: `mixed`, op: `>`, k: 4, quote: `'` }, { kind: `mixedHelperCall` }], tests: [judging(`a`, `fixed seed`, 7)] },
  { id: `w_else`, owners: [`a`], body: [{ kind: `elseIf`, op: `>`, k: 4, quote: `'` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_callsprobe`, owners: [`a`], body: [{ kind: `call`, to: `w_probeonly` }, push], tests: [judging(`a`, `fixed seed`, 7)] },
  { id: `w_probeonly`, owners: [], body: [{ kind: `guard`, op: `>`, k: 4, quote: `'` }, { kind: `probeIf`, op: `>`, k: 4 }], tests: [] },
  // A chain of probe helpers, each declared after its caller.
  { id: `w_callschain`, owners: [`a`], body: [{ kind: `call`, to: `w_probe1` }, push], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_probe1`, owners: [], body: [{ kind: `call`, to: `w_probe2` }], tests: [] },
  { id: `w_probe2`, owners: [], body: [{ kind: `guard`, op: `>`, k: 4, quote: `\`` }], tests: [] },
  { id: `w_oldprobe`, owners: [`a`], body: [{ kind: `oldProbe` }, push], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_foreign`, owners: [`b`], body: [push], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_union`, owners: [`a`, `b`], body: [push], tests: [judging(`b`, `fixed seed`, 1)] },
  { id: `w_unowned`, owners: [], body: [push], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_entry`, owners: [`a`], body: [{ kind: `call`, to: `w_mid` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_mid`, owners: [], body: [{ kind: `call`, to: `w_leaf` }], tests: [] },
  { id: `w_leaf`, owners: [], body: [push], tests: [] },
  { id: `W0.run`, owners: [`a`], body: [{ kind: `call`, to: `W0.step` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `W0.step`, owners: [], body: [push], tests: [] },
  { id: `W1.run`, owners: [`b`], body: [push], tests: [judging(`b`, `fixed seed`, 1)] },
  // Owned across files: through an import, and through an import alias.
  { id: `w_libentry`, owners: [`a`], body: [{ kind: `libCall`, to: `wg0`, alias: false }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_libalias`, owners: [`a`], body: [{ kind: `libCall`, to: `wg1`, alias: true }], tests: [judging(`a`, `fixed seed`, 1)] },
  // Owned through references the type checker resolves: a value, a field,
  // a class constructed with `new` (which owns all its methods), and `.bind`.
  { id: `w_value`, owners: [`a`], body: [{ kind: `valueCall`, to: `w_valued` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `w_valued`, owners: [], body: [push], tests: [] },
  { id: `W2.run`, owners: [`a`], body: [{ kind: `fieldCall`, to: `W3.run` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `W3.run`, owners: [], body: [push], tests: [] },
  { id: `W3.step`, owners: [], body: [push], tests: [] },
  { id: `w_new`, owners: [`a`], body: [{ kind: `newCall`, to: `W4.run` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `W4.run`, owners: [], body: [push], tests: [] },
  { id: `W4.step`, owners: [], body: [push], tests: [] },
  { id: `W5.run`, owners: [`a`], body: [{ kind: `bindCall`, to: `W5.step` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `W5.step`, owners: [], body: [push], tests: [] },
  // A class passed to a factory as a value brings all its methods.
  { id: `w_factory`, owners: [`a`], body: [{ kind: `factoryCall`, to: `W6.run` }], tests: [judging(`a`, `fixed seed`, 1)] },
  // A constructor is a function: `new W7()` brings it, and it brings what it
  // refers to.
  { id: `w_ctor`, owners: [`a`], body: [{ kind: `newCall`, to: `W7.run` }], tests: [judging(`a`, `fixed seed`, 1)] },
  { id: `W7.constructor`, owners: [], signature: `constructor()`, field: `tag = 'a'`, body: [{ kind: `primeCall` }], tests: [] },
  { id: `W7.prime`, owners: [], signature: `prime(): void`, body: [{ kind: `setTag` }], tests: [] },
  { id: `W7.run`, owners: [], body: [{ kind: `pushTag` }], tests: [] },
  { id: `W6.run`, owners: [], body: [push], tests: [] },
  { id: `W6.step`, owners: [], body: [push], tests: [] },
  // An assertion judges, and a second campaign catches what the first misses.
  { id: `w_assert`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1, { judgeBy: `assertion` })] },
  { id: `w_campaigns`, owners: [`a`], body: [kill], tests: [judging(`a`, `fixed seed`, 1, { then: { route: `random seed`, input: 7 } })] },
  // A soft assertion fails in the random campaign, and the test goes on to
  // register a fixed seed: the verdict keeps the random route.
  { id: `w_soft`, owners: [`a`], body: [kill], tests: [judging(`a`, `random seed`, 7, { judgeBy: `soft`, then: { route: `fixed seed`, input: 1 } })] },
  // A test that asserts on a value with a getter and checks that nothing
  // read it, as an oracle that counts reads does. The CLI's capture must
  // not read it either: the harness may not change what a test observes.
  { id: `w_getter`, owners: [`a`], body: [push], tests: [judging(`a`, `fixed seed`, 1, { getter: true })] },
  // Two tests that share state: the first, which calls another function,
  // sets it; the second calls this function only when it is set. A runner
  // that runs only the tests that reached a site must not change what the
  // second sees.
  {
    id: `w_shared`,
    owners: [`a`],
    body: [kill],
    tests: [
      { ...judging(`a`, `fixed seed`, 1, { judges: false, setsShared: true }), fn: `w_kill` },
      judging(`a`, `fixed seed`, 5, { judges: false, readsShared: true }),
    ],
  },
  // A test that fires a verdict and catches its failure passes, so it kills
  // nothing, and the tests after it must still run. It sits between a test
  // that reaches `w_late` and the one that judges it, so a runner that
  // leaves out the tests before the first reaching one still runs it.
  { id: `w_caught`, owners: [`a`], body: [push], tests: [] },
  {
    id: `w_late`,
    owners: [`a`],
    body: [push],
    tests: [
      judging(`a`, `fixed seed`, 1, { judges: false }),
      { ...judging(`a`, `fixed seed`, 1, { judges: false, caughtVerdict: true }), fn: `w_caught` },
      judging(`a`, `fixed seed`, 1),
    ],
  },
  // A test that never calls this function judges what an earlier test
  // stored from it, so it sees the mutant through shared state.
  {
    id: `w_prop`,
    owners: [`a`],
    body: [push],
    tests: [
      judging(`a`, `fixed seed`, 7, { judges: false, storesShared: true }),
      judging(`a`, `fixed seed`, 7, { judgesShared: true }),
    ],
  },
  { id: `wg0`, file: LIB, owners: [], body: [push], tests: [] },
  { id: `wg1`, file: LIB, owners: [], body: [push], tests: [] },
  { id: `wg2`, file: LIB, owners: [], body: [push], tests: [] },
]

// The witnesses whose outcomes depend on what real test runs record: law
// verdicts, assertions, soft assertions, routes, crashes, framework checks,
// nondeterminism, observations, ordinary tests, and several owners. The
// rest test the static half, which gap-report-static-oracle checks
// in-process.
const captureWitness = new Set([
  `w_kill`,
  `w_both`,
  `w_random`,
  `w_agree`,
  `w_agreeboth`,
  `w_crash`,
  `w_frame`,
  `w_unregistered`,
  `w_flaky`,
  `w_observe`,
  `w_expect`,
  `w_noobs`,
  `w_unreached`,
  `w_ordinary`,
  `w_foreign`,
  `w_union`,
  `w_unowned`,
  `w_assert`,
  `w_campaigns`,
  `w_soft`,
  `w_getter`,
  `w_shared`,
  `w_caught`,
  `w_late`,
  `w_prop`,
])

// ## Rendering and layout
//
// `resolve` renders the source, one statement per line (a mixed or probe
// block takes four, an `else` statement two), and records each statement's
// first line and text. Free functions come first in index order, then each
// class's methods. A preamble defines `devBuild()`, now an ordinary function
// that only the older probe form calls; the probe helpers `report` and
// `reportTwice`; and the mixed helper `reportAndPush`, which probes and also
// writes output. The witness
// function `w_probeonly` is a probe helper declared after its caller. The
// model reads the layout; the driver writes the text.
// The decided probe form: one statement, a `NODE_ENV` guard and the hook
// called with the state's name and its condition.
// The guard's `production` may be quoted with `'` or a backtick, as the lint
// rule accepts.
const probeText = (probe, condition, quote = `'`) =>
  `process.env.NODE_ENV !== ${quote}production${quote} && (globalThis as { __oracleProbe?: (name: string, condition: unknown) => void }).__oracleProbe?.(${probe}, ${condition});`
// The form before the decision, which is production code now.
const oldProbeCallText = (probe) =>
  `(globalThis as { __oracleProbe?: (probe: string) => void }).__oracleProbe?.(${probe});`
const oldProbeText = (probe) =>
  `if (devBuild() && process.env.NODE_ENV !== 'production') ${oldProbeCallText(probe)}`
const preamble = [
  `function devBuild(): boolean {`,
  `  try {`,
  `    return process.env.NODE_ENV !== 'production'`,
  `  } catch {`,
  `    return false`,
  `  }`,
  `}`,
  `function report(probe: string): void {`,
  `  ${probeText(`probe`, `true`)}`,
  `}`,
  `function reportTwice(probe: string): void {`,
  `  report(probe);`,
  `  report(probe);`,
  `}`,
  `export function reportAndPush(probe: string, out: Array<string>): void {`,
  `  ${probeText(`probe`, `true`)}`,
  `  out.push('h');`,
  `}`,
  `export function apply(fn: (x: number, out: Array<string>) => void, x: number, out: Array<string>): void {`,
  `  fn(x, out);`,
  `}`,
  `export function make(cls: new () => { run(x: number, out: Array<string>): void }, x: number, out: Array<string>): void {`,
  `  new cls().run(x, out);`,
  `}`,
]
const preambleStatements = {
  devBuild: `return process.env.NODE_ENV !== 'production'`,
  reportTwice: `report(probe);`,
  reportAndPushPush: `out.push('h');`,
  applyCall: `fn(x, out);`,
  makeCall: `new cls().run(x, out);`,
}

const pushText = (stmt) =>
  stmt.quote === `'`
    ? `out.push('s${stmt.label}');`
    : `out.push(\`s${stmt.label}\`);`
// Statements that reach another function, each rendered by `callText`.
const referenceKinds = new Set([
  `call`,
  `libCall`,
  `valueCall`,
  `newCall`,
  `fieldCall`,
  `bindCall`,
  `factoryCall`,
])
const condText = (stmt) =>
  stmt.not ? `!(x ${stmt.op} ${stmt.k})` : `x ${stmt.op} ${stmt.k}`

/** The source lines of one statement. */
function renderStatement(stmt, callText) {
  const probe = `'p${stmt.label}'`
  switch (stmt.kind) {
    case `push`:
      return [pushText(stmt)]
    case `if`:
      return [`if (${condText(stmt)}) ${pushText(stmt)}`]
    case `throwIf`:
      return [
        `if (x > 100) throw new Error('${stmt.message === `assertion` ? `expected x to be at most 100` : `boom`}');`,
      ]
    case `guard`:
      return [probeText(probe, `x ${stmt.op} ${stmt.k}`, stmt.quote)]
    case `oldProbe`:
      return [oldProbeText(probe)]
    case `mixed`:
      return [
        `if (${condText(stmt)}) {`,
        `  ${probeText(probe, `true`)}`,
        `  ${pushText(stmt)}`,
        `}`,
      ]
    case `helperCall`:
      return [`${stmt.helper}(${probe});`]
    case `mixedHelperCall`:
      return [`reportAndPush(${probe}, out);`]
    case `probeIf`:
      return [`if (${condText(stmt)}) report(${probe});`]
    case `probeBlock`:
      return [
        `if (${condText(stmt)}) {`,
        `  report(${probe});`,
        `  ${probeText(probe, `true`)}`,
        `}`,
      ]
    case `elseIf`:
      return [`if (${condText(stmt)}) report(${probe});`, `else ${pushText(stmt)}`]
    case `primeCall`:
      return [`this.prime();`]
    case `setTag`:
      return [`this.tag = 'b';`]
    case `pushTag`:
      return [`out.push(this.tag);`]
    case `call`:
    case `libCall`:
    case `valueCall`:
    case `newCall`:
    case `fieldCall`:
    case `bindCall`:
    case `factoryCall`:
      return [callText]
  }
  throw new Error(`unknown statement kind ${stmt.kind}`)
}

function resolveHistory(history) {
  let label = 0
  const containerOf = (index) => history.containers[index] ?? `free`
  // Generated functions: methods take names in order within their class.
  const used = { C0: 0, C1: 0 }
  const generated = history.functions.map((body, index) => {
    const container = containerOf(index)
    const id =
      container === `free`
        ? `f${index}`
        : `${container}.${METHOD_NAMES[used[container]++]}`
    return {
      id,
      container,
      overload: container === `free` && history.overloads[index] === true,
      generated: true,
      owners: { a: [`a`], b: [`b`], both: [`a`, `b`], none: [] }[
        history.owners[index] ?? `none`
      ],
      body,
    }
  })
  // A call goes to a later function, by name to a free function, or through
  // `this` to a method of the same class; any other target is a push.
  const classOf = (id) => (id.includes(`.`) ? id.split(`.`)[0] : `free`)
  for (const [index, fn] of generated.entries())
    fn.body = fn.body.map((stmt) => {
      const later = generated.slice(index + 1)
      const pick = (candidates) =>
        candidates.length > 0
          ? candidates[stmt.target % candidates.length].id
          : undefined
      const reference = {
        valueCall: () => pick(later.filter((t) => t.container === `free`)),
        newCall: () => pick(later.filter((t) => t.container !== `free`)),
        fieldCall: () =>
          fn.container === `free`
            ? undefined
            : pick(
                later.filter(
                  (t) => t.container !== `free` && t.container !== fn.container,
                ),
              ),
        bindCall: () =>
          fn.container === `free`
            ? undefined
            : pick(later.filter((t) => t.container === fn.container)),
        factoryCall: () =>
          pick(later.filter((t) => t.container !== `free` && t.id.endsWith(`.run`))),
      }[stmt.kind]
      if (reference) {
        const to = reference()
        return to ? { kind: stmt.kind, to } : { kind: `push`, quote: `'` }
      }
      if (stmt.kind !== `call`) return stmt
      const target = later[stmt.target % Math.max(1, later.length)]
      if (
        target &&
        (target.container === `free` || target.container === fn.container)
      )
        return { kind: `call`, to: target.id }
      return { kind: `push`, quote: `'` }
    })
  const library = history.library.map((body, index) => ({
    id: `g${index}`,
    file: LIB,
    container: `free`,
    generated: true,
    library: true,
    owners: { a: [`a`], b: [`b`], none: [] }[
      history.libraryOwners[index] ?? `none`
    ],
    body,
  }))
  // A library call names a library function; with none, it is a push.
  for (const fn of generated)
    fn.body = fn.body.map((stmt) =>
      stmt.kind !== `libCall`
        ? stmt
        : library.length > 0
          ? {
              kind: `libCall`,
              to: library[stmt.target % library.length].id,
              alias: stmt.alias,
            }
          : { kind: `push`, quote: `'` },
    )
  const functions = [
    ...generated,
    ...library,
    ...(history.witness
      ? witness
          .filter((w) => history.witness === true || captureWitness.has(w.id))
          .map((w) => ({
          ...w,
            container: w.id.includes(`.`) ? w.id.split(`.`)[0] : `free`,
            generated: false,
          }))
      : []),
  ].map((fn) => ({
    file: SOURCE,
    ...fn,
    body: fn.body.map((stmt) => ({ ...stmt, label: ++label })),
  }))
  const byId = new Map(functions.map((fn) => [fn.id, fn]))
  const callText = (stmt) =>
    stmt.kind === `valueCall`
      ? `apply(${stmt.to}, x, out);`
      : stmt.kind === `factoryCall`
        ? `make(${classOf(stmt.to)}, x, out);`
      : stmt.kind === `newCall`
        ? `new ${classOf(stmt.to)}().${stmt.to.split(`.`)[1]}(x, out);`
        : stmt.kind === `fieldCall`
          ? `this.peer${classOf(stmt.to)}.${stmt.to.split(`.`)[1]}(x, out);`
          : stmt.kind === `bindCall`
            ? `this.${stmt.to.split(`.`)[1]}.bind(this)(x, out);`
            : stmt.kind === `libCall`
      ? `${stmt.alias ? `h_${stmt.to}` : stmt.to}(x, out);`
      : byId.get(stmt.to).container === `free`
        ? `${stmt.to}(x, out);`
        : `this.${stmt.to.split(`.`)[1]}(x, out);`

  // The main file starts with its import from the library, then the
  // preamble, then free functions, then each class. The library holds its
  // functions alone.
  const imported = [
    ...new Set(
      functions.flatMap((fn) =>
        fn.body
          .filter((stmt) => stmt.kind === `libCall`)
          .map((stmt) => (stmt.alias ? `${stmt.to} as h_${stmt.to}` : stmt.to)),
      ),
    ),
  ]
  const libLines = []
  const lines = [`import { ${imported.join(`, `)} } from './lib'`, ...preamble]
  const emit = (fn, indent) => {
    const name = fn.container === `free` ? fn.id : fn.id.split(`.`)[1]
    if (fn.overload)
      lines.push(
        `${indent}export function ${name}(x: number, out: Array<string>): void`,
      )
    lines.push(
      fn.container === `free`
        ? `${indent}export function ${name}(x: number, out: Array<string>): void {`
        : `${indent}${fn.signature ?? `${name}(x: number, out: Array<string>): void`} {`,
    )
    for (const stmt of fn.body) {
      stmt.line = lines.length + 1
      stmt.lines = renderStatement(
        stmt,
        referenceKinds.has(stmt.kind) ? callText(stmt) : undefined,
      )
      for (const line of stmt.lines) lines.push(`${indent}  ${line}`)
    }
    lines.push(`${indent}}`)
  }
  for (const fn of functions)
    if (fn.container === `free` && fn.file === SOURCE) emit(fn, ``)
  for (const cls of [...new Set(functions.map((f) => f.container))].filter(
    (c) => c !== `free`,
  )) {
    lines.push(`export class ${cls} {`)
    // A field holds each class that a method here calls through a field.
    for (const peer of new Set(
      functions
        .filter((fn) => fn.container === cls)
        .flatMap((fn) => fn.body)
        .filter((stmt) => stmt.kind === `fieldCall`)
        .map((stmt) => classOf(stmt.to)),
    ))
      lines.push(`  peer${peer} = new ${peer}()`)
    for (const fn of functions)
      if (fn.container === cls && fn.field) lines.push(`  ${fn.field}`)
    for (const fn of functions) if (fn.container === cls) emit(fn, `  `)
    lines.push(`}`)
  }
  const source = `${lines.join(`\n`)}\n`
  // The library is laid out the same way, in its own file.
  {
    const mainLines = lines.splice(0)
    for (const fn of functions) if (fn.file === LIB) emit(fn, ``)
    libLines.push(...lines.splice(0))
    lines.push(...mainLines)
  }
  const librarySource = `${libLines.join(`\n`)}\nexport {}\n`

  const generatedIds = generated.map((fn) => fn.id)
  const tests = [
    ...history.tests.map((t) => ({
      ...t,
      fn: generatedIds[t.fn % generatedIds.length],
    })),
    ...functions.flatMap((fn) =>
      fn.generated ? [] : fn.tests.map((t) => ({ ...t, fn: t.fn ?? fn.id })),
    ),
  ]
  const pushes = functions.filter((fn) => fn.file === SOURCE).flatMap((fn) =>
    fn.body
      .filter((stmt) => [`push`, `if`, `mixed`, `elseIf`].includes(stmt.kind))
      .map((stmt) => ({ fn: fn.id, stmt })),
  )
  const authoredFrom = (spec, id) => {
    const target = pushes[spec.stmt % pushes.length]
    const find =
      spec.kind === `stale`
        ? `out.push('nope');`
        : spec.kind === `ambiguous`
          ? `out.push(`
          : pushText(target.stmt)
    return {
      id,
      fn: target.fn,
      label: target.stmt.label,
      find,
      replace:
        spec.kind === `apply`
          ? pushText(target.stmt).replace(
              `s${target.stmt.label}`,
              `s${target.stmt.label}!`,
            )
          : `out.push('x');`,
      applies: source.split(find).length - 1 === 1,
      line: source.slice(0, source.indexOf(find)).split(`\n`).length,
      kind: spec.kind,
    }
  }
  const authored =
    history.authored && pushes.length > 0
      ? authoredFrom(history.authored, `a1`)
      : undefined
  const authoredList = authored
    ? [
        authored,
        ...(history.secondAuthored
          ? [authoredFrom({ stmt: history.authored.stmt + 1, kind: `apply` }, `a2`)]
          : []),
      ]
    : []
  return {
    functions,
    tests,
    authored,
    authoredList,
    wholeFile: history.wholeFile,
    template: history.template,
    fault: history.fault,
    stability: history.stability,
    steps: history.steps ?? [],
    ordinary: history.ordinary === true,
    history,
    source,
    librarySource,
  }
}

// ## Model
//
// The model is an interpreter of the grammar, not of TypeScript. Each
// statement owns the sites that law 1 promises for its form, in document
// order, at the line `resolve` laid out, with the statement text that law 6
// anchors them to. Law 2 marks probe-only sites, deriving probe helpers
// among the generated free functions by the fixpoint the law states.
// Ownership (law 3) comes from the declared entries and the call
// statements, so it is a property of the source, not of what any test ran.
// A mutant is one active site: the interpreter forces or swaps its
// condition, drops its negation, or skips its call. Running each owner test
// with and without it gives the test's output, whether it threw, which sites
// it reached, and which outcomes each `if` took. Law 4's ladder turns those
// facts into the mutant's outcome. Nothing here reads the instrumenter or the
// CLI.
const swapped = {
  '<': `<=`,
  '<=': `<`,
  '>': `>=`,
  '>=': `>`,
  '===': `!==`,
  '!==': `===`,
}
const holds = (a, op, b) =>
  op === `<`
    ? a < b
    : op === `<=`
      ? a <= b
      : op === `>`
        ? a > b
        : op === `>=`
          ? a >= b
          : op === `===`
            ? a === b
            : a !== b
// A test's campaigns: its own route and input, then an optional second one.
const partsOf = (t) => [
  { route: t.route, input: t.input },
  ...(t.then ? [t.then] : []),
]
// A campaign's route kind; a test that registered nothing has none.
const routeOf = (t, part = t) =>
  !t.registered
    ? `unknown`
    : [`fixed seed`, `fixed history`, `case`].includes(part.route)
      ? `reproducible`
      : part.route === `random seed`
        ? `random`
        : `framework`

/** Law 6's normalization: the statement's tokens, joined by single spaces. */
function tokens(text) {
  const pattern =
    /'[^']*'|`[^`]*`|[A-Za-z_$][\w$]*|\d+|\?\.|=>|!==|===|&&|\|\||<=|>=|[^\s\w]/g
  return text.match(pattern).join(` `)
}

/** The functions whose every statement is probe-only (law 2), by fixpoint. */
function probeHelpers(plan) {
  // The preamble's helpers satisfy the same rule; they are not in the plan.
  const helpers = new Set([`report`, `reportTwice`])
  const probeOnly = (stmt) =>
    [`guard`, `helperCall`, `probeIf`, `probeBlock`].includes(stmt.kind) ||
    (stmt.kind === `call` && helpers.has(stmt.to))
  for (let grew = true; grew; ) {
    grew = false
    for (const fn of plan.functions)
      if (
        fn.container === `free` &&
        !helpers.has(fn.id) &&
        fn.body.every(probeOnly)
      ) {
        helpers.add(fn.id)
        grew = true
      }
  }
  return { helpers, probeOnly }
}

function sitesOf(plan) {
  const { helpers, probeOnly } = probeHelpers(plan)
  const sites = []
  const fileOf = new Map(plan.functions.map((fn) => [fn.id, fn.file]))
  const add = (fn, line, operator, text, extra = {}) =>
    sites.push({
      id: sites.length,
      file: fileOf.get(fn) ?? SOURCE,
      function: fn,
      line,
      operator,
      text: tokens(text),
      probe: false,
      ...extra,
    })
  // A decided probe statement: `&&`, then the guard's `!==`, then a
  // comparison in its condition. It has no call statement to delete.
  const guard = (fn, line, probe, condition, quote) => {
    const text = probeText(probe, condition, quote)
    add(fn, line, `binary-swap`, text, { probe: true })
    add(fn, line, `binary-swap`, text, { probe: true })
    if (condition !== `true`) add(fn, line, `binary-swap`, text, { probe: true })
  }
  // `devBuild()` is an ordinary function now; only the older probe form calls it.
  add(`devBuild`, 4, `binary-swap`, preambleStatements.devBuild, {
    role: `devBuild`,
  })
  guard(`report`, 10, `probe`, `true`)
  add(`reportTwice`, 13, `delete-call`, preambleStatements.reportTwice, {
    probe: true,
  })
  add(`reportTwice`, 14, `delete-call`, preambleStatements.reportTwice, {
    probe: true,
  })
  guard(`reportAndPush`, 17, `probe`, `true`)
  add(`reportAndPush`, 18, `delete-call`, preambleStatements.reportAndPushPush, {
    role: `helperPush`,
  })
  add(`apply`, 21, `delete-call`, preambleStatements.applyCall, {
    role: `applyCall`,
  })
  add(`make`, 24, `delete-call`, preambleStatements.makeCall, {
    role: `makeCall`,
  })
  for (const fn of plan.functions) {
    const inHelper = helpers.has(fn.id)
    for (const stmt of fn.body) {
      const whole = stmt.lines.join(` `)
      const probe = inHelper || probeOnly(stmt)
      const at = (operator, role, line, text) =>
        add(fn.id, line, operator, text, { stmt: stmt.label, role, probe })
      const condition = () => {
        at(`if-true`, `true`, stmt.line, whole)
        at(`if-false`, `false`, stmt.line, whole)
        if (stmt.not) at(`drop-not`, `not`, stmt.line, whole)
        at(`binary-swap`, `swap`, stmt.line, whole)
      }
      if (stmt.kind === `push` || stmt.kind === `pushTag`)
        at(`delete-call`, `push`, stmt.line, whole)
      if (stmt.kind === `primeCall`) at(`delete-call`, `call`, stmt.line, whole)
      if (stmt.kind === `if`) {
        condition()
        at(`delete-call`, `push`, stmt.line, pushText(stmt))
      }
      if (stmt.kind === `throwIf`) condition()
      if (stmt.kind === `guard`)
        guard(
          fn.id,
          stmt.line,
          `'p${stmt.label}'`,
          `x ${stmt.op} ${stmt.k}`,
          stmt.quote,
        )
      if (stmt.kind === `oldProbe`) {
        at(`if-true`, `oldTrue`, stmt.line, whole)
        at(`if-false`, `oldFalse`, stmt.line, whole)
        at(`binary-swap`, `oldAnd`, stmt.line, whole)
        at(`binary-swap`, `oldNe`, stmt.line, whole)
        at(`delete-call`, `oldCall`, stmt.line, oldProbeCallText(`'p${stmt.label}'`))
      }
      if (stmt.kind === `mixed`) {
        condition()
        guard(fn.id, stmt.line + 1, `'p${stmt.label}'`, `true`)
        at(`delete-call`, `push`, stmt.line + 2, pushText(stmt))
      }
      if (stmt.kind === `helperCall`)
        add(fn.id, stmt.line, `delete-call`, whole, { probe: true })
      if (stmt.kind === `mixedHelperCall` || referenceKinds.has(stmt.kind))
        at(`delete-call`, `call`, stmt.line, whole)
      if (stmt.kind === `probeIf`) {
        condition()
        add(fn.id, stmt.line, `delete-call`, `report('p${stmt.label}');`, {
          probe: true,
        })
      }
      if (stmt.kind === `probeBlock`) {
        condition()
        add(fn.id, stmt.line + 1, `delete-call`, `report('p${stmt.label}');`, {
          probe: true,
        })
        guard(fn.id, stmt.line + 2, `'p${stmt.label}'`, `true`)
      }
      if (stmt.kind === `elseIf`) {
        // An `if` with a production `else` is production; its probe branch
        // alone is probe-only.
        condition()
        add(fn.id, stmt.line, `delete-call`, `report('p${stmt.label}');`, {
          probe: true,
        })
        at(`delete-call`, `push`, stmt.line + 1, pushText(stmt))
      }
    }
  }
  // Order on a line, and the anchor's occurrence index within a function.
  const onLine = new Map()
  const anchors = new Map()
  for (const site of sites) {
    const lineKey = `${site.file} ${site.line} ${site.operator}`
    site.ordinal = onLine.get(lineKey) ?? 0
    onLine.set(lineKey, site.ordinal + 1)
    const base = `${site.file}#${site.function}:${site.operator}:${site.text}`
    const count = (anchors.get(base) ?? 0) + 1
    anchors.set(base, count)
    site.key = count === 1 ? base : `${base}~${count}`
  }
  return sites
}

/** Each function's owners: the files whose entries' call trees contain it. */
function ownersOf(plan) {
  // A reference is an edge: to the function or method it names; to `apply`
  // and the value passed to it; and, for a class passed as a value, to every
  // method of that class. `new C().m()` reaches only `m` (and C's
  // constructor, which the grammar does not write).
  const methodsOf = (cls) =>
    plan.functions.filter((fn) => fn.container === cls).map((fn) => fn.id)
  const calls = new Map(
    plan.functions.map((fn) => [
      fn.id,
      fn.body.flatMap((stmt) =>
        stmt.kind === `valueCall`
          ? [`apply`, stmt.to]
          : stmt.kind === `factoryCall`
            ? [`make`, ...methodsOf(stmt.to.split(`.`)[0])]
            : stmt.kind === `newCall`
              ? [stmt.to, `${stmt.to.split(`.`)[0]}.constructor`]
              : stmt.kind === `primeCall`
                ? [`W7.prime`]
            : referenceKinds.has(stmt.kind)
          ? [stmt.to]
          : stmt.kind === `mixedHelperCall`
            ? [`reportAndPush`]
            : stmt.kind === `oldProbe`
              ? [`devBuild`]
              : [],
      ),
    ]),
  )
  const owners = new Map()
  const visit = (id, file) => {
    const set = owners.get(id) ?? new Set()
    if (set.has(file)) return
    set.add(file)
    owners.set(id, set)
    for (const callee of calls.get(id) ?? []) visit(callee, file)
  }
  for (const fn of plan.functions)
    for (const file of fn.owners) visit(fn.id, file)
  // A whole-file entry names the main source, so it owns only its functions.
  const inLibrary = new Set(
    plan.functions.filter((fn) => fn.file === LIB).map((fn) => fn.id),
  )
  return (id) =>
    new Set([
      ...(owners.get(id) ?? []),
      ...(plan.wholeFile === `none` || inLibrary.has(id) ? [] : [plan.wholeFile]),
    ])
}

/** One call of a function with at most one active mutation. */
function interpret(plan, fnId, x, sites, active) {
  const trace = []
  const reached = new Set()
  const outcomes = []
  const siteOf = (stmt, role) =>
    sites.find((s) => s.stmt === stmt.label && s.role === role)
  const helperPush = sites.find((s) => s.role === `helperPush`)
  const isActive = (site) =>
    site !== undefined && active?.site !== undefined && active.site === site.id
  const condition = (stmt) => {
    for (const role of [`true`, `false`, `not`, `swap`])
      if (siteOf(stmt, role)) reached.add(siteOf(stmt, role).id)
    const op = stmt.kind === `throwIf` ? `>` : stmt.op
    const k = stmt.kind === `throwIf` ? 100 : stmt.k
    let value = holds(x, isActive(siteOf(stmt, `swap`)) ? swapped[op] : op, k)
    if (stmt.not && !isActive(siteOf(stmt, `not`))) value = !value
    outcomes.push([stmt.line, value])
    if (isActive(siteOf(stmt, `true`))) return true
    if (isActive(siteOf(stmt, `false`))) return false
    return value
  }
  const write = (stmt) => {
    const site = siteOf(stmt, `push`)
    reached.add(site.id)
    if (isActive(site)) return
    trace.push(
      active?.authored === stmt.label ? `s${stmt.label}!` : `s${stmt.label}`,
    )
  }
  const run = (id, object = { tag: `a` }) => {
    const fn = plan.functions.find((f) => f.id === id)
    for (const stmt of fn.body) {
      if (stmt.kind === `push`) write(stmt)
      if (stmt.kind === `pushTag`) {
        const site = siteOf(stmt, `push`)
        reached.add(site.id)
        if (!isActive(site)) trace.push(object.tag)
      }
      if (stmt.kind === `setTag`) object.tag = `b`
      if (stmt.kind === `primeCall`) {
        const site = siteOf(stmt, `call`)
        reached.add(site.id)
        if (!isActive(site)) run(`W7.prime`, object)
      }
      if ((stmt.kind === `if` || stmt.kind === `mixed`) && condition(stmt))
        write(stmt)
      if (stmt.kind === `elseIf` && !condition(stmt)) write(stmt)
      if (stmt.kind === `probeIf` || stmt.kind === `probeBlock`)
        condition(stmt)
      if (stmt.kind === `throwIf` && condition(stmt)) throw new Error(`boom`)
      if (stmt.kind === `oldProbe`) {
        // `devBuild()` is true under test, so the guard holds and the probe
        // is called; none of it writes output.
        for (const role of [`oldTrue`, `oldFalse`, `oldAnd`, `oldNe`, `oldCall`])
          reached.add(siteOf(stmt, role).id)
        reached.add(sites.find((s) => s.role === `devBuild`).id)
        outcomes.push([stmt.line, true])
      }
      if (referenceKinds.has(stmt.kind) || stmt.kind === `mixedHelperCall`) {
        const site = siteOf(stmt, `call`)
        reached.add(site.id)
        if (isActive(site)) continue
        if (stmt.kind === `valueCall` || stmt.kind === `factoryCall`) {
          // `apply` calls the function it was given; `make` constructs the
          // class and calls its `run`.
          const inner = sites.find(
            (s) => s.role === (stmt.kind === `valueCall` ? `applyCall` : `makeCall`),
          )
          reached.add(inner.id)
          if (isActive(inner)) continue
        }
        if (stmt.kind === `newCall`) {
          // `new` runs the class's constructor, then the method, on one object.
          const object = { tag: `a` }
          const ctor = `${stmt.to.split(`.`)[0]}.constructor`
          if (plan.functions.some((f) => f.id === ctor)) run(ctor, object)
          run(stmt.to, object)
        } else if (stmt.kind !== `mixedHelperCall`) run(stmt.to)
        else {
          reached.add(helperPush.id)
          if (!isActive(helperPush)) trace.push(`h`)
        }
      }
    }
  }
  let threw = false
  try {
    run(fnId)
  } catch {
    threw = true
  }
  return { trace, threw, reached, outcomes }
}

function judge(plan, tests, sites, active) {
  // A test runs its campaigns in order. Each failing judgment is a verdict
  // that carries its campaign's route; an assertion is a verdict under an
  // unnamed law. A verdict or a crash stops the test, except a soft
  // assertion, which lets it go on. A failed test's own route is the route
  // active when it ended.
  const runs = tests
    .filter((t) => !t.flaky)
    .map((t) => {
      let changedAny = false
      const found = []
      for (const part of partsOf(t)) {
        const base = interpret(plan, t.fn, part.input, sites)
        const mutated = interpret(plan, t.fn, part.input, sites, active)
        const changed =
          !mutated.threw && mutated.trace.join() !== base.trace.join()
        changedAny ||= changed
        const route = routeOf(t, part)
        if (mutated.threw)
          return { t, route, crash: true, verdicts: found, changed: changedAny }
        if (changed && t.judges) {
          found.push({
            route,
            law: t.judgeBy === `verdict` ? t.law : `(unnamed)`,
          })
          if (t.judgeBy !== `soft`)
            return { t, route, verdicts: found, changed: true }
        }
      }
      return {
        t,
        route: routeOf(t, partsOf(t).at(-1)),
        verdicts: found,
        changed: changedAny,
      }
    })
  const verdicts = (route) =>
    runs.flatMap((r) =>
      r.verdicts.filter((v) => v.route === route).map((v) => v.law),
    )
  const reproducible = verdicts(`reproducible`)
  if (reproducible.length > 0)
    return reproducible.every((law) => law === `reach agreement`)
      ? `agreement-only-kill`
      : `killed`
  if (verdicts(`random`).length > 0) return `random-only-kill`
  if (verdicts(`unknown`).length > 0) return `unregistered-kill`
  const failing = runs.filter((r) => r.crash || r.verdicts.length > 0)
  if (failing.some((r) => r.route !== `framework`)) return `crashed`
  if (failing.length > 0) return `framework-error`
  return runs.some((r) => r.changed) ? `comparison-gap` : `survived`
}

/** Which declaration fault, if any, must make the run fail, and its cause. */
function refusal(plan) {
  if (plan.fault === `badEntry`) return { cause: `${SOURCE}#nope` }
  if (plan.fault === `missingSource`) return { cause: `src/missing.ts` }
  if (plan.fault === `nonLiteral`) return { cause: `b.test.ts` }
  // A failing owner is named with its test's error, so the author can fix it.
  if (plan.fault === `brokenOwner`)
    return { cause: `b.test.ts`, detail: `this owner fails with no mutant active` }
  return undefined
}

function model(plan) {
  const refused = refusal(plan)
  if (refused) return { refused }
  const sites = sitesOf(plan)
  const owners = ownersOf(plan)
  const ownerTests = (id) =>
    plan.tests.filter(
      (t) => ORACLE_FILES.includes(t.file) && owners(id).has(t.file),
    )
  const kindOf = (site) => {
    if (owners(site.function).size === 0) return `unowned`
    const tests = ownerTests(site.function)
    const reached = new Set()
    const taken = new Map()
    for (const t of tests)
      for (const part of partsOf(t)) {
        const run = interpret(plan, t.fn, part.input, sites)
        for (const id of run.reached) reached.add(id)
        for (const [line, value] of run.outcomes)
          taken.set(line, new Set([...(taken.get(line) ?? []), value]))
      }
    if (!reached.has(site.id)) return `unreached`
    const reaching = tests.filter((t) =>
      partsOf(t).some((part) =>
        interpret(plan, t.fn, part.input, sites).reached.has(site.id),
      ),
    )
    if (reaching.every((t) => t.flaky)) return `indeterminate`
    const kind = judge(plan, tests, sites, { site: site.id })
    if (kind !== `survived`) return kind
    return (taken.get(site.line)?.size ?? 2) < 2
      ? `generator-gap`
      : `no-observed-difference`
  }
  // The ordinary tests' outcome is reported, for information, only when the
  // run asks for it, and only for a survivor or an unreached mutant that an
  // ordinary test reached.
  const ordinaryReaches = (site) =>
    plan.tests
      .filter((t) => t.file === `c`)
      .some((t) => interpret(plan, t.fn, t.input, sites).reached.has(site.id))
  const survivorKinds = new Set([
    `comparison-gap`,
    `generator-gap`,
    `no-observed-difference`,
    `indeterminate`,
    `unreached`,
  ])
  const mutants = sites.map((site) => {
    const kind = site.probe ? undefined : kindOf(site)
    return {
      key: site.key,
      source: site.file,
      function: site.function,
      line: site.line,
      operator: site.operator,
      ordinal: site.ordinal,
      probe: site.probe,
      kind,
      ordinaryOutcome:
        plan.ordinary && survivorKinds.has(kind) && ordinaryReaches(site),
    }
  })
  // Each authored mutant is judged alone, against the original source with
  // only its own edit.
  const authoredAll = plan.authoredList.map((a) => ({
    id: a.id,
    key: `${SOURCE}#authored:${a.id}`,
    kind: !a.applies
      ? `does-not-apply`
      : owners(a.fn).size === 0
        ? `unowned`
        : judge(plan, ownerTests(a.fn), sites, { authored: a.label }),
    line: a.applies ? a.line : undefined,
  }))
  const authored = authoredAll[0]?.kind
  const isGap = (kind) =>
    kind !== undefined && ![`killed`, `unowned`].includes(kind)
  const count = (kind) => mutants.filter((m) => m.kind === kind).length
  // Each gap as the summary lists it: its key, its kind, and its line.
  const entries = [
    ...mutants
      .filter((m) => isGap(m.kind))
      .map((m) => ({ key: m.key, kind: m.kind, line: String(m.line) })),
    ...authoredAll
      .filter((a) => isGap(a.kind))
      .map((a) => ({ key: a.key, kind: a.kind, line: String(a.line) })),
  ].sort((a, b) => (a.key < b.key ? -1 : 1))
  const gaps = entries.map((e) => e.key)
  return {
    mutants,
    authored,
    authoredAll,
    authoredLine: authoredAll[0]?.line,
    gaps,
    entries,
    unowned: [
      ...mutants.filter((m) => m.kind === `unowned`).map((m) => m.key),
      ...authoredAll.filter((a) => a.kind === `unowned`).map((a) => a.key),
    ].sort(),
    counts: {
      mutants: mutants.length + authoredAll.length,
      authored: authoredAll.length,
      killed:
        count(`killed`) + authoredAll.filter((a) => a.kind === `killed`).length,
      gaps: gaps.length,
      probe: mutants.filter((m) => m.probe).length,
    },
  }
}

const testName = (t, index) =>
  t.name === `plain`
    ? `check ${index}`
    : t.route === `fixed seed`
      ? `fixed seed ${index + 1}`
      : t.route === `fixed history`
        ? `fixed history: h${index}`
        : t.route === `case`
          ? `case ${index}`
          : t.route === `calibration`
            ? `calibration: c${index}`
            : t.route === `probe calibration`
              ? `probe p${index} always fires`
              : t.route
const callFor = (fn) =>
  fn.includes(`.`)
    ? `new sut.${fn.split(`.`)[0]}().${fn.split(`.`)[1]}`
    : `sut.${fn}`
const quoteEntry = (plan, entry) =>
  plan.template ? `\`${entry}\`` : `'${entry}'`

function oracleTestFile(plan, file) {
  const sites = sitesOf(plan)
  const entries = [
    ...(plan.wholeFile === file ? [SOURCE] : []),
    ...plan.functions
      .filter((fn) => fn.owners.includes(file))
      .map((fn) => `${fn.file}#${fn.id}`),
    ...(file === `b` && plan.fault === `badEntry` ? [`${SOURCE}#nope`] : []),
    ...(file === `b` && plan.fault === `missingSource`
      ? [`src/missing.ts#f0`]
      : []),
  ].map((entry) => quoteEntry(plan, entry))
  const owns =
    file === `b` && plan.fault === `nonLiteral`
      ? [`const OWNS = [${entries.join(`, `)}]`, `declareOracle({ owns: OWNS })`]
      : [`declareOracle({ owns: [${entries.join(`, `)}] })`]
  const out = [
    `import { describe, expect, test } from 'vitest'`,
    `import * as sut from '../src/sut'`,
    ...(file === `b` ? [`import { strict } from './strict'`] : []),
    `function declareOracle(_parts: { owns: Array<string> }): void {}`,
    // State that tests of this file share (the `w_shared` witness).
    `const shared = { value: 0 }`,
    `const stored: { value: Array<string> } = { value: [] }`,
    ...owns,
    `const g = globalThis as { __oracleRoute?: (route: string) => void; __oracleObserve?: (c: string, v: unknown) => void; __oracleVerdict?: (v: { property: string; law: string; checkpoint: string }) => void }`,
  ]
  // Whether the file's tests judge, which law 9's edits change: file b's
  // follow its helper module, and file a's hold only under seed 1. The
  // driver's cold runs before any edit use seed 1 and a strict helper, so
  // the gate is open there and the model need not read it.
  const gate =
    file === `a`
      ? `process.env.TANSTACK_DB_ORACLE_SEED === '1'`
      : file === `b`
        ? `strict`
        : `true`
  plan.tests.forEach((t, index) => {
    if (t.file !== file) return
    // Each campaign registers its route, calls the function, observes, and
    // judges the unmutated output, which the model computes.
    const campaign = (part, i) => {
      const expected = JSON.stringify(
        interpret(plan, t.fn, part.input, sites).trace,
      )
      const out = `out${i}`
      return [
        ...(t.registered ? [`    g.__oracleRoute?.('${part.route}')`] : []),
        `    const ${out}: Array<string> = []`,
        ...(t.setsShared ? [`    shared.value = 5`] : []),
        t.readsShared
          ? `    if (shared.value === 5) ${callFor(t.fn)}(${part.input}, ${out})`
          : t.judgesShared
            ? `    ${out}.push(...stored.value)`
            : `    ${callFor(t.fn)}(${part.input}, ${out})`,
        ...(t.storesShared ? [`    stored.value = [...${out}]`] : []),
        ...(t.caughtVerdict
          ? [
              `    try {`,
              `      g.__oracleVerdict?.({ property: 'fixture-${file}', law: 'L', checkpoint: 'caught' })`,
              `      throw new Error('caught')`,
              `    } catch {}`,
            ]
          : []),
        t.channel === `expect`
          ? `    expect(${out}).toBeDefined()`
          : `    g.__oracleObserve?.('trace', ${out})`,
        ...(t.flaky
          ? [`    g.__oracleObserve?.('clock', performance.now())`]
          : []),
        ...(t.getter
          ? [
              `    let reads${i} = 0`,
              `    expect({ get payload() { reads${i} += 1; return ${out} } }).toBeDefined()`,
              `    if (reads${i} !== 0) throw new Error('the payload was read')`,
            ]
          : []),
        ...(!t.judges
          ? []
          : t.judgeBy !== `verdict`
            ? [
                `    if (${gate}) expect${t.judgeBy === `soft` ? `.soft` : ``}(${out}).toEqual(${expected})`,
              ]
            : [
                `    if (${gate} && JSON.stringify(${out}) !== '${expected}') {`,
                `      g.__oracleVerdict?.({ property: 'fixture-${file}', law: '${t.law}', checkpoint: 'trace' })`,
                `      throw new Error('violation')`,
                `    }`,
              ]),
      ]
    }
    out.push(
      `describe('t${index}', () => {`,
      `  test('${testName(t, index)}', () => {`,
      ...partsOf(t).flatMap(campaign),
      `  })`,
      `})`,
    )
  })
  if (file === `b` && plan.fault === `brokenOwner`)
    out.push(
      `test('fixed seed 999', () => {`,
      `  g.__oracleRoute?.('fixed seed')`,
      `  throw new Error('this owner fails with no mutant active')`,
      `})`,
    )
  // A file with no tests still loads, so the CLI can read what it owns.
  if (!plan.tests.some((t) => t.file === file))
    out.push(`test.skip('no tests', () => {})`)
  return `${out.join(`\n`)}\n`
}

function ordinaryTestFile(plan) {
  const sites = sitesOf(plan)
  const out = [
    `import { expect, test } from 'vitest'`,
    `import * as sut from '../src/sut'`,
  ]
  plan.tests.forEach((t, index) => {
    if (t.file !== `c`) return
    const expected = JSON.stringify(interpret(plan, t.fn, t.input, sites).trace)
    out.push(
      `test('ordinary ${index}', () => {`,
      `  const out: Array<string> = []`,
      `  ${callFor(t.fn)}(${t.input}, out)`,
      `  expect(out).toEqual(${expected})`,
      `})`,
    )
  })
  if (!plan.tests.some((t) => t.file === `c`))
    out.push(`test.skip('no tests', () => {})`)
  return `${out.join(`\n`)}\n`
}

/** The source after the stability edit, which keeps every output the same. */
function edited(plan) {
  if (plan.stability === `prepend`) {
    const [imports, ...rest] = plan.source.split(`\n`)
    return [
      imports,
      `export function zz(x: number, out: Array<string>): void {`,
      `  if (x > 1) out.push('u');`,
      `}`,
      ...rest,
    ].join(`\n`)
  }
  if (plan.stability === `insertGuard`) {
    const lines = plan.source.split(`\n`)
    const at = plan.functions[0].body[0].line - 1
    const indent = lines[at].match(/^\s*/)[0]
    lines.splice(at, 0, `${indent}${probeText(`'zz'`, `true`)}`)
    return lines.join(`\n`)
  }
  // Whitespace only: drop spaces around comparisons, add them in calls.
  return plan.source
    .replaceAll(/ (<=|>=|===|!==|<|>) /g, `$1`)
    .replaceAll(`(x, out)`, `( x,out )`)
}

const AUTHORED = `mutants/authored-mutant.json`

// Law 9's fixture state: the history, and what the edits outside it set.
const initialState = (plan) => ({
  history: plan.history,
  prepend: false,
  strict: true,
  seed: 1,
  newOracle: false,
  cliEdited: false,
})

/** The fixture package's files in one state. */
function fixtureFiles(plan, state = initialState(plan)) {
  const files = {
    'package.json': `{ "name": "gap-fixture", "private": true, "type": "module" }\n`,
    'vite.config.ts': `import { defineConfig } from 'vitest/config'\nexport default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })\n`,
    [SOURCE]: state.prepend
      ? edited({ ...plan, stability: `prepend` })
      : plan.source,
    [LIB]: plan.librarySource,
    'tests/strict.ts': `export const strict = ${state.strict}\n`,
    'tests/c.test.ts': ordinaryTestFile(plan),
  }
  for (const file of ORACLE_FILES)
    files[`tests/${file}.test.ts`] = oracleTestFile(plan, file)
  // The new oracle file d owns the first generated function and judges it.
  if (state.newOracle) {
    const target = plan.functions.find((fn) => fn.generated && !fn.library)
    files[`tests/d.test.ts`] = oracleTestFile(
      {
        ...plan,
        functions: plan.functions.map((fn) =>
          fn === target ? { ...fn, owners: [...fn.owners, `d`] } : fn,
        ),
        tests: [
          ...plan.tests,
          { ...judging(`d`, `fixed seed`, 7), fn: target.id },
        ],
      },
      `d`,
    )
  }
  for (const a of plan.authoredList)
    files[a.id === `a1` ? AUTHORED : `mutants/authored-mutant-${a.id}.json`] =
      JSON.stringify({
        id: a.id,
        source: SOURCE,
        find: a.find,
        replace: a.replace,
        intent: `pushes a different label`,
        author: `gap-report oracle`,
      })
  return files
}

// The paths each fixture directory holds, so a state that lacks a file of
// the state before it removes that file.
const written = new Map()
function writeFixture(dir, files) {
  for (const sub of [`src`, `tests`, `mutants`])
    mkdirSync(join(dir, sub), { recursive: true })
  for (const path of written.get(dir) ?? [])
    if (!(path in files)) rmSync(join(dir, path), { force: true })
  for (const [path, text] of Object.entries(files))
    writeFileSync(join(dir, path), text)
  written.set(dir, Object.keys(files))
}

/**
 * One of law 9's edits applied to a fixture state. Edits inside the history
 * are rendered again by `resolve`, so the fixture stays consistent: a test's
 * expected output follows its function's new source.
 */
function applyEdit(state, edit) {
  const h = state.history
  if (edit === `test`) {
    const first = Math.max(
      0,
      h.tests.findIndex((t) => t.file === `a`),
    )
    return {
      ...state,
      history: {
        ...h,
        tests: h.tests.map((t, i) =>
          i === first ? { ...t, judges: !t.judges } : t,
        ),
      },
    }
  }
  if (edit === `source`) {
    const fi = h.functions.findIndex((body) =>
      body.some((stmt) => stmt.kind === `if`),
    )
    const functions =
      fi < 0
        ? [
            [{ kind: `push`, quote: `'` }, ...h.functions[0]].slice(0, 5),
            ...h.functions.slice(1),
          ]
        : h.functions.map((body, i) => {
            if (i !== fi) return body
            const at = body.findIndex((stmt) => stmt.kind === `if`)
            return body.map((stmt, j) =>
              j === at ? { ...stmt, k: (stmt.k + 1) % 10 } : stmt,
            )
          })
    return { ...state, history: { ...h, functions } }
  }
  if (edit === `prepend`) return { ...state, prepend: !state.prepend }
  if (edit === `owns`) {
    const next = { a: `none`, b: `a`, both: `b`, none: `a` }
    const owners = [...h.owners]
    owners[0] = next[owners[0] ?? `none`]
    return { ...state, history: { ...h, owners } }
  }
  if (edit === `authored`)
    return {
      ...state,
      history: {
        ...h,
        authored:
          h.authored?.kind === `apply`
            ? { ...h.authored, kind: `stale` }
            : { stmt: (h.authored?.stmt ?? -1) + 1, kind: `apply` },
      },
    }
  if (edit === `helper`) return { ...state, strict: !state.strict }
  if (edit === `seed`) return { ...state, seed: state.seed === 1 ? 2 : 1 }
  if (edit === `newOracle`) return { ...state, newOracle: !state.newOracle }
  if (edit === `cli`) return { ...state, cliEdited: !state.cliEdited }
  return state
}


/**
 * The summary's counts, gap keys, unowned keys, and each listed gap's kind
 * and line, read from its text as the author reads it.
 */
function readSummary(summary) {
  const header = summary.match(
    /^(\d+) mutants \((\d+) authored\)\. (\d+) killed by a law on a reproducible route, .*?\*\*(\d+) gaps\*\*/m,
  )
  const probe = summary.match(/ (\d+) mutants of state-probe code/)
  // A key is read as Markdown reads a code span: it opens with a run of
  // backticks and ends at the next run of exactly that length, and one
  // space of padding on each side is dropped. A fence that a backtick in
  // the key can close is therefore read as a shorter key.
  const codeSpanAt = (text) => {
    const fence = text.match(/^`+/)?.[0]
    if (!fence) return undefined
    const rest = text.slice(fence.length)
    const close = [...rest.matchAll(/`+/g)].find(
      (run) => run[0].length === fence.length,
    )
    if (!close) return undefined
    const content = rest.slice(0, close.index)
    return content.startsWith(` `) && content.endsWith(` `)
      ? content.slice(1, -1)
      : content
  }
  const keysAfter = (label) =>
    summary
      .split(`\n`)
      .flatMap((line) => {
        const at = line.match(new RegExp(`^ *- ${label}: `))
        const key = at && codeSpanAt(line.slice(at[0].length))
        return key === undefined || key === null ? [] : [key]
      })
  return {
    counts: header
      ? {
          mutants: Number(header[1]),
          authored: Number(header[2]),
          killed: Number(header[3]),
          gaps: Number(header[4]),
          probe: probe ? Number(probe[1]) : 0,
        }
      : undefined,
    gaps: keysAfter(`Key`).sort(),
    unowned: keysAfter(`Unowned`).sort(),
    // Each listed gap's kind and line, from the bullet above its key.
    entries: (() => {
      const lines = summary.split(`\n`)
      return lines
        .flatMap((line, index) => {
          const key = line.startsWith(`  - Key: `)
            ? codeSpanAt(line.slice(`  - Key: `.length))
            : undefined
          const head = lines[index - 1]?.match(/^- \*\*([\w-]+)\*\*, line (\S+?):/)
          return key === undefined ? [] : [{ key, kind: head?.[1], line: head?.[2] }]
        })
        .sort((a, b) => (a.key < b.key ? -1 : 1))
    })(),
  }
}

export {
  captureWitness,
  readSummary,
  SOURCE,
  LIB,
  ORACLE_FILES,
  METHOD_NAMES,
  comparison,
  quote,
  constant,
  statement,
  libStatement,
  routes,
  testCase,
  edits,
  histories,
  kill,
  push,
  judging,
  witness,
  probeText,
  oldProbeCallText,
  oldProbeText,
  preamble,
  preambleStatements,
  pushText,
  referenceKinds,
  condText,
  renderStatement,
  resolveHistory,
  swapped,
  holds,
  partsOf,
  routeOf,
  tokens,
  probeHelpers,
  sitesOf,
  ownersOf,
  interpret,
  judge,
  refusal,
  model,
  testName,
  callFor,
  quoteEntry,
  oracleTestFile,
  ordinaryTestFile,
  edited,
  AUTHORED,
  initialState,
  fixtureFiles,
  written,
  writeFixture,
  applyEdit,
}
