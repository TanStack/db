import { isDeepStrictEqual } from 'node:util'
import fc from 'fast-check'
import { declareOracle } from '../../db/tests/oracle-declaration.js'
import {
  attributeMetadataRows,
  checkAttributedRows,
  checkMetadataPublications,
} from '../../db/tests/query/virtual-row-fields-publication-oracle.js'
import {
  modelProgressValue,
  projectProgressRows,
  queuedAnswerExample,
} from './queued-answer-progress-oracle.js'
import type {
  AttributionKey,
  MetadataBatch,
  MetadataResult,
} from '../../db/tests/query/virtual-row-fields-publication-oracle.js'
import type {
  ProgressReceipt,
  QueryProgressHistory,
} from './queued-answer-progress-oracle.js'

/**
 * This receiver enforces the existing virtual-row-fields attribution and
 * publication law through the real QueryClient reload path. It adds no model
 * rule. The H02 relational model supplies ordinary expected rows. The shared
 * metadata owner supplies output attribution and exact public change deltas.
 *
 * A default generated key is an opaque public identity. Its binding comes from
 * the complete Collection.entries() observation, never from virtual $key or a
 * compiler serializer. The authored-key lane independently predicts configured
 * keys. A custom key activates a different reduction path, so reaches stay
 * separate. Neither lane proves provider-row source attribution or optimistic
 * origin transitions. The finite replacement changes IDs: a real receiving
 * update.previousValue witness is added by an opt-in source follow-up after
 * actual reload settlement. This receives an output Collection update through
 * an established QueryClient graph, not a QueryClient-fetched marker update.
 * Output metadata stays stable: copying current metadata onto an otherwise
 * correct previous ordinary row is equivalent in this bounded profile.
 */
export type MetadataHistory = QueryProgressHistory & {
  metadataKeys: `default` | `authored`
}

// Reconstruct the accepted nonempty scope control and the actual conflicting
// cache path. Native execution needs a separate root-admitted recipe per cell.
export const metadataReceivingHistories: Array<MetadataHistory> = (
  [`scope`, `subscription`] as const
).flatMap((cacheIdentity) =>
  ([`default`, `authored`] as const).map((metadataKeys) => ({
    ...queuedAnswerExample,
    cacheIdentity,
    metadataKeys,
    nonemptyPrior: true,
  })),
)

/**
 * The later stage changes only one authored source rank. Positive quarters
 * preserve the selected pivot's relational position; zero supplies a no-op.
 * Four separate receiving lanes retain separate reach and replay coordinates.
 */
export const metadataReceivingPaths = metadataReceivingHistories.map(
  ({ cacheIdentity, metadataKeys }) => ({ cacheIdentity, metadataKeys }),
)
export const metadataFollowupHistories: Array<MetadataHistory> =
  metadataReceivingHistories.flatMap((history) =>
    ([2, 0] as const).map((metadataFollowupQuarter) => ({
      ...history,
      metadataFollowupQuarter,
    })),
  )
export const metadataFollowupArbitrary = fc.record({
  keyShift: fc.integer({ min: 0, max: 20 }),
  rankScale: fc.integer({ min: 1, max: 20 }),
  metadataFollowupQuarter: fc.constantFrom(1 as const, 2 as const, 3 as const),
})
export function metadataHistoryStates(history: MetadataHistory): Array<string> {
  return [
    ...metadataReceivingStates,
    ...(history.cacheIdentity === `subscription`
      ? [`conflicting-cache-premise`]
      : []),
    ...(history.metadataFollowupQuarter === undefined
      ? []
      : [
          `reload-baseline-compared`,
          `followup-started`,
          `source-applied`,
          `followup-acquisitions-settled`,
          ...([`root`, `downstream`] as const).flatMap((layer) => [
            `followup-retained-key-${layer}`,
            `followup-messages-${layer}`,
            `followup-final-${layer}`,
            ...(history.metadataFollowupQuarter! > 0
              ? [`followup-update-${layer}`, `followup-previous-value-${layer}`]
              : [`followup-noop-${layer}`]),
          ]),
        ]),
  ]
}

