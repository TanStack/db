/**
 * # Which failed streams still belong to active queries?
 *
 * Retiring one query removes only its claim. Every failed stream retained by
 * another ready query must keep source health unhealthy. Recovery removes all
 * failures for that stream, including failures whose error identity changed.
 * A successful subset load also waits for visible source rows. An error after
 * provider synchronization but before that visibility cannot yield a healthy,
 * successful initial query. Rejecting that initial query is also permitted.
 * Cleanup from the subscription mapper invalidates the sync run before that
 * mapper returns. It cannot leave a newly acquired provider stream behind.
 * Stream identity includes its name and parameters; one stream's configured
 * priority reaches the provider unchanged. An empty mapping reads cached rows
 * only after applied settlement and retains no stream of its own. A throwing
 * mapper rejects that request with its original error and leaves peers intact,
 * including the source's terminal health slot. A ready status alone does not
 * prove absence of a terminal source error.
 * A snapshot request's signal stays live while its mapper runs. An abort
 * before provider acquisition retains no SDK lease. An abort just after mapping
 * releases only that request's lease. A ready peer remains usable in either
 * case, and a later checkpoint cannot turn the canceled request into success.
 * The request branch's right owner is a public change subscription's snapshot
 * request; left remains a live-query Collection. This splits request admission
 * from query construction without changing stream ownership.
 * Settlement histories retain cold startup and also permit a completed empty
 * right demand before the judged left demand. The distinct right demand is
 * publicly retired first; it establishes no saved coverage for left. Its two
 * cuts teach the same ownership law. This legal prehistory lets a later live
 * acquisition receive an error while application is held, even when initial
 * source confirmation legitimately retires a cold acquisition for replay.
 * Subscription resolution is fixed for each provider request. Rejection,
 * changed rejection and recovery therefore open actual successor requests.
 * Scoped stream failures and connection outages are independent: retiring a
 * query removes its stream claim but cannot heal the shared connection.
 * Table rows follow successful source support, independently of health. In
 * this bounded fixture every successful stream supports the authored rows;
 * all rejected streams leave no bucket in the checkpoint and an empty table.
 *
 * Authority: the receiving adapter's public on-demand/error contract, the
 * glossary's logical subset owner and applied settlement, and the public
 * reportError/reportHealthy contract in guides/error-handling.md. Receivers
 * retain the source obligation in query/live/ARCHITECTURE.md, Source
 * cancellation and applied settlement: an aborted caller's load rejects once
 * accepted rows apply. Core ignoring an obsolete outcome does not waive that
 * source obligation. Receivers opt into immediate stream-error reporting;
 * this family does not prescribe
 * a generic network retry threshold.
 *
 * Limits: two finite equality demands, at most three provider streams, one
 * disjoint optimistic insert, one outage with optional changed errors and
 * recovery, or cleanup during mapping/after application. Mapping additionally
 * varies one numeric parameter tuple, one priority, cached-only settlement and
 * synchronous throw/retry. Receiving
 * registrations name SDK and host paths. No deployed-service, reload or
 * restart-durability claim follows from this model's public observations.
 */
import fc from 'fast-check'
import {
  streamConnectionOutage,
  streamHealthViolations,
} from './stream-health-oracle'
import type {
  StreamConnectionInput,
  StreamProblem,
} from './stream-health-oracle'

export type StreamOwner = `left` | `right`
type Coordinates = { coordinate: number; rowCount: number; value: number }
export type OnDemandStreamsHistory = Coordinates &
  (
    | {
        kind: `ownership`
        overlap: `same` | `partial` | `disjoint`
        failing: StreamOwner | `all`
        retire: StreamOwner
        changeError: boolean
        recover: boolean
        parameterization?: `equal` | `distinct`
      }
    | {
        kind: `settlement`
        timing: `before-sync` | `after-application`
      }
    | {
        kind: `settlement`
        timing: `before-application`
        baseline?: `confirmed-empty`
      }
    | {
        kind: `mapper`
        operation: `empty` | `throw` | `priority`
      }
    | {
        kind: `admission`
        cleanup: `during-mapping` | `after-application`
      }
    | {
        kind: `request`
        abort: `before-mapping` | `during-mapping` | `after-mapping` | `none`
      }
  )

