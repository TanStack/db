import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import { fc } from '@fast-check/vitest'
import vitestPackage from 'vitest/package.json'
import type * as HashModuleExports from '../src/hashing/hash'

type HashModule = Pick<typeof HashModuleExports, `hash` | `registerOpaqueHash`>

const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../src/hashing`,
)
const sourceDigest = createHash(`sha256`)
  .update(readFileSync(resolve(sourceDirectory, `hash.ts`)))
  .update(readFileSync(resolve(sourceDirectory, `murmur.ts`)))
  .digest(`hex`)

export type HashSession = HashModule & {
  readonly tape: ReadonlyArray<number>
  readonly environment: Readonly<{
    node: string
    platform: string
    arch: string
    fastCheck: string
    vitest: string
    hashSources: string
  }>
}

// Only module initialization is recorded/replayed. Hash calls and fast-check
// generation run after the spy has been restored. Call serially within a file.
export async function captureHashSession(
  tape?: ReadonlyArray<number>,
  load: () => Promise<HashModule> = () => import('../src/hashing/hash'),
): Promise<HashSession> {
  vi.resetModules()
  const replayTape = tape?.slice()
  const nativeRandom = Math.random
  const draws: Array<number> = []
  let cursor = 0
  const random = vi.spyOn(Math, `random`).mockImplementation(() => {
    if (replayTape && cursor >= replayTape.length)
      throw new Error(`Hash replay tape exhausted`)
    const value = replayTape ? replayTape[cursor++]! : nativeRandom()
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error(`Invalid hash initialization draw`)
    }
    draws.push(value)
    return value
  })
  try {
    const module = await load()
    if (replayTape && cursor !== replayTape.length)
      throw new Error(`Unused hash replay draws`)
    return {
      ...module,
      tape: Object.freeze(draws),
      environment: Object.freeze({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        fastCheck: fc.__version,
        vitest: vitestPackage.version,
        hashSources: sourceDigest,
      }),
    }
  } finally {
    random.mockRestore()
  }
}

export class HashReplayError extends Error {
  constructor(
    readonly replay: {
      law: string
      input: unknown
      observed: ReadonlyArray<number>
      tape: ReadonlyArray<number>
      environment: HashSession[`environment`]
    },
    cause: unknown,
  ) {
    // The outer native fast-check runner retains its own seed/path/minimized
    // inputs. Do not replace its reporter or stringify away the original cause.
    super(`Hash law replay: ${JSON.stringify(replay)}`, { cause })
    this.name = `HashReplayError`
  }
}
