/**
 * # Does row decoding admit one coherent batch or refuse it?
 *
 * A receiver authors a JSON-to-application decoder. Valid delivery preserves
 * each id and its declared Date/boolean meaning. If decoding rejects any row,
 * no prefix of that delivery becomes public. Eager initial refusal fails source
 * loading. For cold requested input, an on-demand source is already ready
 * while its initial query waits: refusal keeps that source ready, fails the
 * query load and records terminal source health. An idle SDK can instead
 * supply cached rows during startup. Its ordered refusal and first-ready events
 * select the before-readiness or after-readiness law; the adapter may choose
 * either readiness order. Live refusal keeps ready rows and reports a terminal
 * sync error. Every refusal stops the run and releases its resources.
 * A public query may retire before any input arrives. Its core acquisition
 * release permits that lease to be released while a successor still needs the
 * source. Release-time authority prevents a later retirement from excusing an
 * earlier release.
 *
 * Authority: the receiving adapter's parse contract; Collection loading-error,
 * sync-error, publication and acquisition-release contracts in the glossary,
 * plus collection-subscription-lifecycle-grammar-oracle.ts ownership. This family complements
 * eager FID-1 with admission/refusal; it does not impose a generic schema policy.
 * Limits: one table/stream, 1–4 rows, initial and one live batch, Date/boolean
 * fields, thrown decoding or changed id. No reload, persistence or mutation law.
 */
import fc from 'fast-check'

export type DecodeThrowCause =
  `error` | `null-prototype` | `throwing-conversion` | `throwing-prototype`
export type DecodeHistory = {
  mode: `eager` | `on-demand`
  startup?: `cold` | `cached`
  throwCause?: DecodeThrowCause
  /** Dispose one pending query before creating the query judged below. */
  retireDemand?: boolean
  phase: `initial` | `live`
  outcome: `valid` | `throw` | `changed-id`
  count: number
  refusalIndex: number
  overlap: boolean
  coordinate: number
  epoch: number
  flag: boolean
}

// Refusal position is derived from a generated coordinate, so every shrinking
// result remains in bounds. Removing mode loses source-vs-query readiness.
// Removing phase loses loading-vs-ready behavior;
// removing position loses prefix publication; removing overlap loses updates.
// Different generated coordinates challenge value fidelity without adding a
// schema branch. Illegal positions and unknown outcomes cannot be constructed.
export const decodeHistoryArb: fc.Arbitrary<DecodeHistory> = fc
  .record({
    mode: fc.constantFrom(`eager` as const, `on-demand` as const),
    startup: fc.constantFrom(`cold` as const, `cached` as const),
    throwCause: fc.constantFrom(
      `error` as const,
      `null-prototype` as const,
      `throwing-conversion` as const,
      `throwing-prototype` as const,
    ),
    retireDemand: fc.boolean(),
    phase: fc.constantFrom(`initial` as const, `live` as const),
    outcome: fc.constantFrom(
      `valid` as const,
      `throw` as const,
      `changed-id` as const,
    ),
    count: fc.integer({ min: 1, max: 4 }),
    refusalIndex: fc.nat({ max: 1000 }),
    overlap: fc.boolean(),
    coordinate: fc.integer({ min: 0, max: 100_000 }),
    epoch: fc.integer({ min: 0, max: 2_000_000_000_000 }),
    flag: fc.boolean(),
  })
  .map(
    (h) => ({
      ...h,
      startup: h.phase === `initial` ? h.startup : `cold`,
      throwCause: h.outcome === `throw` ? h.throwCause : `error`,
      retireDemand:
        h.mode === `on-demand` && h.startup === `cold` && h.retireDemand,
      refusalIndex: h.refusalIndex % h.count,
    }),
    (value) => {
      const history = value as DecodeHistory
      return {
        ...history,
        startup: history.startup ?? `cold`,
        throwCause: history.throwCause ?? `error`,
        retireDemand: history.retireDemand ?? false,
      }
    },
  )

