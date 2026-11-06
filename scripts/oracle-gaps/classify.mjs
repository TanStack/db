// The gap report's classification: what each mutant's outcome is, from the
// plain records of the runs that judged it (check.mjs runs them). Every
// function here is pure, so the CLI's own oracle checks the classification
// on generated records in-process (gap-report-classify-oracle).
//
// A run record (a unit) holds one test file's tests under one mutant: each
// test's state and error text, its setup and unhandled errors, whether it
// timed out, and its capture rows (capture-setup.mjs): the sites each test
// reached, the outcomes each `if` took, the hashes of what it asserted on
// and observed, its registered route, and its law verdicts.

// Which kind of test produced a failure: the route the framework registered
// for it through `__oracleRoute` (capture-setup.mjs), never its name. A kill
// counts only on a reproducible route. The random campaign draws a new seed
// in every CI run, so a kill only it finds is a gap until it is kept as a
// fixed history. Calibrations, probe calibrations, and the determinism test
// check the oracle itself, not the law. A test that registered no route has
// an unknown one, and cannot kill.
const reproducibleRoutes = new Set([
  `fixed seed`,
  `fixed history`,
  `constructed history`,
  `case`,
  `enumerated`,
])
const frameworkRoutes = new Set([`calibration`, `probe calibration`, `determinism`])
function routeOf(registered) {
  if (registered === undefined) return `unknown`
  if (reproducibleRoutes.has(registered)) return `reproducible`
  if (registered === `random seed`) return `random`
  if (frameworkRoutes.has(registered)) return `framework`
  return `unknown`
}

/**
 * A mutant's outcome from its units. A test whose observations varied
 * between the two unmutated runs is nondeterministic: its failures judge
 * nothing, so a mutant that only such tests fail is not killed.
 */
export function outcomeOf(units, nondeterministic = new Set(), assertions = false) {
  // A run that timed out recorded nothing. A kill in another run still
  // decides; failing that, the mutant is `timeout`.
  const timeout = units.some((unit) => unit.timedOut)
    ? { outcome: `timeout`, detail: `run time limit` }
    : undefined
  const failures = []
  for (const unit of units) {
    if (unit.timedOut) continue
    const rows = new Map(unit.rows)
    for (const message of unit.setupErrors)
      failures.push({ setup: true, message })
    for (const test of unit.tests) {
      if (test.state !== `failed`) continue
      if (nondeterministic.has(test.key)) continue
      const row = rows.get(test.key)
      // Each verdict keeps the route active when it fired.
      const verdicts = (row?.verdicts ?? []).map((v) => ({
        ...v,
        route: routeOf(v.route ?? row?.route),
      }))
      failures.push({
        test: test.fullName,
        route: routeOf(row?.route),
        verdicts,
        assertion:
          // fast-check's wrapper text ("Property failed …") is not an
          // assertion; the wrapped error, which its message quotes, decides.
          /AssertionError|expected .+ to /.test(test.message),
        timeout: /Test timed out/.test(test.message),
        // fast-check quotes the error its predicate threw after its own
        // header; that error is the cause the report shows.
        message: (
          test.message.match(/Got error: (.*)/)?.[1] ?? test.message
        ).slice(0, 300),
      })
    }
    for (const message of unit.unhandled) failures.push({ message })
  }
  if (failures.length === 0) return timeout ?? { outcome: `survived` }
  const judged = (route) =>
    failures
      .filter(
        (f) =>
          f.verdicts?.some((v) => v.route === route) ||
          (assertions &&
            f.assertion &&
            f.route === route &&
            f.route !== `framework`),
      )
      .map((f) => ({ ...f, verdicts: f.verdicts.filter((v) => v.route === route) }))
  const lawsOf = (rows) => [
    ...new Set(rows.flatMap((f) => f.verdicts.map((v) => v.law))),
  ]
  const reproducible = judged(`reproducible`)
  const random = judged(`random`)
  const unregistered = judged(`unknown`)
  // A behavioral verdict on a reproducible route kills: any law but reach
  // agreement, or an ordinary test's assertion. Reach agreement alone shows
  // that production took another path, not that any behavioral law saw a
  // different result.
  const behavioral = (law) => law !== `reach agreement`
  const killing = reproducible.filter(
    (f) => f.verdicts.some((v) => behavioral(v.law)) || f.verdicts.length === 0,
  )
  if (killing.length > 0)
    return {
      outcome: `killed`,
      by: killing.map((f) => f.test),
      laws: lawsOf(killing).filter(behavioral),
      randomAlso: random.length > 0,
    }
  if (timeout) return timeout
  if (reproducible.length > 0)
    return {
      outcome: `agreement-only-kill`,
      by: reproducible.map((f) => f.test),
      laws: lawsOf(reproducible),
    }
  if (random.length > 0)
    return {
      outcome: `random-only-kill`,
      by: random.map((f) => f.test),
      laws: lawsOf(random),
    }
  if (unregistered.length > 0)
    return {
      outcome: `unregistered-kill`,
      by: unregistered.map((f) => f.test),
      laws: lawsOf(unregistered),
    }
  const tests = failures.filter((f) => f.test)
  if (tests.length > 0 && tests.every((f) => f.timeout))
    return { outcome: `timeout`, by: tests.map((f) => f.test) }
  const crashed = tests.filter((f) => f.route !== `framework` && !f.timeout)
  if (crashed.length > 0)
    return {
      outcome: `crashed`,
      by: crashed.map((f) => f.test),
      detail: crashed[0].message,
    }
  if (tests.length > 0)
    return {
      outcome: `framework-error`,
      by: tests.map((f) => f.test),
      detail: tests[0].message,
    }
  return { outcome: `setup-error`, detail: failures[0].message }
}


