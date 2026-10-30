/**
 * Callback profiles must not change the query's delta values. EffectConfig and
 * the Effect guide promise the current exiting value and the pre-batch update
 * value. React additionally promises the latest callbacks without remounting.
 * This extends the metadata owner's observation to handler subsets and values
 * whose readable state is absent from enumerable fields.
 *
 * An authored scalar source version independently predicts each readable
 * payload. The real query projection creates classes/Sets. The driver invokes
 * production. The finite grammar crosses payload representation, callback profile and initial
 * suppression. Every history updates before and after callback replacement,
 * then exits, reenters and updates again. An update of an absent source is not
 * legal. These eager single-source histories do not cover ordered repairs or
 * arbitrary provider schedules. Both receiving drivers use this same judgment.
 * The maintainer's 2026-10-30 decision preserves unordered notifications even
 * for equal projections and permits key-only membership tracking. A synthesized
 * Set counts leaf reads outside observation capture: these unordered Effects
 * must not add traversal of projected values. This is not a Set latency law.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { checkWithCleanup } from './virtual-row-fields-support.js'
import type { DeltaEvent, EffectConfig } from '../../src/query/effect.js'

export type CallbackRow = { id: number; version: number }
export type CallbackOutput = { id: number; payload: unknown }
type Representation =
  `scalar` | `opaque` | `private` | `prototype` | `set` | `equal`
export const callbackHistories = (
  [`scalar`, `opaque`, `private`, `prototype`, `set`, `equal`] as const
).flatMap((representation) =>
  ([`all`, `enter`, `exit`, `late-update`, `late-batch`] as const).flatMap(
    (profile) =>
      [false, true].map((skipInitial) => ({
        representation,
        profile,
        skipInitial,
      })),
  ),
)
export type CallbackHistory = (typeof callbackHistories)[number]
export type CallbackHandlers = Pick<
  EffectConfig<CallbackOutput>,
  `onEnter` | `onUpdate` | `onExit` | `onBatch`
>
export interface CallbackDriver {
  mount: (options: {
    skipInitial: boolean
    project: (row: CallbackRow) => CallbackOutput
    handlers: CallbackHandlers
  }) => Promise<{
    write: (
      type: `insert` | `update` | `delete`,
      version: number,
    ) => Promise<void>
    replaceHandlers: (handlers: CallbackHandlers) => Promise<void>
    dispose: () => Promise<void>
    cleanup: () => Promise<void>
  }>
}
type Observation = {
  channel: string
  type: string
  value: string
  previous?: string
}
const cuts = [
  `initial`,
  `unobserved`,
  `replacement`,
  `update`,
  `exit`,
  `reentry`,
  `next-use`,
  `disposed`,
]
export function callbackHistoryId(h: CallbackHistory) {
  return `${h.representation}/${h.profile}/${h.skipInitial}`
}
export function callbackReach(path: string) {
  return createOracleReach(
    `Effect callback delivery ${path}`,
    callbackHistories.flatMap((h) =>
      cuts.map((cut) => `${callbackHistoryId(h)}/${cut}`),
    ),
    { replaying: false },
  )
}

class PrivatePayload {
  #version: number
  constructor(version: number) {
    this.#version = version
  }
  read() {
    return this.#version
  }
}
class PrototypePayload {
  currency = `USD`
  constructor(version: number) {
    Object.defineProperty(this, `version`, { value: version })
  }
  declare version: number
  read(): number {
    return this.version
  }
}
class KeyedPrivatePayload extends PrivatePayload {
  currency = `USD`
}

// Full source-version recomputation defines readable values, not deepEquals or
// the production membership classifier. Sets retain three authored members.
function expectedPayload(
  representation: Representation,
  version: number,
): string {
  return representation === `set`
    ? `0,0,${version}`
    : representation === `equal`
      ? `0`
      : String(version)
}
function readPayload(payload: unknown): string {
  if (payload instanceof PrivatePayload || payload instanceof PrototypePayload)
    return String(payload.read())
  if (payload instanceof Set)
    return [...payload]
      .map((v: { value: number }) => v.value)
      .sort()
      .join(`,`)
  return String(payload)
}
function expectedDelivery(
  representation: Representation,
  before: number | undefined,
  after: number | undefined,
  channels: ReadonlySet<string>,
  suppressed: boolean,
): Array<Observation> {
  if (suppressed || before === after) return []
  const type =
    before === undefined ? `enter` : after === undefined ? `exit` : `update`
  const event = {
    type,
    value: expectedPayload(representation, after ?? before!),
    ...(type === `update`
      ? { previous: expectedPayload(representation, before!) }
      : {}),
  }
  return [...channels]
    .filter((c) => c === `batch` || c === type)
    .map((channel) => ({ channel, ...event }))
}
function checkDelivery(
  actual: Array<Observation>,
  expected: Array<Observation>,
) {
  const order = (a: Observation, b: Observation) =>
    a.channel.localeCompare(b.channel)
  expect([...actual].sort(order)).toStrictEqual([...expected].sort(order))
}
declareOracle({
  model: [expectedPayload, expectedDelivery],
  grammar: [callbackHistories],
  check: [checkDelivery],
})

export async function runCallbackHistory(
  history: CallbackHistory,
  driver: CallbackDriver,
  reach: ReturnType<typeof callbackReach>,
) {
  reach.beginHistory()
  const observed: Array<Observation> = []
  let recording = false
  let comparisonReads = 0
  let channels = new Set<string>(
    history.profile === `all`
      ? [`enter`, `update`, `exit`, `batch`]
      : history.profile.startsWith(`late`)
        ? [`exit`]
        : [history.profile],
  )
  const record = (channel: string, event: DeltaEvent<CallbackOutput>) => {
    recording = true
    try {
      observed.push({
        channel,
        type: event.type,
        value: readPayload(event.value.payload),
        ...(event.type === `update`
          ? { previous: readPayload(event.previousValue.payload) }
          : {}),
      })
    } finally {
      recording = false
    }
  }
  const handlers = (): CallbackHandlers => ({
    onEnter: channels.has(`enter`) ? (e) => record(`enter`, e) : undefined,
    onUpdate: channels.has(`update`) ? (e) => record(`update`, e) : undefined,
    onExit: channels.has(`exit`) ? (e) => record(`exit`, e) : undefined,
    onBatch: channels.has(`batch`)
      ? (events) => {
          for (const e of events) record(`batch`, e)
        }
      : undefined,
  })
  const project = ({ id, version }: CallbackRow): CallbackOutput => {
    let payload: unknown = version
    if (history.representation === `opaque`)
      payload = new PrivatePayload(version)
    if (history.representation === `private`)
      payload = new KeyedPrivatePayload(version)
    if (history.representation === `equal`) payload = 0
    if (history.representation === `prototype`) {
      payload = new PrototypePayload(version)
    }
    if (history.representation === `set`)
      payload = new Set(
        [0, 0, version].map((value) => ({
          get value() {
            if (!recording) comparisonReads++
            return value
          },
        })),
      )
    return { id, payload }
  }
  const failures: Array<unknown> = []
  let handle: Awaited<ReturnType<CallbackDriver[`mount`]>> | undefined
  let before: number | undefined
  const cut = (name: string, after: number | undefined, suppressed = false) => {
    try {
      checkDelivery(
        observed,
        expectedDelivery(
          history.representation,
          before,
          after,
          channels,
          suppressed,
        ),
      )
    } catch (error) {
      failures.push(new Error(`callback cut ${name}`, { cause: error }))
    }
    observed.length = 0
    before = after
    reach.reach(`${callbackHistoryId(history)}/${name}`)
  }
  await checkWithCleanup(async () => {
    handle = await driver.mount({
      skipInitial: history.skipInitial,
      project,
      handlers: handlers(),
    })
    cut(`initial`, 0, history.skipInitial)
    await handle.write(`update`, 1)
    cut(`unobserved`, 1)
    if (history.profile === `late-update`) channels.add(`update`)
    if (history.profile === `late-batch`) channels.add(`batch`)
    await handle.replaceHandlers(handlers())
    cut(`replacement`, 1)
    await handle.write(`update`, 2)
    cut(`update`, 2)
    // Installing exit after unobserved updates distinguishes current values
    // from an initial value retained only when update handlers were present.
    channels = new Set([`exit`])
    await handle.replaceHandlers(handlers())
    await handle.write(`delete`, 2)
    cut(`exit`, undefined)
    channels = new Set([`enter`, `update`, `exit`, `batch`])
    await handle.replaceHandlers(handlers())
    await handle.write(`insert`, 3)
    cut(`reentry`, 3)
    await handle.write(`update`, 4)
    cut(`next-use`, 4)
    await handle.dispose()
    await handle.write(`update`, 5)
    cut(`disposed`, 4)
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        `Effect comparison reads`,
        callbackHistoryId(history),
        comparisonReads,
      )
    try {
      expect(comparisonReads, `unordered output leaf traversal`).toBe(0)
    } catch (error) {
      failures.push(error)
    }
    if (failures.length)
      throw new AggregateError(failures, `Effect callback delivery failed`, {
        cause: failures[0],
      })
  }, [
    async () => {
      await handle?.cleanup()
    },
  ])
}