// The branches have different legal actions. Ownership always starts with
// ready queries; settlement places one rejection around provider/application
// boundaries; admission ends a source during mapping or after a successful
// load. Mapper histories add a cached-only demand, a failed mapping/retry, or
// single-stream priority. Parameter tuples are equal or differ by one integer;
// conflicting priorities and malformed mapping returns cannot enter this grammar.
// Invalid timings and a third owner cannot enter this grammar.
// Removing overlap loses shared-error retirement; removing timing loses the
// accepted/applied distinction. Coordinates vary stream names, rows and values
// without changing those relationships. Zero rows are excluded because a held
// applied receipt requires a source write in this family's settlement witness.
const coordinateArbitraries = {
  coordinate: fc.integer({ min: 0, max: 10_000 }),
  rowCount: fc.integer({ min: 1, max: 3 }),
  value: fc.integer({ min: -20, max: 20 }),
}
export const onDemandStreamsHistoryArb: fc.Arbitrary<OnDemandStreamsHistory> =
  fc.oneof(
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`ownership` as const),
      overlap: fc.constantFrom(
        `same` as const,
        `partial` as const,
        `disjoint` as const,
      ),
      failing: fc.constantFrom(
        `left` as const,
        `right` as const,
        `all` as const,
      ),
      retire: fc.constantFrom(`left` as const, `right` as const),
      changeError: fc.boolean(),
      recover: fc.boolean(),
    }),
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`settlement` as const),
      timing: fc.constantFrom(
        `before-sync` as const,
        `before-application` as const,
        `after-application` as const,
      ),
    }),
    // Keep the cold branch above. A distinct completed empty donor changes no
    // row baseline and cannot authorize exact persisted coverage for left.
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`settlement` as const),
      timing: fc.constant(`before-application` as const),
      baseline: fc.constant(`confirmed-empty` as const),
    }),
    ...([`equal`, `distinct`] as const).map((parameterization) =>
      fc.record({
        ...coordinateArbitraries,
        kind: fc.constant(`ownership` as const),
        overlap: fc.constant(
          parameterization === `equal`
            ? (`same` as const)
            : (`disjoint` as const),
        ),
        parameterization: fc.constant(parameterization),
        failing: fc.constantFrom(
          `left` as const,
          `right` as const,
          `all` as const,
        ),
        retire: fc.constantFrom(`left` as const, `right` as const),
        changeError: fc.boolean(),
        recover: fc.boolean(),
      }),
    ),
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`mapper` as const),
      operation: fc.constantFrom(
        `empty` as const,
        `throw` as const,
        `priority` as const,
      ),
    }),
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`admission` as const),
      cleanup: fc.constantFrom(
        `during-mapping` as const,
        `after-application` as const,
      ),
    }),
    fc.record({
      ...coordinateArbitraries,
      kind: fc.constant(`request` as const),
      abort: fc.constantFrom(
        `before-mapping` as const,
        `during-mapping` as const,
        `after-mapping` as const,
        `none` as const,
      ),
    }),
  )

export type StreamRow = {
  id: string
  left: number
  right: number
  value: number
}
export function streamRows(h: Coordinates): Array<StreamRow> {
  return Array.from({ length: h.rowCount }, (_, index) => ({
    id: `row-${h.coordinate}-${index}`,
    left: h.coordinate,
    right: h.coordinate,
    value: h.value + index,
  }))
}

// This is the authored demand-to-stream relation. The model retains logical
// claims, not SDK leases, acquisitions, caches, or error-object identities.
// The distinction matters: retiring left removes different failed streams in
// same, partial, and disjoint histories even with identical public rows.
export type AuthoredStream = {
  name: string
  parameters?: Record<string, unknown>
  priority?: number
}

// The identity encoding names authored stream coordinates; it is not the SDK's
// normalization or lease classifier. This bounded domain has one parameter key,
// so object-key ordering cannot affect equality.
export function authoredStreamIdentity(stream: {
  name: string
  parameters?: Record<string, unknown>
}): string {
  return stream.parameters && Object.keys(stream.parameters).length
    ? JSON.stringify([stream.name, stream.parameters])
    : stream.name
}
export function ownerSubscriptions(
  h: OnDemandStreamsHistory,
): Record<StreamOwner, Array<AuthoredStream>> {
  const common = `common-${h.coordinate}`
  if (h.kind === `request`)
    return {
      left: [{ name: `left-${h.coordinate}` }],
      right: [{ name: `right-${h.coordinate}` }],
    }
  if (
    h.kind === `settlement` &&
    h.timing === `before-application` &&
    h.baseline === `confirmed-empty`
  )
    return {
      left: [{ name: `left-${h.coordinate}` }],
      right: [{ name: `right-${h.coordinate}` }],
    }
  if (h.kind === `ownership` && h.parameterization) {
    const left = { name: common, parameters: { partition: h.coordinate } }
    const right = {
      name: common,
      parameters: {
        partition: h.coordinate + (h.parameterization === `distinct` ? 1 : 0),
      },
    }
    return { left: [left], right: [right] }
  }
  if (h.kind === `mapper`) {
    if (h.operation === `empty`) return { left: [{ name: common }], right: [] }
    if (h.operation === `priority`)
      return {
        left: [{ name: common, priority: (h.coordinate % 3) + 1 }],
        right: [],
      }
    return {
      left: [{ name: `left-${h.coordinate}` }],
      right: [{ name: `right-${h.coordinate}` }],
    }
  }
  if (h.kind !== `ownership` || h.overlap === `same`)
    return { left: [{ name: common }], right: [{ name: common }] }
  const left = { name: `left-${h.coordinate}` }
  const right = { name: `right-${h.coordinate}` }
  return h.overlap === `partial`
    ? { left: [{ name: common }, left], right: [{ name: common }, right] }
    : { left: [left], right: [right] }
}
export function ownerStreams(
  h: OnDemandStreamsHistory,
): Record<StreamOwner, Array<string>> {
  const streams = ownerSubscriptions(h)
  return {
    left: streams.left.map(authoredStreamIdentity),
    right: streams.right.map(authoredStreamIdentity),
  }
}
export function failingStreams(h: OnDemandStreamsHistory): Array<string> {
  if (h.kind === `admission` || h.kind === `mapper` || h.kind === `request`)
    return []
  const streams = ownerStreams(h)
  return h.kind === `settlement`
    ? streams.left
    : h.failing === `all`
      ? [...new Set([...streams.left, ...streams.right])]
      : streams[h.failing]
}

export type QueryOutcome =
  `pending` | `fulfilled` | `rejected` | `retired` | `not-started`
export type StreamRejection =
  | { kind: `stream`; stream: string; messages: Array<string> }
  | { kind: `mapper`; message: string }
  | { kind: `other` }
