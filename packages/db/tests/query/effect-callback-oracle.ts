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
 * suppression, and an unordered or an ordered query (`orderBy` with `limit`).
 * Every history updates before and after callback replacement, then exits,
 * reenters and updates again. An update of an absent source is not legal.
 * An ordered Effect compares an update with its previous publication, so an
 * update whose projection did not change is not delivered. A class instance
 * can hold readable state outside its enumerable fields, so the comparison
 * treats it as equal only to itself (maintainer decision 2026-11-02): its
 * update is delivered. A `signed-zero`
 * payload alternates 0 and -0, which are distinct row values (maintainer
 * decision 2026-10-29), so each of its updates is delivered in both orders.
 * Its source row also changes `version`. A `source-zero` history stores the
 * signed zero in the source row itself, so each update changes the source
 * row only by a zero's sign; live-query rows tell -0 from 0 as well
 * (maintainer decision 2026-11-02), so it is delivered in both orders too.
 * These eager single-source histories do not cover ordered repairs across
 * windows or arbitrary provider schedules. Both receiving drivers use this same judgment.
 * The maintainer's 2026-10-30 decision preserves unordered notifications even
 * for equal projections and permits key-only membership tracking. A synthesized
 * Set counts leaf reads outside observation capture: these unordered Effects
 * must not add traversal of projected values. This is not a Set latency law.
 */
import { expect } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import { checkWithCleanup } from './virtual-row-fields-support.js'
import type { DeltaEvent, EffectConfig } from '../../src/query/effect.js'

export type CallbackRow = { id: number; version: number }
export type CallbackOutput = { id: number; payload: unknown }
type Representation =
  | `scalar`
  | `opaque`
  | `private`
  | `prototype`
  | `set`
  | `equal`
  | `signed-zero`
  | `source-zero`
export const callbackHistories = (
  [
    `scalar`,
    `opaque`,
    `private`,
    `prototype`,
    `set`,
    `equal`,
    `signed-zero`,
    `source-zero`,
  ] as const
).flatMap((representation) =>
  ([`all`, `enter`, `exit`, `late-update`, `late-batch`] as const).flatMap(
    (profile) =>
      [false, true].flatMap((skipInitial) =>
        [false, true].map((ordered) => ({
          representation,
          profile,
          skipInitial,
          ordered,
        })),
      ),
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
    /** The query orders by `id` with a limit, so the Effect is ordered. */
    ordered: boolean
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
  return `${h.representation}/${h.profile}/${h.skipInitial}/${h.ordered ? `ordered` : `unordered`}`
}
export function callbackReach(path: string) {
  // This bounded grammar executes each authored history once. Keep the
  // complete matrix of required cuts and count each cut once per execution.
  const counts = new Map<string, number>(
    callbackHistories.flatMap((h) =>
      cuts.map((cut) => [`${callbackHistoryId(h)}/${cut}`, 0] as const),
    ),
  )
  return {
    record(state: string) {
      const count = counts.get(state)
      if (count === undefined)
        throw new Error(
          `Effect callback delivery ${path}: undeclared cut ${state}`,
        )
      counts.set(state, count + 1)
    },
    counts: () => new Map(counts),
    assertReached() {
      expect(
        [...counts].filter(([, count]) => count < 1),
        `Effect callback delivery ${path}`,
      ).toEqual([])
    },
  }
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
      : representation === `signed-zero` || representation === `source-zero`
        ? version % 2 === 1
          ? `-0`
          : `0`
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
  return Object.is(payload, -0) ? `-0` : String(payload)
}
function expectedDelivery(
  representation: Representation,
  ordered: boolean,
  before: number | undefined,
  after: number | undefined,
  channels: ReadonlySet<string>,
  suppressed: boolean,
): Array<Observation> {
  if (suppressed || before === after) return []
  const type =
    before === undefined ? `enter` : after === undefined ? `exit` : `update`
  // An ordered Effect delivers an update only when its projection changed.
  if (
    ordered &&
    type === `update` &&
    expectedPayload(representation, before!) ===
      expectedPayload(representation, after!)
  ) {
    return []
  }
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
  const observedCuts = new Set<string>()
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
    if (history.representation === `signed-zero`)
      payload = version % 2 === 1 ? -0 : 0
    // The source row holds the signed zero (`stored`).
    if (history.representation === `source-zero`) payload = version
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
  // The version the source row stores for an authored version.
  const stored = (version: number) =>
    history.representation === `source-zero`
      ? version % 2 === 1
        ? -0
        : 0
      : version
  const failures: Array<unknown> = []
  let handle: Awaited<ReturnType<CallbackDriver[`mount`]>> | undefined
  let before: number | undefined
  const cut = (name: string, after: number | undefined, suppressed = false) => {
    try {
      checkDelivery(
        observed,
        expectedDelivery(
          history.representation,
          history.ordered,
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
    if (!observedCuts.has(name)) {
      reach.record(`${callbackHistoryId(history)}/${name}`)
      observedCuts.add(name)
    }
  }
  await checkWithCleanup(async () => {
    handle = await driver.mount({
      skipInitial: history.skipInitial,
      ordered: history.ordered,
      project,
      handlers: handlers(),
    })
    cut(`initial`, 0, history.skipInitial)
    await handle.write(`update`, stored(1))
    cut(`unobserved`, 1)
    if (history.profile === `late-update`) channels.add(`update`)
    if (history.profile === `late-batch`) channels.add(`batch`)
    await handle.replaceHandlers(handlers())
    cut(`replacement`, 1)
    await handle.write(`update`, stored(2))
    cut(`update`, 2)
    // Installing exit after unobserved updates distinguishes current values
    // from an initial value retained only when update handlers were present.
    channels = new Set([`exit`])
    await handle.replaceHandlers(handlers())
    await handle.write(`delete`, stored(2))
    cut(`exit`, undefined)
    channels = new Set([`enter`, `update`, `exit`, `batch`])
    await handle.replaceHandlers(handlers())
    await handle.write(`insert`, stored(3))
    cut(`reentry`, 3)
    await handle.write(`update`, stored(4))
    cut(`next-use`, 4)
    await handle.dispose()
    await handle.write(`update`, stored(5))
    cut(`disposed`, 4)
    if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`)
      console.info(
        `Effect comparison reads`,
        callbackHistoryId(history),
        comparisonReads,
      )
    // An ordered Effect compares values, so it may read them.
    if (!history.ordered) {
      try {
        expect(comparisonReads, `unordered output leaf traversal`).toBe(0)
      } catch (error) {
        failures.push(error)
      }
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