export type DecodedRow = { id: string; flag: boolean; when: Date }
// A public value observation keeps type as well as value. An ISO string with
// the right text cannot masquerade as an application Date in this judgment.
export type DecodeValue = {
  id: string
  flagType: string
  flag: unknown
  whenType: string
  epoch: unknown
}
export function observeDecodeRows(
  rows: ReadonlyArray<DecodedRow>,
): Array<DecodeValue> {
  return rows
    .map((row) => ({
      id: row.id,
      flagType: typeof row.flag,
      flag: row.flag,
      whenType: row.when instanceof Date ? `Date` : typeof row.when,
      epoch: row.when instanceof Date ? row.when.getTime() : row.when,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function decodeId(
  h: DecodeHistory,
  index: number,
  initial: boolean,
): string {
  return `row-${h.coordinate}-${initial || h.overlap ? `shared` : `new`}-${index}`
}
// Independent expected values come from authored application coordinates,
// never the receiver's parser, provider JSON, SDK snapshot, or source helpers.
function expectedBatch(h: DecodeHistory, initial: boolean): Array<DecodeValue> {
  return Array.from({ length: h.count }, (_, index) => ({
    id: decodeId(h, index, initial),
    flagType: `boolean`,
    flag: (index % 2 === 0) === (initial ? h.flag : !h.flag),
    whenType: `Date`,
    epoch: h.epoch + index + (initial ? 0 : 10_000),
  }))
}
export function decodeFailureMessage(h: DecodeHistory): string | null {
  return h.outcome === `valid`
    ? null
    : h.outcome === `throw`
      ? `refused-${h.coordinate}-${h.refusalIndex}`
      : `invalid-row-id`
}
// The source and query have separate initial gates. Eager source readiness
// certifies decoded rows. Cold on-demand source readiness permits acquisitions;
// only the query's later readiness certifies its requested result. Refusal
// ends a still-loading gate, while an already-ready consumer retains its rows.
// Cached on-demand startup may mark ready before or after decoding. The model
// offers coherent source cuts guarded by actual ready/refusal order; it does
// not derive expected status from the implementation's final status. Initial
// source readiness permits acquisition, so a valid cached ready snapshot may
// be empty or contain the whole admitted batch, never a prefix.
// This follows the public readiness contracts without modeling SDK queues.
export function decodeModel(h: DecodeHistory) {
  const before = h.phase === `live` ? expectedBatch(h, true) : []
  const target = expectedBatch(h, h.phase === `initial`)
  const rows = new Map(before.map((row) => [row.id, row]))
  if (h.outcome === `valid`) for (const row of target) rows.set(row.id, row)
  const cachedOnDemand = h.mode === `on-demand` && h.startup === `cached`
  const ordinaryReady =
    h.mode === `on-demand`
      ? []
      : h.phase === `live`
        ? before
        : h.outcome === `valid`
          ? target
          : null
  const sourceCuts: Array<{
    status: string
    load: string
    readySnapshots: Array<Array<DecodeValue>>
    readyBeforeRefusal?: boolean
  }> = cachedOnDemand
    ? h.outcome === `valid`
      ? [[], target].map((snapshot) => ({
          status: `ready`,
          load: `fulfilled`,
          readySnapshots: [snapshot],
        }))
      : [
          {
            status: `error`,
            load: `rejected`,
            readySnapshots: [],
            readyBeforeRefusal: false,
          },
          {
            status: `ready`,
            load: `fulfilled`,
            readySnapshots: [[]],
            readyBeforeRefusal: true,
          },
        ]
    : [
        {
          status:
            h.mode === `eager` && h.phase === `initial` && h.outcome !== `valid`
              ? `error`
              : `ready`,
          load:
            h.mode === `eager` && h.phase === `initial` && h.outcome !== `valid`
              ? `rejected`
              : `fulfilled`,
          readySnapshots: ordinaryReady === null ? [] : [ordinaryReady],
        },
      ]
  return {
    before: before.sort((a, b) => a.id.localeCompare(b.id)),
    sourceCuts,
    queryReadyRows:
      h.phase === `live` ? before : h.outcome === `valid` ? target : null,
    rows: [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
    queryStatus:
      h.phase === `initial` && h.outcome !== `valid` ? `error` : `ready`,
    queryLoad:
      h.phase === `initial` && h.outcome !== `valid` ? `rejected` : `fulfilled`,
    error: decodeFailureMessage(h),
    stopped: h.outcome !== `valid`,
  }
}

export type DecodeBoundary = `source ready` | `parser refusal`

export type DecodeQueryObservation = {
  before: Array<DecodeValue>
  rows: Array<DecodeValue>
  readySnapshots: Array<Array<DecodeValue>>
  publications: Array<Array<DecodeValue>>
  status: string
  load: string
  rejection: { name: string; message: string } | null
  sourceStatus: string | undefined
  sourceError: string | null
  sourceErrorPresent: boolean
}
export type DecodeObservation = {
  mode: string
  subsetRequests: number
  query?: DecodeQueryObservation
  /** Source ready and query pending before any requested stream is delivered. */
  atDemand?: {
    sourceStatus: string
    sourceLoad: string
    sourceRows: Array<DecodeValue>
    queryStatus: string
    queryLoad: string
    queryRows: Array<DecodeValue>
  }
  browserErrors?: ReadonlyArray<string>
  cleanupErrors?: ReadonlyArray<string>
  before: Array<DecodeValue>
  rows: Array<DecodeValue>
  readySnapshots: Array<Array<DecodeValue>>
  publications: Array<Array<DecodeValue>>
  status: string
  load: string
  error: string | null
  errorPresent: boolean
  admissionErrors: Array<{ entry: string; name: string; message: string }>
  boundaryEvents: Array<DecodeBoundary>
  failureReason: string | null
  requiredResourceKinds: ReadonlyArray<string>
  resources: Array<{
    kind: string
    releases: number
    /** Actual core request abort/unload, never the adapter's own abort. */
    coreReleased?: boolean
    /** Releases before core release or an actual parser refusal. */
    prematureReleases?: number
  }>
  providerActive: boolean
  parsed: Array<string>
  causesThrown: Array<string>
  cachedInput: Array<string>
  cachedStartup: { clientState: string; providerOpen: boolean } | null
  reached: Array<string>
}
const basicDecodeStates = [
  `initial-valid`,
  `initial-throw`,
  `initial-changed-id`,
  `live-valid`,
  `live-throw`,
  `live-changed-id`,
  `refusal-first`,
  `refusal-middle`,
  `refusal-last`,
  `live-overlap`,
  `live-fresh`,
] as const
type BasicDecodeState =
  | (typeof basicDecodeStates)[number]
  | `${DecodeHistory['phase']}-${Exclude<DecodeHistory['outcome'], `valid`>}-${`first` | `middle` | `last`}`
export type DecodeState =
  | `${DecodeHistory['mode']}:${BasicDecodeState}`
  | `on-demand:source-ready-query-pending`
  | `on-demand:retired-demand-with-active-successor`
  | `${DecodeHistory['mode']}:${`cold-${DecodeHistory['phase']}-throw-${Exclude<DecodeThrowCause, `error`>}` | `cached-initial-${`valid` | `changed-id` | `throw-${DecodeThrowCause}`}`}`
const statesPerMode: ReadonlyArray<BasicDecodeState> = [
  ...basicDecodeStates,
  ...([`initial`, `live`] as const).flatMap((phase) =>
    ([`throw`, `changed-id`] as const).flatMap((outcome) =>
      ([`first`, `middle`, `last`] as const).map(
        (position) => `${phase}-${outcome}-${position}` as const,
      ),
    ),
  ),
]
export const decodeStates: ReadonlyArray<DecodeState> = [
  ...([`eager`, `on-demand`] as const).flatMap((mode) =>
    statesPerMode.map((state) => `${mode}:${state}` as const),
  ),
  `on-demand:source-ready-query-pending`,
  `on-demand:retired-demand-with-active-successor`,
  ...([`eager`, `on-demand`] as const).flatMap((mode) => [
    ...([`initial`, `live`] as const).flatMap((phase) =>
      (
        [`null-prototype`, `throwing-conversion`, `throwing-prototype`] as const
      ).map((cause): DecodeState => `${mode}:cold-${phase}-throw-${cause}`),
    ),
    ...(
      [
        `valid`,
        `changed-id`,
        `throw-error`,
        `throw-null-prototype`,
        `throw-throwing-conversion`,
        `throw-throwing-prototype`,
      ] as const
    ).map((outcome): DecodeState => `${mode}:cached-initial-${outcome}`),
  ]),
]

/** The same judgment checks generated histories, fixed histories and hosts. */
export function decodeViolations(
  h: DecodeHistory,
  raw: DecodeObservation,
): Array<string> {
  const expected = decodeModel(h)
  const arbitraryCause =
    h.outcome === `throw` &&
    h.throwCause !== undefined &&
    h.throwCause !== `error`
  const failures: Array<string> = [
    ...(raw.browserErrors ?? []).map((message) => `browser error: ${message}`),
    ...(raw.cleanupErrors ?? []).map((message) => `cleanup error: ${message}`),
  ]
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b)
  if (raw.mode !== h.mode) failures.push(`wrong receiving mode`)
  const readyIndex = raw.boundaryEvents.indexOf(`source ready`)
  const refusalIndex = raw.boundaryEvents.indexOf(`parser refusal`)
  const readyCount = raw.boundaryEvents.filter(
    (event) => event === `source ready`,
  ).length
  if (h.outcome !== `valid` && refusalIndex < 0)
    failures.push(`missing parser refusal boundary`)
  const readyBeforeRefusal = readyIndex >= 0 && readyIndex < refusalIndex
  const sourceCuts = expected.sourceCuts.filter(
    (cut) =>
      cut.readyBeforeRefusal === undefined ||
      cut.readyBeforeRefusal === readyBeforeRefusal,
  )
  if (
    !sourceCuts.some(
      (cut) =>
        cut.status === raw.status &&
        cut.load === raw.load &&
        readyCount === (cut.status === `ready` ? 1 : 0) &&
        same(raw.readySnapshots, cut.readySnapshots),
    )
  )
    failures.push(`source readiness, settlement or event order differs`)
  if (
    raw.admissionErrors.some(
      (error) =>
        h.outcome === `valid` || error.name === `CollectionConfigurationError`,
    )
  )
    failures.push(`valid adapter subscription reported a configuration failure`)
  if (h.mode === `on-demand`) {
    if (
      !raw.subsetRequests &&
      !(h.startup === `cached` && h.outcome !== `valid`)
    )
      failures.push(`query never requested a subset`)
    const demand = raw.atDemand
    if (
      h.startup !== `cached` &&
      (!demand ||
        demand.sourceStatus !== `ready` ||
        demand.sourceLoad !== `fulfilled` ||
        demand.sourceRows.length ||
        demand.queryStatus !== `loading` ||
        demand.queryLoad !== `pending` ||
        demand.queryRows.length)
    )
      failures.push(`source-ready/query-pending demand cut differs`)
    const query = raw.query
    if (!query) failures.push(`missing on-demand query observation`)
    else {
      if (
        !same(query.before, expected.before) ||
        !same(query.rows, expected.rows)
      )
        failures.push(`query rows differ`)
      const wantedQueryReady =
        expected.queryReadyRows === null ? [] : [expected.queryReadyRows]
      if (!same(query.readySnapshots, wantedQueryReady))
        failures.push(`query rows at ready differ`)
      if (
        query.status !== expected.queryStatus ||
        query.load !== expected.queryLoad
      )
        failures.push(`query status or settlement differs`)
      if ((query.rejection !== null) !== (expected.queryLoad === `rejected`))
        failures.push(`query rejection outcome differs`)
      if (
        !sourceCuts.some((cut) => query.sourceStatus === cut.status) ||
        (arbitraryCause
          ? !query.sourceErrorPresent
          : query.sourceError !== expected.error)
      )
        failures.push(`query source health differs`)
      if (h.outcome === `valid` && !query.publications.length)
        failures.push(`missing valid query publication`)
      if (h.outcome !== `valid` && query.publications.length)
        failures.push(`refused batch reached query publication`)
      for (const publication of query.publications)
        if (!same(publication, expected.rows))
          failures.push(`partial or wrong query publication`)
    }
  } else if (raw.query || raw.subsetRequests)
    failures.push(`eager receiver unexpectedly used query loading`)
  if (!same(raw.before, expected.before))
    failures.push(`before-delivery rows differ`)
  if (!same(raw.rows, expected.rows)) failures.push(`delivery rows differ`)
  for (const publication of raw.publications)
    if (!same(publication, expected.rows))
      failures.push(`partial or wrong publication`)
  if (h.outcome === `valid` && !raw.publications.length)
    failures.push(`missing valid publication`)
  if (h.outcome !== `valid` && raw.publications.length)
    failures.push(`refused batch published`)
  if (
    (arbitraryCause ? !raw.errorPresent : raw.error !== expected.error) ||
    raw.failureReason !== null
  )
    failures.push(`terminal decoding health differs`)
  if (
    raw.resources.some(
      (resource) =>
        resource.releases !==
          (expected.stopped || resource.coreReleased ? 1 : 0) ||
        (resource.prematureReleases ?? 0) !== 0,
    )
  )
    failures.push(`sync-run resources differ`)
  // Glossary acquisition release permits retiring an individual core request
  // while the source run remains live. Its actual abort/unload is authority;
  // the adapter's own SDK abort or release count is never that authority.
  // Release-time diagnostics preserve an early release even if core releases
  // that same request later. A stopped run still owes every historical release.
  // Resource shape belongs to the receiving path. A receiver with a single
  // subscription owes one release; Direct separately declares three kinds.
  for (const kind of raw.requiredResourceKinds)
    if (!raw.resources.some((resource) => resource.kind === kind))
      failures.push(`receiving resource witness missing ${kind}`)
  if (raw.providerActive === expected.stopped)
    failures.push(`provider lifetime differs`)
  const target = decodeId(h, h.refusalIndex, h.phase === `initial`)
  if (h.outcome !== `valid` && !raw.parsed.includes(target))
    failures.push(`refusal row never reached parser`)
  return failures
}