export type StreamCut = {
  name: string
  outcomes: Partial<Record<StreamOwner, QueryOutcome>>
  problems: Array<StreamProblem>
  connectionInputs: ReadonlyArray<StreamConnectionInput>
  rows: Partial<Record<StreamOwner, Array<string>>>
  rowValues?: Partial<Record<StreamOwner, Array<number>>>
  queryStatuses?: Partial<Record<StreamOwner, string>>
  providerState?: string
  sourceStatus?: string
  sourceError?: boolean
  activeStreams?: Array<string>
  forwardedSubscriptions?: Array<AuthoredStream>
  rejections?: Partial<Record<StreamOwner, StreamRejection>>
  request?: {
    admitted: boolean
    aborted: boolean
    subscriptionStatus: string
    mapperCalls: number
    acquisitions: number
    rejection?: string
  }
}
export type StreamExpectation = {
  name: string
  outcomes: Partial<Record<StreamOwner, ReadonlyArray<QueryOutcome>>>
  problems: Array<string>
  /** A rejected initial query need not also report its failure on the source. */
  rejectionMayOwnError?: boolean
  rows?: Partial<Record<StreamOwner, Array<string>>>
  rowValues?: Partial<Record<StreamOwner, Array<number>>>
  queryStatuses?: Partial<Record<StreamOwner, string>>
  providerState?: string
  sourceStatus?: string
  sourceError?: boolean
  activeStreams?: Array<string>
  forwardedSubscriptions?: Array<AuthoredStream>
  rejections?: Partial<Record<StreamOwner, Array<StreamRejection>>>
  request?: Partial<NonNullable<StreamCut[`request`]>>
}

