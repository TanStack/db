// A child process for `oracle-replay.test.ts`: it runs one async property
// failure without and with the guarded replay reporter, and prints what the
// parent compares. The framework reads the replay environment once, when the
// oracle configuration loads, so the parent sets that environment before this
// process starts; a test cannot change it afterwards.
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { oracleReplayReporter } from './oracle-replay-witness.js'

const property = `oracle-replay.calibration`
const sentinel = new Error(`native cause sentinel`)
const value = {
  [fc.asyncToStringMethod]: () => Promise.resolve(`async replay value`),
}
const failing = fc.asyncProperty(fc.constant(value), () =>
  Promise.reject(sentinel),
)

async function failure(instrumented: boolean): Promise<Error> {
  try {
    await fc.assert(failing, {
      seed: 42,
      path: `0`,
      numRuns: 1,
      ...(instrumented ? oracleReplayReporter(property, 42, `0`) : {}),
    })
  } catch (error) {
    if (error instanceof Error) return error
    throw error
  }
  throw new Error(`expected property failure`)
}

/** The `cause` property's attributes, and whether it holds the sentinel. */
function causeOf(error: Error) {
  const descriptor = Object.getOwnPropertyDescriptor(error, `cause`)
  return descriptor === undefined
    ? undefined
    : {
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        sentinel: descriptor.value === sentinel,
      }
}

const native = await failure(false)
const instrumented = await failure(true)
const channel = process.env.TANSTACK_DB_ORACLE_REPLAY_WITNESS
console.log(
  JSON.stringify({
    native: { message: native.message, cause: causeOf(native) },
    instrumented: {
      message: instrumented.message,
      cause: causeOf(instrumented),
    },
    witness:
      channel === undefined
        ? undefined
        : JSON.parse(readFileSync(channel, `utf8`)),
  }),
)
