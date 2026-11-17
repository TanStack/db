/** Immutable test-only overlay; original module IDs preserve real imports. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PluginOption } from 'vite'

type Candidate = {
  originalSha: string
  candidateSha: string
  candidateName: string
}
export function baselineCandidatePlugins(root: string): Array<PluginOption> {
  const directory = process.env.TANSTACK_DB_BASELINE_CANDIDATE_DIR
  if (!directory) return []
  const candidates = JSON.parse(
    readFileSync(resolve(directory, `manifest.json`), `utf8`),
  ) as Record<string, Candidate>
  const hash = (source: string) =>
    createHash(`sha256`).update(source).digest(`hex`)
  return [
    {
      name: `immutable-baseline-lifecycle-candidate-${hash(JSON.stringify(candidates)).slice(0, 16)}`,
      enforce: `pre`,
      transform(source, id) {
        const target = id.split(`?`)[0]
        for (const [file, entry] of Object.entries(candidates)) {
          if (target !== resolve(root, file)) continue
          if (hash(source) !== entry.originalSha)
            throw new Error(`Original source hash changed: ${file}`)
          const candidate = readFileSync(
            resolve(directory, entry.candidateName),
            `utf8`,
          )
          if (hash(candidate) !== entry.candidateSha)
            throw new Error(`Frozen candidate hash changed: ${file}`)
          process.stdout.write(
            `Baseline lifecycle candidate applied: ${file} ${entry.candidateSha}\n`,
          )
          return { code: candidate, map: null }
        }
        return undefined
      },
    },
  ]
}