// Health follows incidence, independently of how the adapter represents its
// resources or deduplicates Error values. Multiple failures for one stream are
// permitted. The comparison preserves their existence and rejects stale
// failures after their final claim or recovery ends. One SDK lease may report
// only its first failed stream, so health need not enumerate every failure.
function expectedStreamCuts(
  h: OnDemandStreamsHistory,
): Array<StreamExpectation> {
  const ids = streamRows(h)
    .map((row) => row.id)
    .sort()
  if (h.kind === `request`) {
    const streams = ownerStreams(h)
    const before = h.abort === `before-mapping`
    const canceled = h.abort !== `none`
    const request = {
      ...(h.abort === `during-mapping` ? {} : { admitted: !before }),
      aborted: canceled,
      mapperCalls: before ? 0 : 1,
      ...(before ? { acquisitions: 0 } : {}),
    }
    // Acquisition counts remain diagnostics. The law permits an implementation
    // to allocate and immediately release a canceled request's resource; it
    // forbids retaining that resource or later fulfilling the canceled load.
    // This is request ownership, not a copy of the adapter's acquisition map:
    // an already canceled request may own no stream; a live request owns right.
    const activeStreams = canceled
      ? streams.left
      : [...streams.left, ...streams.right]
    const peer = {
      queryStatuses: { left: `ready` },
      sourceStatus: `ready`,
      sourceError: false,
      problems: [],
      rows: { left: ids },
    }
    return [
      {
        ...peer,
        name: `loaded`,
        outcomes: { left: [`fulfilled`] },
        activeStreams: streams.left,
      },
      {
        ...peer,
        name: `request-mapped`,
        outcomes: {
          left: [`fulfilled`],
          right: before
            ? [`not-started`]
            : canceled
              ? [`pending`, `rejected`]
              : [`pending`],
        },
        activeStreams,
        request,
      },
      {
        ...peer,
        name: `request-checkpoint`,
        outcomes: {
          left: [`fulfilled`],
          right: before
            ? [`not-started`]
            : canceled
              ? [`rejected`]
              : [`fulfilled`],
        },
        rowValues: { left: streamRows(h).map((row) => row.value + 100) },
        activeStreams,
        request: { ...request, subscriptionStatus: `ready` },
      },
    ]
  }
  const failed = [...new Set(failingStreams(h))].sort()
  // Every row is supported by each authored successful stream. A checkpoint
  // with all subscriptions rejected has no bucket; that SDK table result is
  // a separate data event from reporting the errors. Retirement alone sends
  // no new table result. The shared-table contract owns this row projection.
  const subscriptions = ownerStreams(h)
  const required =
    h.kind === `ownership`
      ? [...subscriptions.left, ...subscriptions.right]
      : subscriptions.left
  const failedRows = required.some((stream) => !failed.includes(stream))
    ? ids
    : []
  // The controlled provider authors these error messages at version one.
  // The public StreamError contract preserves their category and coordinates;
  // it does not require a particular Error object identity or Error.name.
  const rejections: Partial<Record<StreamOwner, Array<StreamRejection>>> = {
    left: failed.map((stream) => ({
      kind: `stream`,
      stream,
      messages: [`rejected-1-${stream}`],
    })),
  }
  if (h.kind === `mapper`) {
    const streams = ownerStreams(h)
    const loaded: StreamExpectation = {
      name: `loaded`,
      outcomes: { left: [`fulfilled`] },
      queryStatuses: { left: `ready` },
      sourceStatus: `ready`,
      sourceError: false,
      problems: [],
      rows: { left: ids },
      activeStreams: streams.left,
    }
    if (h.operation === `priority`)
      return [{ ...loaded, forwardedSubscriptions: ownerSubscriptions(h).left }]
    if (h.operation === `empty`)
      return [
        loaded,
        {
          name: `empty-receipt-held`,
          queryStatuses: { left: `ready` },
          sourceStatus: `ready`,
          sourceError: false,
          outcomes: { left: [`fulfilled`], right: [`pending`] },
          problems: [],
          activeStreams: streams.left,
        },
        {
          name: `empty-cached`,
          queryStatuses: { left: `ready`, right: `ready` },
          sourceStatus: `ready`,
          sourceError: false,
          outcomes: { left: [`fulfilled`], right: [`fulfilled`] },
          problems: [],
          rows: { left: ids, right: ids },
          rowValues: {
            left: streamRows(h).map((row) => row.value + 100),
            right: streamRows(h).map((row) => row.value + 100),
          },
          activeStreams: streams.left,
        },
        {
          name: `donor-retired`,
          queryStatuses: { right: `ready` },
          sourceStatus: `ready`,
          sourceError: false,
          outcomes: { left: [`retired`], right: [`fulfilled`] },
          problems: [],
          rows: { right: ids },
          rowValues: { right: streamRows(h).map((row) => row.value + 100) },
          activeStreams: [],
        },
      ]
    return [
      loaded,
      {
        name: `mapper-rejected`,
        queryStatuses: { left: `ready` },
        sourceStatus: `ready`,
        sourceError: false,
        outcomes: { left: [`fulfilled`], right: [`rejected`] },
        rejections: {
          right: [{ kind: `mapper`, message: `mapping-${h.coordinate}` }],
        },
        problems: [],
        rows: { left: ids },
        activeStreams: streams.left,
      },
      {
        name: `mapper-retried`,
        queryStatuses: { left: `ready`, right: `ready` },
        sourceStatus: `ready`,
        sourceError: false,
        outcomes: { left: [`fulfilled`], right: [`fulfilled`] },
        problems: [],
        rows: { left: ids, right: ids },
        activeStreams: [...streams.left, ...streams.right],
      },
      {
        name: `retry-retired`,
        queryStatuses: { left: `ready` },
        sourceStatus: `ready`,
        sourceError: false,
        outcomes: { left: [`fulfilled`], right: [`retired`] },
        problems: [],
        rows: { left: ids },
        activeStreams: streams.left,
      },
    ]
  }
  if (h.kind === `admission`)
    return [
      {
        name: `source-cleaned-up`,
        outcomes: {
          left: [h.cleanup === `during-mapping` ? `rejected` : `fulfilled`],
        },
        problems: [],
        providerState: `idle`,
        sourceStatus: `cleaned-up`,
        activeStreams: [],
      },
    ]
  if (h.kind === `settlement`) {
    if (h.timing === `before-sync`)
      return [
        {
          name: `failed-initial-load`,
          outcomes: { left: [`rejected`] },
          problems: [],
          rejectionMayOwnError: true,
          rejections,
        },
      ]
    const final: StreamExpectation = {
      name: `failed-visible-load`,
      outcomes: {
        left:
          h.timing === `after-application`
            ? [`fulfilled`]
            : [`fulfilled`, `rejected`],
      },
      problems: failed,
      rejectionMayOwnError: true,
      rejections,
      rows: { left: failedRows },
    }
    const prelude: Array<StreamExpectation> =
      h.timing === `before-application` && h.baseline === `confirmed-empty`
        ? [
            {
              name: `empty-baseline-confirmed`,
              outcomes: { right: [`fulfilled`] },
              rows: { right: [] },
              problems: [],
              sourceStatus: `ready`,
              sourceError: false,
              activeStreams: ownerStreams(h).right,
            },
            {
              name: `empty-baseline-retired`,
              outcomes: { right: [`retired`] },
              rows: { right: [] },
              problems: [],
              sourceStatus: `ready`,
              sourceError: false,
              activeStreams: [],
            },
          ]
        : []
    return h.timing === `before-application`
      ? [
          ...prelude,
          {
            name: `receipt-held`,
            outcomes: { left: [`pending`] },
            problems: [],
          },
          final,
        ]
      : [final]
  }
  const live = h.retire === `left` ? `right` : `left`
  const streams = ownerStreams(h)
  const retained = failed.filter((stream) => streams[live].includes(stream))
  const cuts: Array<StreamExpectation> = [
    {
      name: `loaded`,
      outcomes: { left: [`fulfilled`], right: [`fulfilled`] },
      problems: [],
      rows: { left: ids, right: ids },
      forwardedSubscriptions: h.parameterization
        ? [
            ...new Map(
              [
                ...ownerSubscriptions(h).left,
                ...ownerSubscriptions(h).right,
              ].map((stream) => [authoredStreamIdentity(stream), stream]),
            ).values(),
          ]
        : undefined,
    },
    {
      name: `failed`,
      outcomes: { left: [`fulfilled`], right: [`fulfilled`] },
      problems: failed,
      rows: { left: failedRows, right: failedRows },
    },
  ]
  if (h.changeError)
    cuts.push({
      name: `changed-error`,
      outcomes: { left: [`fulfilled`], right: [`fulfilled`] },
      problems: failed,
      rows: { left: failedRows, right: failedRows },
    })
  cuts.push({
    name: `owner-retired`,
    outcomes: { [h.retire]: [`retired`], [live]: [`fulfilled`] },
    problems: retained,
    rows: { [live]: failedRows },
    activeStreams: streams[live],
  })
  if (h.recover)
    cuts.push({
      name: `recovered`,
      outcomes: { [live]: [`fulfilled`] },
      problems: [],
      rows: { [live]: ids },
    })
  return cuts
}

// Ending the final demand ends provider work. This cut precedes the fixture's
// rescue of leaked SDK leases, so rescue cannot make resource leaks pass.
export function onDemandStreamsModel(
  h: OnDemandStreamsHistory,
): Array<StreamExpectation> {
  const cuts = expectedStreamCuts(h)
  return h.kind === `admission`
    ? cuts
    : [
        ...cuts,
        {
          name: `source-cleaned-up`,
          outcomes: {},
          problems: [],
          sourceStatus: `cleaned-up`,
          providerState: `idle`,
          activeStreams: [],
        },
      ]
}

