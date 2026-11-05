// The check report: the gaps an oracle's author must answer.
//
// The report is evidence, not a fix. A surviving mutant or an unreached
// branch does not say which model rule to add; it says the oracle cannot see
// some difference in production. The author reads each gap, states the law it
// reveals (missing, misstated, or unenforced), names that law's authority,
// and re-plans the oracle around the law rather than around the line, then
// runs the check again. Recording that answer as an evidence-log event, and
// the gate that reads it, wait on the maintainer's decision about how an
// answer maps to a law; until then the report only lists the gaps.
//
// A gap is identified by an anchor that survives unrelated edits and
// reformatting: the source file, the function (`name`, or `Class.method`),
// the operator, and the tokens of the innermost statement that holds the
// site, joined by single spaces and kept in full, with `~n` for the nth
// repeat of one anchor in a function. An authored mutant's key is its id.

/** Outcomes that are gaps. Only a law verdict on a reproducible route kills. */
export const gapOutcomes = new Set([
  `survived`,
  `crashed`,
  `unreached`,
  `random-only-kill`,
  `agreement-only-kill`,
  `unregistered-kill`,
  `framework-error`,
  `timeout`,
  `setup-error`,
  `does-not-apply`,
])

export function assignKeys(results) {
  const seen = new Map()
  for (const result of results) {
    if (result.authored) {
      result.key = `${result.source}#authored:${result.authoredId}`
      continue
    }
    const base = `${result.source}#${result.function ?? `<module>`}:${result.operator}:${result.anchor}`
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    result.key = count === 1 ? base : `${base}~${count}`
  }
}

// What each gap shows, phrased as the question the author answers.
const questions = {
  'generator-gap': `An \`if\` here never took one of its outcomes in an owner's history. Which legal input makes it take the other one, and which law governs that input? If no public use can reach it, say why (an equivalent mutant, which needs a maintainer's approval).`,
  'comparison-gap': `Observed values changed, but no law rejected them. Which law forbids the changed value? Its observation, checkpoint, or comparison is missing or too loose.`,
  'no-observed-difference': `Every \`if\` outcome here occurred, yet nothing observed changed. Either the mutant is equivalent (say why; a maintainer approves it), or no explored history tells it apart: which history would, and which law would it test?`,
  indeterminate: `Only nondeterministic owner tests reach this site, so their failures judge nothing. Which source of nondeterminism hides it?`,
  survived: `The mutant changed production and no law rejected it. Which law does the intent violate? Which observation or history would show it?`,
  unreached: `No owner's test executes this code. Which law covers its behavior? Extend the oracle's domain to reach it; a limit needs a maintainer's decision.`,
  'random-only-kill': `Only the random campaign rejected this mutant, and its seed changes in every CI run. Which state did the counterexample reach? Keep it as a fixed or constructed history.`,
  'agreement-only-kill': `Only reach agreement rejected this mutant: production took a different path, but no behavioral law saw a different result. Is the behavior really the same, or is a behavioral law missing?`,
  'unregistered-kill': `Only a test with no registered route rejected this mutant, so its route is unknown. Register it through the framework, or make a reproducible test see the difference.`,
  crashed: `Production threw where no law judged it. A crash is not a kill: which law should reject this behavior, and at which checkpoint?`,
  'framework-error': `Only a framework check (a calibration, probe calibration, or the determinism test) failed, with no law violation. The oracle noticed the change but no law judged it.`,
  timeout: `The run did not end. Which law does a run that never ends violate, and what bounds the driver?`,
  'setup-error': `The run failed outside any test. The mutant may break module loading; say whether that is a detection.`,
  'does-not-apply': `The authored mutant's text does not occur exactly once in the source. Update or retire the mutant.`,
}

export function gapsOf(results) {
  return results.filter(
    (result) => !result.probeGuard && gapOutcomes.has(result.outcome),
  )
}

/** A key as a Markdown code span whose fence outruns any backticks in it. */
export function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  const fence = `\``.repeat(longest + 1)
  return `${fence} ${text} ${fence}`
}

function change(result) {
  if (result.authored) return `${result.intent} (authored by ${result.author})`
  return `${codeSpan(String(result.original).replace(/\s+/g, ` `))} → ${codeSpan(String(result.replacement))}`
}