export const metadataReceivingStates = [
  `initial-root`,
  `initial-downstream`,
  `nonempty-prior`,
  `reload-started`,
  `positive-held-provider-read`,
  `held-root`,
  `held-downstream`,
  `completed-enqueue`,
  `answer-executed`,
  `callback-root`,
  `callback-downstream`,
  `selected-upstream-metadata`,
  `messages-root`,
  `messages-downstream`,
  `final-root`,
  `final-downstream`,
  `worker-cleaned`,
] as const

type Layer = `root` | `downstream`
type Entries = ReadonlyArray<readonly [AttributionKey, object]>
type Identities = { sourceId: string; rootId: string; downstreamId: string }

function requireRows(value: unknown): Array<object> {
  if (
    !Array.isArray(value) ||
    value.some((row) => typeof row !== `object` || row === null)
  )
    throw new Error(`metadata snapshot is not an object row list`)
  return value
}

function requireEntries(value: unknown): Entries {
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        ![`string`, `number`].includes(typeof entry[0]) ||
        typeof entry[1] !== `object` ||
        entry[1] === null,
    )
  )
    throw new Error(`metadata public entries are invalid`)
  return value as Entries
}

// Bind keys only after independently checking every ordinary occurrence. This
// leaves generated encoding free while detecting missing/duplicate identities.
function bindPublicKeys(
  entries: Entries,
  payload: ReturnType<typeof modelProgressValue>,
): Map<AttributionKey, AttributionKey> {
  const observed = projectProgressRows(entries.map(([, row]) => row))
  if (!isDeepStrictEqual(observed, payload))
    throw new Error(`public entries disagree with independent ordered payload`)
  const keys = new Map<AttributionKey, AttributionKey>()
  const identities = new Set<AttributionKey>()
  for (let index = 0; index < entries.length; index++) {
    const key = entries[index]![0]
    const id = payload[index]!.id
    if (keys.has(id) || identities.has(key))
      throw new Error(`public entries repeat a row or key`)
    keys.set(id, key)
    identities.add(key)
  }
  return keys
}

/**
 * The driver records rows, entries and complete messages synchronously inside
 * callbacks. The checker judges each snapshot at one permitted complete cut,
 * then checks the accumulated delta with the existing publication comparison.
 * No per-field mixture of prior/final can pass. Callback order between layers
 * is free. Initial entry bindings retain prior-row identities for deletion.
 */