export const onDemandStreamsStates = [
  `shared-error-retained`,
  `independent-error-retired`,
  `partial-overlap-retired`,
  `stream-error-before-sync`,
  `stream-error-before-application`,
  `confirmed-empty-baseline`,
  `stream-error-after-application`,
  `error-identity-changed`,
  `stream-recovered`,
  `mapping-cleanup`,
  `loaded-cleanup`,
  `parameter-equal-retained`,
  `parameter-distinct-retired`,
  `priority-requested`,
  `empty-mapping-applied`,
  `throwing-mapper-retried`,
  `request-pre-aborted`,
  `request-mapper-aborted`,
  `request-post-mapper-aborted`,
  `request-healthy`,
] as const
export type OnDemandStreamsState = (typeof onDemandStreamsStates)[number]

/** Random coordinates remain free while each construction supplies its premise. */
export function constructOnDemandStreamsHistory(
  h: OnDemandStreamsHistory,
  state: OnDemandStreamsState,
): OnDemandStreamsHistory {
  const coordinates = {
    coordinate: h.coordinate,
    rowCount: h.rowCount,
    value: h.value,
  }
  if (state.startsWith(`request-`))
    return {
      ...coordinates,
      kind: `request`,
      abort:
        state === `request-pre-aborted`
          ? `before-mapping`
          : state === `request-mapper-aborted`
            ? `during-mapping`
            : state === `request-post-mapper-aborted`
              ? `after-mapping`
              : `none`,
    }
  if (
    state === `priority-requested` ||
    state === `empty-mapping-applied` ||
    state === `throwing-mapper-retried`
  )
    return {
      ...coordinates,
      kind: `mapper`,
      operation:
        state === `priority-requested`
          ? `priority`
          : state === `empty-mapping-applied`
            ? `empty`
            : `throw`,
    }
  if (state === `mapping-cleanup` || state === `loaded-cleanup`)
    return {
      ...coordinates,
      kind: `admission`,
      cleanup:
        state === `mapping-cleanup` ? `during-mapping` : `after-application`,
    }
  if (
    state === `stream-error-before-application` ||
    state === `confirmed-empty-baseline`
  )
    return {
      ...coordinates,
      kind: `settlement`,
      timing: `before-application`,
      baseline: `confirmed-empty`,
    }
  if (
    state === `stream-error-before-sync` ||
    state === `stream-error-after-application`
  )
    return {
      ...coordinates,
      kind: `settlement`,
      timing:
        state === `stream-error-before-sync`
          ? `before-sync`
          : `after-application`,
    }
  const base = {
    ...coordinates,
    kind: `ownership` as const,
    overlap: `same` as const,
    failing: `all` as const,
    retire:
      h.kind === `ownership`
        ? h.retire
        : h.coordinate % 2
          ? (`left` as const)
          : (`right` as const),
    changeError: false,
    recover: false,
  }
  if (state === `parameter-equal-retained`)
    return { ...base, parameterization: `equal` }
  if (state === `parameter-distinct-retired`)
    return {
      ...base,
      overlap: `disjoint`,
      parameterization: `distinct`,
      failing: base.retire,
    }
  if (state === `independent-error-retired`)
    return { ...base, overlap: `disjoint`, failing: base.retire }
  if (state === `partial-overlap-retired`)
    return { ...base, overlap: `partial` }
  if (state === `error-identity-changed`)
    return { ...base, overlap: `disjoint`, changeError: true }
  if (state === `stream-recovered`)
    return { ...base, overlap: `disjoint`, recover: true, changeError: true }
  return base
}

