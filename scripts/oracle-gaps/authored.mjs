// Authored mutants: plausible wrong implementations that someone other than
// the oracle's author wrote.
//
// Operator mutants (schemata.mjs) find what a small syntactic edit exposes.
// The reviewers' findings came mostly from semantic mutants instead: a
// scheduler that remembers retired IDs, a hash that collides, a retry that
// skips its write. Running such a mutant is mechanical; inventing one is
// not, and the oracle's own author tends to write the mutants the oracle
// already kills. So the runner takes them from a directory, and each one
// names its author, which the report shows.
//
// A mutant file is JSON, one object or an array of them:
//
//   {
//     "id": "tombstone-retired-ids",
//     "source": "src/executor/KeyScheduler.ts",   // relative to --package
//     "find": "exact text that occurs once in the source",
//     "replace": "the wrong implementation",
//     "intent": "remember removed IDs it never held",
//     "author": "the session or agent that wrote it"
//   }
//
// `find` must occur exactly once, so a mutant cannot silently apply to the
// wrong place or stop applying after an edit; one that does not apply is
// reported as `does-not-apply`.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const fields = [`id`, `source`, `find`, `replace`, `intent`, `author`]

export function loadAuthored(directory) {
  const mutants = []
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith(`.json`)) continue
    const parsed = JSON.parse(readFileSync(join(directory, name), `utf8`))
    for (const mutant of Array.isArray(parsed) ? parsed : [parsed]) {
      const missing = fields.filter(
        (field) => typeof mutant[field] !== `string` || mutant[field] === ``,
      )
      if (missing.length > 0)
        throw new Error(
          `${name}: authored mutant ${mutant.id ?? `(no id)`} lacks ${missing.join(`, `)}`,
        )
      mutants.push({ ...mutant, file: name })
    }
  }
  const ids = mutants.map((m) => m.id)
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (repeated.length > 0)
    throw new Error(`authored mutant ids repeat: ${repeated.join(`, `)}`)
  return mutants
}

/** The patched source text, or undefined when `find` does not occur once. */
export function applyAuthored(text, mutant) {
  const at = text.indexOf(mutant.find)
  if (at < 0 || text.indexOf(mutant.find, at + 1) >= 0) return undefined
  return {
    text: text.slice(0, at) + mutant.replace + text.slice(at + mutant.find.length),
    line: text.slice(0, at).split(`\n`).length,
  }
}