export function createMetadataReceiptCheck(
  history: MetadataHistory,
  reach: (state: string) => void = () => {},
) {
  let identities: Identities | undefined
  let reloading = false
  let priorPayload = modelProgressValue(history, false)
  let finalPayload = modelProgressValue(history, true)
  let reloadSettled = false
  let baselineCompared = false
  let following = false
  let sourceAccepted = false
  let sourceApplied = false
  let followupSettled = false
  let baseline:
    | { root: Array<MetadataResult>; downstream: Array<MetadataResult> }
    | undefined
  const baselineBindings: Partial<
    Record<Layer, Map<AttributionKey, AttributionKey>>
  > = {}
  const followupAttempts = new Map<number, boolean>()
  const prior: Partial<Record<Layer, Array<MetadataResult>>> = {}
  const finalBatches: Record<Layer, Array<MetadataBatch>> = {
    root: [],
    downstream: [],
  }
  const finalPublished: Record<Layer, boolean> = {
    root: false,
    downstream: false,
  }
  const initialBindings: Partial<
    Record<Layer, Map<AttributionKey, AttributionKey>>
  > = {}

  const expectRows = (
    layer: Layer,
    rawRows: unknown,
    rawEntries: unknown,
    final: boolean,
    rawUpstreamEntries?: unknown,
  ): Array<MetadataResult> => {
    if (!identities) throw new Error(`metadata identities were not observed`)
    const payload = final ? finalPayload : priorPayload
    const rows = requireRows(rawRows)
    const entries = requireEntries(rawEntries)
    const binding = bindPublicKeys(entries, payload)
    const ownBinding = following
      ? baselineBindings[layer]
      : !final && initialBindings[layer]
        ? initialBindings[layer]
        : binding
    const rootBinding = following
      ? baselineBindings.root
      : layer === `root`
        ? ownBinding
        : !final || rawUpstreamEntries === undefined
          ? initialBindings.root
          : bindPublicKeys(requireEntries(rawUpstreamEntries), payload)
    const expectedKey = (target: Layer, id: AttributionKey) => {
      if (history.metadataKeys === `authored`) return `metadata-${target}-${id}`
      const key = (target === `root` ? rootBinding : ownBinding)?.get(id)
      if (key === undefined) throw new Error(`missing public row identity`)
      return key
    }
    const rootExpected = attributeMetadataRows(
      payload,
      `structured-projection`,
      new Set(),
      identities.sourceId,
      identities.rootId,
      (id) => expectedKey(`root`, id),
    )
    const ordinary =
      layer === `root`
        ? payload
        : payload.map((row, index) => ({
            ...row,
            observedKey: rootExpected[index]!.metadata.$key,
            observedCollectionId: rootExpected[index]!.metadata.$collectionId,
            observedOrigin: rootExpected[index]!.metadata.$origin,
            observedPending: rootExpected[index]!.metadata.$hasPendingWrites,
          }))
    const expected =
      layer === `root`
        ? rootExpected
        : attributeMetadataRows(
            ordinary,
            `structured-projection`,
            new Set(),
            identities.rootId,
            identities.downstreamId,
            (id) => expectedKey(`downstream`, id),
          )
    checkAttributedRows(rows, expected)
    checkAttributedRows(
      entries.map(([, row]) => row),
      expected,
    )
    for (const [id, key] of binding)
      if (!Object.is(key, expectedKey(layer, id)))
        throw new Error(
          `public entry key violates configured or retained identity`,
        )
    if (!final && !initialBindings[layer])
      initialBindings[layer] = new Map(binding)
    return expected
  }

  const observePair = (
    receipt: ProgressReceipt,
    final: boolean,
    cut: string,
  ) => {
    const root = expectRows(`root`, receipt.rows, receipt.entries, final)
    const downstream = expectRows(
      `downstream`,
      receipt.downstream,
      receipt.downstreamEntries,
      final,
      receipt.entries,
    )
    reach(`${cut}-root`)
    reach(`${cut}-downstream`)
    return { root, downstream }
  }

  return (receipt: ProgressReceipt) => {
    if (receipt.phase === `reload-settled`) reloadSettled = true
    if (receipt.phase === `followup-start`) {
      if (
        !reloading ||
        !baselineCompared ||
        !baseline ||
        following ||
        history.metadataFollowupQuarter === undefined
      )
        throw new Error(
          `follow-up precedes the compared settled reload baseline`,
        )
      // Parent consumption is contiguous and ordered by the shared transport.
      // The child needs no acknowledgment. Failed baseline comparison cannot
      // reach this assignment or reset the first observation error.
      following = true
      priorPayload = finalPayload
      finalPayload = modelProgressValue(history, true, true)
      Object.assign(prior, baseline)
      for (const layer of [`root`, `downstream`] as const) {
        finalBatches[layer].length = 0
        finalPublished[layer] = false
      }
      reach(`followup-started`)
    }
    if (following && receipt.phase === `acquisition-accepted`) {
      if (
        typeof receipt.attempt !== `number` ||
        followupAttempts.has(receipt.attempt)
      )
        throw new Error(`follow-up acquisition identity is invalid`)
      followupAttempts.set(receipt.attempt, false)
    }
    if (receipt.phase === `followup-acquisition-settled`) {
      if (
        !following ||
        typeof receipt.attempt !== `number` ||
        followupAttempts.get(receipt.attempt) !== false ||
        receipt.outcome !== `fulfilled`
      )
        throw new Error(
          `follow-up acquisition did not reach applied settlement`,
        )
      followupAttempts.set(receipt.attempt, true)
    }
    if (receipt.phase === `followup-source-accepted`) {
      if (
        !following ||
        sourceAccepted ||
        typeof receipt.literalTrue !== `boolean`
      )
        throw new Error(`follow-up source acceptance is invalid`)
      sourceAccepted = true
    }
    if (receipt.phase === `followup-source-applied`) {
      if (!sourceAccepted || sourceApplied)
        throw new Error(`follow-up source receipt did not apply once`)
      sourceApplied = true
      reach(`source-applied`)
    }
    if (receipt.phase === `followup-settled`) {
      if (
        !following ||
        !sourceApplied ||
        followupSettled ||
        receipt.rootSubscriptionStatus !== `ready` ||
        receipt.downstreamSubscriptionStatus !== `ready` ||
        receipt.rootLoadingSubset !== false ||
        receipt.downstreamLoadingSubset !== false ||
        [...followupAttempts.values()].some((settled) => !settled) ||
        !isDeepStrictEqual(
          receipt.attempts,
          [...followupAttempts.keys()].map((attempt) => [attempt, `fulfilled`]),
        )
      )
        throw new Error(`follow-up output/acquisition cut is unsettled`)
      if (
        history.metadataFollowupQuarter! > 0 &&
        !(
          typeof receipt.rootCallbacks === `number` &&
          receipt.rootCallbacks > 0 &&
          typeof receipt.downstreamCallbacks === `number` &&
          receipt.downstreamCallbacks > 0
        )
      )
        throw new Error(`follow-up complete output callbacks did not reach`)
      followupSettled = true
      reach(`followup-acquisitions-settled`)
    }
    if (receipt.phase === `metadata-identities`) {
      const { sourceId, rootId, downstreamId } = receipt
      if (
        ![sourceId, rootId, downstreamId].every(
          (id) => typeof id === `string`,
        ) ||
        new Set([sourceId, rootId, downstreamId]).size !== 3 ||
        receipt.keyLane !== history.metadataKeys ||
        identities !== undefined
      )
        throw new Error(`metadata Collection identities are invalid`)
      identities = { sourceId, rootId, downstreamId } as Identities
    }
    if (receipt.phase === `initial-publication`) {
      Object.assign(prior, observePair(receipt, false, `initial`))
      if (priorPayload.length > 0) reach(`nonempty-prior`)
    }
    if (receipt.phase === `reload-start`) {
      if (!prior.root || !prior.downstream)
        throw new Error(`reload started before metadata baseline comparison`)
      reloading = true
      reach(`reload-started`)
    }
    if (
      receipt.phase === `retained-publication` &&
      receipt.reason === `provider-hold-before-release`
    ) {
      if (
        !reloading ||
        typeof receipt.pendingProviderAnswers !== `number` ||
        receipt.pendingProviderAnswers <= 0
      )
        throw new Error(`metadata held-provider premise did not reach`)
      observePair(receipt, false, `held`)
      reach(`positive-held-provider-read`)
    }
    if (
      receipt.phase === `retained-publication` &&
      receipt.reason !== `provider-hold-before-release`
    ) {
      expectRows(`root`, receipt.rows, receipt.entries, false)
    }
    if (receipt.phase === `answer-queued` && receipt.enqueueReturned === true)
      reach(`completed-enqueue`)
    if (receipt.phase === `answer-executed`) reach(`answer-executed`)
    if (
      reloading &&
      [`public-change`, `downstream-change`].includes(receipt.phase)
    ) {
      const layer = receipt.phase === `public-change` ? `root` : `downstream`
      const payload = projectProgressRows(receipt.rows)
      const final = isDeepStrictEqual(payload, finalPayload)
      if (
        !final &&
        (finalPublished[layer] || !isDeepStrictEqual(payload, priorPayload))
      )
        throw new Error(`metadata callback is partial or regresses from final`)
      const expected = expectRows(
        layer,
        receipt.rows,
        receipt.entries,
        final,
        layer === `downstream` ? receipt.upstreamEntries : undefined,
      )
      if (!Array.isArray(receipt.changes))
        throw new Error(`metadata callback messages are absent`)
      const batch: MetadataBatch = {
        rows: requireRows(receipt.rows),
        changes: receipt.changes as MetadataBatch[`changes`],
      }
      if (final) {
        finalPublished[layer] = true
        finalBatches[layer].push(batch)
        if (batch.changes.length > 0) {
          reach(`callback-${layer}`)
          if (layer === `downstream`) reach(`selected-upstream-metadata`)
        }
      } else checkMetadataPublications([batch], expected, expected)
    }
    if ([`final-publication`, `followup-publication`].includes(receipt.phase)) {
      const followupFinal = receipt.phase === `followup-publication`
      if (followupFinal !== following || (followupFinal && !followupSettled))
        throw new Error(`metadata final observation stage is invalid`)
      if (
        !followupFinal &&
        history.metadataFollowupQuarter !== undefined &&
        (!reloadSettled ||
          receipt.reloadSettled !== true ||
          receipt.rootSubscriptionStatus !== `ready` ||
          receipt.downstreamSubscriptionStatus !== `ready` ||
          receipt.rootLoadingSubset !== false ||
          receipt.downstreamLoadingSubset !== false)
      )
        throw new Error(`reload baseline did not reach settled outputs`)
      if (!reloading) throw new Error(`metadata final cut precedes reload`)
      const after = observePair(receipt, true, `final`)
      for (const layer of [`root`, `downstream`] as const) {
        checkMetadataPublications(
          finalBatches[layer],
          prior[layer]!,
          after[layer],
        )
        reach(`messages-${layer}`)
        if (followupFinal) {
          // The shared comparison above has required complete previous values,
          // exact message counts and callback reads. Only actual updates earn
          // update reach; delete+insert or a phase label cannot substitute.
          const changes = finalBatches[layer].flatMap((batch) => batch.changes)
          if (history.metadataFollowupQuarter! > 0) {
            if (
              changes.length !== 1 ||
              changes[0]!.type !== `update` ||
              changes[0]!.previousValue === undefined
            )
              throw new Error(`real same-key follow-up update did not reach`)
            reach(`followup-update-${layer}`)
            reach(`followup-previous-value-${layer}`)
          } else {
            if (changes.length)
              throw new Error(`no-op follow-up published a change`)
            reach(`followup-noop-${layer}`)
          }
          reach(`followup-retained-key-${layer}`)
          reach(`followup-messages-${layer}`)
          reach(`followup-final-${layer}`)
        }
      }
      if (!followupFinal) {
        baseline = after
        for (const layer of [`root`, `downstream`] as const)
          baselineBindings[layer] = new Map(
            after[layer].map((row) => [
              (row.ordinary as { id: AttributionKey }).id,
              row.metadata.$key as AttributionKey,
            ]),
          )
        baselineCompared = true
        if (history.metadataFollowupQuarter !== undefined)
          reach(`reload-baseline-compared`)
      }
    }
    if (receipt.phase === `cleanup-start`) reloading = false
    if (receipt.phase === `worker-cleaned`) reach(`worker-cleaned`)
  }
}

declareOracle({
  grammar: [
    metadataReceivingHistories,
    metadataFollowupHistories,
    metadataFollowupArbitrary,
  ],
  check: [createMetadataReceiptCheck],
})