/** Same judgment for generated histories, fixed regressions and receivers. */
export function onDemandStreamsViolations(
  expected: ReadonlyArray<StreamExpectation>,
  cuts: ReadonlyArray<StreamCut>,
): Array<string> {
  const violations: Array<string> = []
  for (const wanted of expected) {
    const cut = cuts.find((entry) => entry.name === wanted.name)
    if (!cut) {
      violations.push(`${wanted.name}: missing observation`)
      continue
    }
    for (const field of [
      `providerState`,
      `sourceStatus`,
      `sourceError`,
    ] as const)
      if (wanted[field] !== undefined && cut[field] !== wanted[field])
        violations.push(
          `${cut.name}: ${field} ${cut[field]} differs from ${wanted[field]}`,
        )
    if (
      wanted.activeStreams &&
      (cut.activeStreams === undefined ||
        JSON.stringify([...new Set(cut.activeStreams)].sort()) !==
          JSON.stringify([...new Set(wanted.activeStreams)].sort()))
    )
      violations.push(
        `${cut.name}: retained SDK stream inventory ${JSON.stringify(cut.activeStreams)} differs from ${JSON.stringify(wanted.activeStreams)}`,
      )
    if (
      wanted.forwardedSubscriptions &&
      JSON.stringify(
        cut.forwardedSubscriptions
          ?.map((stream) => JSON.stringify(stream))
          .sort(),
      ) !==
        JSON.stringify(
          wanted.forwardedSubscriptions
            .map((stream) => JSON.stringify(stream))
            .sort(),
        )
    )
      violations.push(
        `${cut.name}: forwarded stream name, parameters or priority differ`,
      )
    for (const field of [
      `admitted`,
      `aborted`,
      `subscriptionStatus`,
      `mapperCalls`,
      `acquisitions`,
    ] as const)
      if (
        wanted.request?.[field] !== undefined &&
        cut.request?.[field] !== wanted.request[field]
      )
        violations.push(
          `${cut.name}: request ${field} ${cut.request?.[field]} differs from ${wanted.request[field]}`,
        )
    for (const owner of [`left`, `right`] as const) {
      const status = wanted.queryStatuses?.[owner]
      if (status !== undefined && cut.queryStatuses?.[owner] !== status)
        violations.push(
          `${cut.name}: ${owner} current query status ${cut.queryStatuses?.[owner]} differs from ${status}`,
        )
      const outcomes = wanted.outcomes[owner]
      if (outcomes && !outcomes.includes(cut.outcomes[owner]!))
        violations.push(
          `${cut.name}: ${owner} outcome ${cut.outcomes[owner]} outside ${outcomes.join(`/`)}`,
        )
      const expectedRejections = wanted.rejections?.[owner]
      if (
        expectedRejections &&
        cut.outcomes[owner] === `rejected` &&
        !expectedRejections.some(
          (error) =>
            JSON.stringify(error) === JSON.stringify(cut.rejections?.[owner]),
        )
      )
        violations.push(
          `${cut.name}: ${owner} rejection lost its public category, identity coordinates or messages`,
        )
      const values = wanted.rowValues?.[owner]
      if (
        values &&
        cut.outcomes[owner] === `fulfilled` &&
        JSON.stringify(cut.rowValues?.[owner]) !== JSON.stringify(values)
      )
        violations.push(
          `${cut.name}: ${owner} cached row values differ from applied donor result`,
        )
      const ids = wanted.rows?.[owner]
      if (
        ids &&
        cut.outcomes[owner] === `fulfilled` &&
        JSON.stringify(cut.rows[owner]) !== JSON.stringify(ids)
      )
        violations.push(`${cut.name}: ${owner} visible rows differ`)
    }
    const rejected =
      wanted.rejectionMayOwnError && cut.outcomes.left === `rejected`
    // Rejection may own the stream failure instead of reporting it twice.
    // It cannot hide an independent connection outage or unrelated cause.
    violations.push(
      ...streamHealthViolations(
        {
          streams: wanted.problems,
          connection:
            cut.name !== `source-cleaned-up` &&
            streamConnectionOutage(cut.connectionInputs),
          rejectionOwnsStreams: Boolean(rejected),
        },
        cut.problems,
      ).map((failure) => `${cut.name}: ${failure}`),
    )
  }
  if (cuts.length !== expected.length)
    violations.push(
      `unexpected observation count ${cuts.length}, expected ${expected.length}`,
    )
  return violations
}

/**
 * Request rejection and cleanup have different authority. A current rejected
 * stream exposes the service's StreamError. Cleanup aborts a demand before an
 * abandoned receipt settles, so its later result decides nothing for core.
 * This small projection records both boundaries without reproducing the
 * adapter's shared-receipt slot or its catch branches. Callback timing is a
 * receiving premise of standalone-client 0.1.1, established by actual SDK
 * callbacks after acquisition returns, including cached rejected streams.
 * A durable collaborator failure is independent of the already-rejected
 * request: it owns the source's crash, not that current request's first cause.
 * Separate lease-release histories retain a healthy peer and repeat one to
 * three status reentries. They observe actual wait settlement before teardown;
 * releasing a lease cannot normalize a pending wait out of the observation.
 * Successful-checkpoint cancellation separately retains its own receipt: an
 * SDK ready callback can abort before the loader's continuation captures that
 * receipt. The neighboring schedule aborts after capture. A persisted schedule
 * applies that receipt while an unrelated later receipt remains held, so the
 * source cannot substitute either no wait or the newest shared receipt.
 * Priority histories use real priority-zero partial checkpoint completion
 * beside a priority-three peer bucket. They cancel a direct request or pending
 * query before full synchronization. Accepted priority rows keep their applied
 * obligation. Empty partial delivery and an earlier peer receipt distinguish
 * the requirement from a blanket rule about every canceled acquisition.
 * Cancellation promises an AbortError after accepted rows apply, not the
 * original SDK error object. Its object identity remains diagnostic only.
 */