export function renderReport({ results, run, excluded }) {
  const gaps = gapsOf(results)
  const guards = results.filter((r) => r.probeGuard)
  const unowned = results.filter((r) => !r.probeGuard && r.outcome === `unowned`)
  const killed = results.filter((r) => r.outcome === `killed` && !r.probeGuard)
  const crashed = results.filter(
    (r) => r.outcome === `crashed` && !r.probeGuard,
  )
  const lines = [
    `# Oracle check report`,
    ``,
    `Run ${run.id}. Inputs: ${run.inputs}.`,
    ``,
    `${results.length} mutants (${results.filter((r) => r.authored).length} authored). ` +
      `${killed.length} killed by a law on a reproducible route, ` +
      `${crashed.length} crashed production, ` +
      `**${gaps.length} gaps**.` +
      (unowned.length > 0
        ? ` ${unowned.length} mutants are in functions no oracle owns (warnings).`
        : ``) +
      (guards.length > 0
        ? ` ${guards.length} mutants of state-probe code (guards, helpers, and calls to them) are left out; reach agreement and the bundle check own them.`
        : ``),
    ``,
  ]
  if (excluded.length > 0)
    lines.push(
      `Ordinary test files left out because they fail with no mutant active: ${excluded.join(`, `)}.`,
      ``,
    )
  lines.push(
    `## How to use this report`,
    ``,
    `A gap is evidence that the oracle cannot see some difference in production. It does not say which model rule to add. For each gap:`,
    ``,
    `1. State the law it reveals: one that is missing, misstated, or not enforced. Several gaps often reveal one law.`,
    `2. Name the law's authority: a contract document and section, or a maintainer decision.`,
    `3. Re-plan the oracle around that law: its grammar or domain, model, observations, or comparison. Do not patch the line.`,
    `4. Run the check again.`,
    ``,
    `Rerun one mutant with \`--only <id>\`.`,
    ``,
    `## Gaps`,
    ``,
  )
  const byFunction = new Map()
  for (const gap of gaps) {
    const group = gap.authored ? `authored mutants` : `fn ${gap.function}`
    byFunction.set(group, [...(byFunction.get(group) ?? []), gap])
  }
  if (gaps.length === 0) lines.push(`None.`, ``)
  for (const [group, rows] of byFunction) {
    lines.push(`### ${group} (${rows[0].source})`, ``)
    for (const gap of rows) {
      const kind = gap.class ?? gap.outcome
      lines.push(
        `- **${kind}**, line ${gap.line}: ${change(gap)}`,
        `  - Key: ${codeSpan(gap.key)}; rerun: \`--only ${gap.id}\``,
        `  - ${questions[kind] ?? questions.survived}`,
      )
      if (gap.oracleFiles?.length)
        lines.push(`  - Owners: ${gap.oracleFiles.join(`, `)}`)
      if (gap.changedTests?.length)
        lines.push(
          `  - Changed observations in: ${gap.changedTests
            .slice(0, 3)
            .map((k) => k.split(` > `).slice(1).join(` > `))
            .join(`; `)}`,
        )
      if (gap.laws?.length)
        lines.push(`  - Laws that rejected it: ${gap.laws.join(`, `)}`)
      if (gap.detail) lines.push(`  - Detail: ${gap.detail.slice(0, 200)}`)
    }
    lines.push(``)
  }
  if (unowned.length > 0)
    lines.push(
      `## Unowned (warnings)`,
      ``,
      `No oracle's \`owns\` call tree contains these functions, so no test judges them.`,
      ``,
      ...unowned.map((r) => `- Unowned: ${codeSpan(r.key)}`),
      ``,
    )
  const byLaw = new Map()
  for (const result of killed)
    for (const law of result.laws ?? [])
      byLaw.set(law, (byLaw.get(law) ?? 0) + 1)
  lines.push(
    `## Kills by law`,
    ``,
    `A law that kills nothing may be untested by the mutants, or redundant.`,
    ``,
    `| Law | Mutants it rejected |`,
    `|---|---|`,
    ...[...byLaw]
      .sort((a, b) => b[1] - a[1])
      .map(([law, count]) => `| ${law} | ${count} |`),
  )
  return lines.join(`\n`)
}
