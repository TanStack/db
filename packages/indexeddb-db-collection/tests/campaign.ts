/** Node-side campaign and replay receipts. Shrinking may retain a candidate only
 * if it reaches the original premises and fails the same law/checkpoint. Other
 * failures remain evidence, but cannot replace the captured counterexample.
 * No value observed here supplies expected Collection data.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import fc from 'fast-check'
import { OracleMismatch, equal } from './cross-tab-oracle'

export type CampaignReceipt = { reach: Set<string> }
function failure(error: unknown): {
  law: string
  checkpoint: string
  detail: string
  expected?: unknown
  actual?: unknown
} {
  if (error instanceof AggregateError && error.cause !== undefined)
    return failure(error.cause)
  if (error instanceof OracleMismatch)
    return {
      law: error.law,
      checkpoint: error.checkpoint,
      detail: error.message,
      expected: error.expected,
      actual: error.actual,
    }
  return {
    law: error instanceof Error ? error.name : 'unknown failure',
    checkpoint: String(error).split('\n')[0]!,
    detail: String(error),
    ...(error instanceof Error && 'expected' in error
      ? { expected: error.expected }
      : {}),
    ...(error instanceof Error && 'actual' in error
      ? { actual: error.actual }
      : {}),
  }
}
export async function runCampaign<T>(
  name: string,
  arbitrary: fc.Arbitrary<T>,
  run: (history: T, receipt: CampaignReceipt) => Promise<void>,
  options: { runs: number; seed?: number; path?: string; environment?: string },
) {
  type Failed = ReturnType<typeof failure> & {
    history: T
    reach: Array<string>
  }
  const failures: Array<Failed> = []
  let original: Failed | undefined
  const property = fc.asyncProperty(arbitrary, async (history) => {
    const receipt: CampaignReceipt = { reach: new Set() }
    try {
      await run(history, receipt)
    } catch (error) {
      const captured = {
        ...failure(error),
        history: structuredClone(history),
        reach: [...receipt.reach],
      }
      failures.push(captured)
      original ??= captured
      if (
        captured.law === original.law &&
        captured.checkpoint === original.checkpoint &&
        original.reach.every((premise) => receipt.reach.has(premise))
      )
        throw error
    }
  })
  function replayOnce(seed: number | undefined, path: string) {
    if (seed === undefined) throw new Error('Replay requires an explicit seed')
    // check() can visit the remaining shrink siblings after a repaired input
    // passes. sample() selects exactly one value at the requested coordinates;
    // the one-example check invokes the same recorder and refinement check.
    const examples = fc.sample(fc.tuple(arbitrary), { seed, path, numRuns: 1 })
    if (examples.length !== 1) throw new Error('Replay selected no history')
    return fc.check(property, {
      seed,
      examples,
      numRuns: 1,
      endOnFailure: true,
    })
  }
  const result =
    options.path === undefined
      ? await fc.check(property, {
          numRuns: options.runs,
          ...(options.seed === undefined ? {} : { seed: options.seed }),
        })
      : await replayOnce(options.seed, options.path)
  const selectedPath = options.path ?? result.counterexamplePath
  let reproduction:
    | {
        inputReconstructed: boolean
        premiseReached: boolean
        sameFailure: boolean
      }
    | undefined
  if (result.failed) {
    const replayOffset = failures.length
    const replay = await replayOnce(result.seed, selectedPath!)
    const replayFailure = failures[replayOffset]
    reproduction = {
      inputReconstructed: equal(result.counterexample, replay.counterexample),
      premiseReached:
        replayFailure !== undefined &&
        original!.reach.every((premise) =>
          replayFailure.reach.includes(premise),
        ),
      sameFailure:
        replay.failed &&
        replayFailure?.law === original!.law &&
        replayFailure.checkpoint === original!.checkpoint,
    }
  }
  const report = {
    name,
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    fastCheck: fc.__version,
    environment: options.environment ?? 'fake-indexeddb + controlled Channel',
    seed: result.seed,
    path: selectedPath,
    runs: result.numRuns,
    failed: result.failed,
    original,
    reduced: result.counterexample,
    reproduction,
    failures,
  }
  await mkdir('test-results/oracles', { recursive: true })
  await writeFile(
    `test-results/oracles/${name}-${result.seed}-${crypto.randomUUID()}.json`,
    JSON.stringify(report, null, 2),
  )
  if (result.failed)
    throw new Error(
      `${name} failed: seed=${result.seed} path=${selectedPath}; replay=${JSON.stringify(reproduction)}\n${result.error}`,
    )
  if (result.numRuns !== (options.path === undefined ? options.runs : 1))
    throw new Error('Campaign did not execute its declared budget')
}