export const onDemandBoundarySchedules = [
  `fresh-rejection`,
  `cached-rejection`,
  `receipt-applied`,
  `receipt-cleanup`,
  `receipt-durable-failure`,
  `lease-release`,
  `lease-release-after-checkpoint`,
  `checkpoint-abort`,
  `receipt-abort`,
  `receipt-abort-later-batch`,
  `priority-request-abort`,
  `priority-query-abort`,
  `priority-empty-abort`,
  `priority-peer-receipt-abort`,
  `priority-cleanup-abort`,
] as const
export type OnDemandBoundaryHistory = {
  coordinate: number
  rowCount: number
  schedule: (typeof onDemandBoundarySchedules)[number]
  statusChanges: number
}
export const onDemandBoundaryHistoryArb = fc.record({
  coordinate: fc.integer({ min: 0, max: 10_000 }),
  rowCount: fc.integer({ min: 1, max: 3 }),
  schedule: fc.constantFrom(...onDemandBoundarySchedules),
  statusChanges: fc.integer({ min: 1, max: 3 }),
})
export type OnDemandBoundaryObservation = {
  browserErrors?: ReadonlyArray<string>
  callbackCount: number
  providerStreamError?: boolean
  providerMessages?: ReadonlyArray<string>
  callbacksDuringAcquire: number
  cachedFailureReused: boolean
  receiptPendingAtFailure: boolean
  rawPendingAtFailure: boolean
  coreAbortedAtFailure: boolean
  receiptOutcome: `absent` | `pending` | `fulfilled` | `rejected`
  rawOutcome: `pending` | `fulfilled` | `rejected`
  rawCause: `provider` | `receipt` | `other` | `absent`
  rawErrorName?: string
  receiptErrorName?: string
  coreCause: `provider` | `receipt` | `other` | `absent`
  coreAbortedAtRawSettlement: boolean
  coreOutcome: `pending` | `fulfilled` | `rejected`
  sourceStatus: string
  sourceFailures: number
  terminalCause: `durable` | `provider` | `other` | `absent`
  pendingWaitsAfterRelease?: number
  maximumPendingForOneLease?: number
  readyReentries?: number
  abortedWaitsAfterRelease?: number
  peerActive?: boolean
  sourceRows: ReadonlyArray<string>
  rowsAtRelease?: ReadonlyArray<string>
  rawPendingWhileReceiptHeld?: boolean
  requestAbortedWhileReceiptHeld?: boolean
  checkpointAbortDelivered?: boolean
  ownReceiptFulfilledAtLaterCut?: boolean
  laterReceiptPendingAtLaterCut?: boolean
  rawOutcomeAtLaterCut?: `pending` | `fulfilled` | `rejected`
  partialReceivedBeforeAbort?: boolean
  providerWaitPendingBeforeAbort?: boolean
  peerQueryStatus?: string
  targetQueryStatusBeforeAbort?: string
  targetQueryStatusAfterAbort?: string
  subscriptionStatusAtAbort?: string
  peerQueryStatusAtAbort?: string
  peerQueryRows?: ReadonlyArray<string>
  /** Diagnostic only: cancellation does not promise the SDK error object. */
  rawPreservedQueuedAbort?: boolean
  reached: Array<OnDemandBoundaryHistory[`schedule`]>
}
// The authored schedule, rather than provider/cache implementation state,
// chooses whether the demand is still current at its settlement checkpoint.
export function onDemandBoundaryModel(h: OnDemandBoundaryHistory) {
  const receipt =
    h.schedule.startsWith(`receipt-`) ||
    h.schedule === `checkpoint-abort` ||
    h.schedule.startsWith(`priority-`)
  const cleanup = h.schedule === `receipt-cleanup`
  const durable = h.schedule === `receipt-durable-failure`
  return {
    receipt,
    cleanup,
    durable,
    receiptOutcome: receipt
      ? cleanup || durable
        ? `rejected`
        : `fulfilled`
      : `absent`,
    sourceStatus: cleanup ? `cleaned-up` : durable ? `crashed` : `ready`,
  } as const
}
export function onDemandBoundaryViolations(
  h: OnDemandBoundaryHistory,
  raw: OnDemandBoundaryObservation,
) {
  const expected = onDemandBoundaryModel(h)
  const failures = [...(raw.browserErrors ?? [])]
  if (h.schedule.startsWith(`priority-`)) {
    const ownRows =
      h.schedule === `priority-request-abort` ||
      h.schedule === `priority-query-abort` ||
      h.schedule === `priority-cleanup-abort`
    const cleanup = h.schedule === `priority-cleanup-abort`
    const heldRows = ownRows || h.schedule === `priority-peer-receipt-abort`
    if (!raw.partialReceivedBeforeAbort || !raw.providerWaitPendingBeforeAbort)
      failures.push(
        `partial priority delivery did not precede cancellation and full synchronization`,
      )
    if (
      raw.receiptPendingAtFailure !== heldRows ||
      (!raw.requestAbortedWhileReceiptHeld && heldRows)
    )
      failures.push(
        `priority cancellation did not reach the declared accepted-row cut`,
      )
    if (ownRows && !raw.rawPendingWhileReceiptHeld)
      failures.push(
        `raw aborted priority load settled before its accepted rows applied`,
      )
    if (
      raw.rawOutcome !== `rejected` ||
      raw.rawErrorName !== `AbortError` ||
      !raw.coreAbortedAtRawSettlement
    )
      failures.push(`priority cancellation lost the source abort outcome`)
    if (
      raw.subscriptionStatusAtAbort !== `ready` ||
      raw.peerQueryStatusAtAbort !== `ready`
    )
      failures.push(
        `aborted priority work still held core readiness or its peer`,
      )
    if (
      raw.peerQueryStatus !== (cleanup ? `cleaned-up` : `ready`) ||
      raw.sourceStatus !== (cleanup ? `cleaned-up` : `ready`) ||
      raw.sourceFailures
    )
      failures.push(
        `priority cancellation retired the source or its ready peer`,
      )
    if (raw.receiptOutcome !== (cleanup ? `rejected` : `fulfilled`))
      failures.push(`priority row receipt did not reach its authored outcome`)
    if (
      h.schedule === `priority-query-abort` &&
      (raw.targetQueryStatusBeforeAbort !== `loading` ||
        raw.targetQueryStatusAfterAbort !== `cleaned-up`)
    )
      failures.push(
        `pending query retirement did not cancel its source acquisition`,
      )
    const rows =
      heldRows && !cleanup
        ? Array.from({ length: h.rowCount }, (_value, index) => `row-${index}`)
        : []
    if (JSON.stringify(raw.sourceRows) !== JSON.stringify(rows))
      failures.push(`priority cancellation withdrew accepted table rows`)
    const peerRows = h.schedule === `priority-peer-receipt-abort` ? rows : []
    if (
      !cleanup &&
      JSON.stringify(raw.peerQueryRows) !== JSON.stringify(peerRows)
    )
      failures.push(
        `ready peer did not publish its accepted rows after priority cancellation`,
      )
    return failures
  }
  if (
    h.schedule === `checkpoint-abort` ||
    h.schedule === `receipt-abort` ||
    h.schedule === `receipt-abort-later-batch`
  ) {
    if (!raw.receiptPendingAtFailure || !raw.requestAbortedWhileReceiptHeld)
      failures.push(`cancellation did not overlap accepted source rows`)
    if (h.schedule === `checkpoint-abort` && !raw.checkpointAbortDelivered)
      failures.push(
        `application checkpoint listener did not cancel the request`,
      )
    if (
      h.schedule !== `receipt-abort-later-batch` &&
      !raw.rawPendingWhileReceiptHeld
    )
      failures.push(
        `raw aborted source load settled before its accepted rows applied`,
      )
    if (
      h.schedule === `receipt-abort-later-batch` &&
      (!raw.ownReceiptFulfilledAtLaterCut ||
        !raw.laterReceiptPendingAtLaterCut ||
        raw.rawOutcomeAtLaterCut !== `rejected`)
    )
      failures.push(
        `an unrelated later receipt delayed the canceled source load`,
      )
    if (
      raw.rawOutcome !== `rejected` ||
      raw.rawErrorName !== `AbortError` ||
      !raw.coreAbortedAtRawSettlement
    )
      failures.push(`aborted source load lost its cancellation outcome`)
    if (
      raw.receiptOutcome !== `fulfilled` ||
      raw.sourceStatus !== `ready` ||
      raw.sourceFailures
    )
      failures.push(`aborting a request withdrew an accepted sync obligation`)
    if (
      JSON.stringify(raw.sourceRows) !==
      JSON.stringify(
        [
          ...Array.from(
            { length: h.rowCount },
            (_value, index) => `row-${index}`,
          ),
          ...(h.schedule === `receipt-abort-later-batch`
            ? [`later-${h.coordinate}`]
            : []),
        ].sort(),
      )
    )
      failures.push(`accepted source rows did not survive request cancellation`)
    return failures
  }
  if (!raw.callbackCount || raw.callbacksDuringAcquire)
    failures.push(`SDK rejection callback did not follow acquisition return`)
  if (
    !raw.providerStreamError ||
    JSON.stringify(raw.providerMessages) !==
      JSON.stringify([`rejected-${h.coordinate}`])
  )
    failures.push(`SDK did not deliver the authored stream rejection`)
  if (h.schedule.startsWith(`lease-release`)) {
    if (raw.readyReentries !== h.statusChanges)
      failures.push(
        `application status changes did not reach every requested reentry`,
      )
    if (raw.pendingWaitsAfterRelease !== 0)
      failures.push(`released acquisition retained an unsettled SDK wait`)
    if (!(raw.maximumPendingForOneLease && raw.maximumPendingForOneLease > 0))
      failures.push(`status reentry never established a pending SDK wait`)
    if (!raw.peerActive || raw.sourceStatus !== `ready`)
      failures.push(`one acquisition release retired its healthy peer`)
    if (
      raw.rowsAtRelease?.length ||
      JSON.stringify(raw.sourceRows) !==
        JSON.stringify([`peer-${h.coordinate}`])
    )
      failures.push(`healthy peer did not retain subsequent table delivery`)
    return failures
  }
  if (h.schedule === `cached-rejection` && !raw.cachedFailureReused)
    failures.push(`cached failed stream did not retain the same provider error`)
  if (raw.receiptPendingAtFailure !== expected.receipt)
    failures.push(`request failure did not overlap the declared receipt`)
  if (raw.coreAbortedAtFailure)
    failures.push(`request was already obsolete when the service rejected it`)
  if (raw.receiptOutcome !== expected.receiptOutcome)
    failures.push(`actual receipt outcome differs from authored schedule`)
  if (
    raw.rawOutcome !== `rejected` ||
    (!expected.cleanup && raw.rawCause !== `provider`)
  )
    failures.push(`raw source rejection lost its boundary cause`)
  // Failure may settle before the later cleanup. A rejected acquisition owes
  // no result, so the model must not force it to wait for an unrelated receipt.
  const failedBeforeCleanup =
    expected.cleanup &&
    !raw.coreAbortedAtRawSettlement &&
    raw.rawCause === `provider` &&
    raw.coreCause === `provider`
  if (
    raw.coreAbortedAtRawSettlement !== expected.cleanup &&
    !failedBeforeCleanup
  )
    failures.push(`request currency differs at raw source settlement`)
  if (
    expected.cleanup &&
    !failedBeforeCleanup &&
    raw.rawErrorName !== `AbortError`
  )
    failures.push(`cleanup abandonment did not reject with AbortError`)
  if (!expected.cleanup && raw.coreOutcome !== `rejected`)
    failures.push(`current request did not expose its stream rejection`)
  if (!expected.cleanup && raw.coreCause !== `provider`)
    failures.push(`current request changed the provider failure cause`)
  if (
    raw.sourceStatus !== expected.sourceStatus ||
    raw.sourceFailures !== (expected.durable ? 1 : 0)
  )
    failures.push(
      `request rejection changed source lifecycle or terminal health`,
    )
  if (raw.terminalCause !== (expected.durable ? `durable` : `absent`))
    failures.push(`terminal source failure lost its own cause`)
  const expectedRows =
    h.schedule === `receipt-applied`
      ? Array.from({ length: h.rowCount }, (_value, index) => `row-${index}`)
      : []
  // A crash says this Collection cannot serve reads. Keep its retained rows
  // diagnostic; this error-provenance law adds no post-crash read contract.
  if (
    !expected.durable &&
    JSON.stringify(raw.sourceRows) !== JSON.stringify(expectedRows)
  )
    failures.push(`source rows differ at the request settlement boundary`)
  return failures
}