const fileOf = (key) => key.split(` > `)[0]

/**
 * What the two unmutated runs show: which tests are nondeterministic (their
 * values differed between the runs, so their failures judge nothing), which
 * tests reached each site, and which `if` outcomes each oracle file saw.
 */
export function baselineOf(firstRows, secondRows, oracleFiles) {
  const nondeterministic = new Set()
  for (const [key, row] of firstRows) {
    const again = secondRows.get(key)
    if (
      !row.background &&
      (again?.hash !== row.hash || again?.observed !== row.observed)
    )
      nondeterministic.add(key)
  }
  const reachedBy = new Map()
  const outcomeSeen = new Map()
  for (const [key, row] of firstRows) {
    for (const id of row.hits)
      reachedBy.set(id, [...(reachedBy.get(id) ?? []), key])
    if (row.background || !oracleFiles.has(fileOf(key))) continue
    for (const [id, [truthy, falsy]] of row.outcomes) {
      const byFile = outcomeSeen.get(id) ?? new Map()
      const seen = byFile.get(fileOf(key)) ?? [false, false]
      byFile.set(fileOf(key), [seen[0] || truthy, seen[1] || falsy])
      outcomeSeen.set(id, byFile)
    }
  }
  return { firstRows, nondeterministic, reachedBy, outcomeSeen }
}

/** The owner tests and the ordinary tests that reached a mutant's site. */
export function targetsOf(mutant, baseline, owners, oracleFiles) {
  const keys = baseline.reachedBy.get(mutant.number) ?? []
  const oracleKeys = keys.filter((k) => owners.has(fileOf(k)))
  const testKeys = keys.filter((k) => !oracleFiles.has(fileOf(k)))
  return {
    oracleKeys,
    testKeys,
    oracleTargets: [...new Set(oracleKeys.map(fileOf))],
    testTargets: [...new Set(testKeys.map(fileOf))],
  }
}

// An `if` on a mutant's line that its owners' tests reached but never saw
// take both outcomes.
function outcomeMissing(mutant, owners, mutants, baseline) {
  return mutants.some((m) => {
    if (
      m.operator !== `if-true` ||
      m.source !== mutant.source ||
      m.line !== mutant.line
    )
      return false
    let truthy = false
    let falsy = false
    for (const [file, seen] of baseline.outcomeSeen.get(m.number) ?? [])
      if (owners.has(file)) {
        truthy ||= seen[0]
        falsy ||= seen[1]
      }
    const reached = (baseline.reachedBy.get(m.number) ?? []).some((k) =>
      owners.has(fileOf(k)),
    )
    return reached && !(truthy && falsy)
  })
}

// A changed asserted value or a changed property observation, with no
// failure, is a difference that the check did not judge.
const changedIn = (rows, keys, baseline) =>
  keys.filter(
    (k) =>
      rows.get(k)?.hash !== baseline.firstRows.get(k)?.hash ||
      rows.get(k)?.observed !== baseline.firstRows.get(k)?.observed,
  )

/**
 * An operator mutant's outcome from the units of its owner files. A mutant
 * with no owner is `unowned`, and one that no owner test reached is
 * `unreached`. A survivor is a `comparison-gap`, an `indeterminate` mutant,
 * a `generator-gap`, or `no-observed-difference`.
 */
export function judgeMutant(mutant, { owners, targets, units, baseline, mutants }) {
  if (owners.size === 0) return { outcome: `unowned` }
  if (targets.oracleKeys.length === 0) return { outcome: `unreached` }
  const result = {
    ...outcomeOf(units, baseline.nondeterministic),
    seconds: units.reduce((sum, u) => sum + u.seconds, 0),
  }
  if (result.outcome !== `survived`) return result
  const rows = new Map(units.flatMap((u) => u.rows ?? []))
  // Only owner tests that reach the site can judge it. Code that ran when a
  // file loaded the module reaches every test of that file (maintainer
  // decision, 2026-11-06).
  const reaching = new Set(targets.oracleKeys)
  const loadedIn = new Set(
    targets.oracleKeys.filter((k) => k.endsWith(` > (background)`)).map(fileOf),
  )
  const compared = [...rows.keys()].filter(
    (k) =>
      (reaching.has(k) || loadedIn.has(fileOf(k))) &&
      !rows.get(k).background &&
      !baseline.nondeterministic.has(k),
  )
  result.changedTests = changedIn(rows, compared, baseline)
  result.class =
    result.changedTests.length > 0
      ? `comparison-gap`
      : compared.length === 0
        ? `indeterminate`
        : outcomeMissing(mutant, owners, mutants, baseline)
          ? `generator-gap`
          : `no-observed-difference`
  return result
}

/** Whether the ordinary tests run, for information: only for a survivor. */
export const needsOrdinary = (result, targets) =>
  (result.outcome === `survived` || result.outcome === `unreached`) &&
  targets.testKeys.length > 0

/**
 * The ordinary tests' outcome. They have no verdicts, so their assertions
 * are reported; an ordinary test never closes a gap.
 */
export const judgeOrdinary = (units) => outcomeOf(units, new Set(), true).outcome

/**
 * An authored mutant's outcome from its owners' units. Its copy is not
 * instrumented, so no `if` outcomes tell a generator gap from an equivalent
 * mutant: a survivor is a `comparison-gap` or stays `survived`.
 */
export function judgeAuthored(units, baseline) {
  const result = {
    ...outcomeOf(units, baseline.nondeterministic),
    seconds: units.reduce((sum, u) => sum + u.seconds, 0),
  }
  if (result.outcome !== `survived`) return result
  const rows = new Map(units.flatMap((u) => u.rows ?? []))
  result.changedTests = changedIn(
    rows,
    [...rows.keys()].filter(
      (k) => !rows.get(k).background && !baseline.nondeterministic.has(k),
    ),
    baseline,
  )
  if (result.changedTests.length > 0) result.class = `comparison-gap`
  return result
}
