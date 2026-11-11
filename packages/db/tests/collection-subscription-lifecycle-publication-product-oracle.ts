/**
 * The row-publication product grammar, shared by the row-publication oracle
 * and its ordinary grammar-size test: the publication command types and the
 * finite product of publication phase, source effect, settlement, suffix, and
 * prior independent row. The law and its comparison live in
 * collection-subscription-lifecycle-publication-oracle.property.test.ts.
 * These definitions moved here unchanged so that the ordinary test can check
 * the product's size without importing the oracle test file.
 */
import type { LifecycleCommand } from './collection-subscription-lifecycle-grammar-oracle.js'
import type {
  PublicationPhase,
  Row,
  RowKey,
} from './collection-subscription-lifecycle-publication-support'

export type SourceMutation = {
  type: `source`
  key: RowKey
  action: `upsert` | `delete`
  value: number
  // Upsert the visible row's zero with the other sign; a key whose visible
  // value is not a zero upserts `value`.
  flip?: boolean
}

export type PublicationCommand =
  | Exclude<LifecycleCommand, { type: `truncate` | `settle` }>
  | (Extract<LifecycleCommand, { type: `settle` }> & { value?: number })
  | { type: `truncate`; replacement?: Row }
  | SourceMutation

export type SourceEffect = `insert` | `update` | `delete`

type ProductSettlement = `none` | `resolve` | `reject`

type ProductSuffix = `release` | `cleanup` | `restart` | `unsubscribe`

type PriorIndependentRow = `absent` | `present`

export type PublicationProductCase = {
  name: string
  phase: PublicationPhase
  sourceEffect: SourceEffect
  settlement: ProductSettlement
  suffix: ProductSuffix
  priorIndependentRow: PriorIndependentRow
  history: Array<PublicationCommand>
  focalSourceIndex: number
  settlementIndex?: number
  pendingProbeIndex: number
  suffixIndex: number
  postUnsubscribeProbeIndex: number
}

const settleCurrent = (
  demand: DemandName,
  outcome: `resolve` | `reject`,
): LifecycleCommand => ({
  type: `settle`,
  demand,
  scope: `current`,
  age: `oldest`,
  outcome,
})

function createPublicationProductCase(
  phase: PublicationPhase,
  sourceEffect: SourceEffect,
  settlement: ProductSettlement,
  suffix: ProductSuffix,
  priorIndependentRow: PriorIndependentRow,
): PublicationProductCase {
  const history: Array<PublicationCommand> = []
  const push = (command: PublicationCommand): number =>
    history.push(command) - 1
  const hasPeer = phase === `private-settling` || phase === `private-failed`

  if (priorIndependentRow === `present`) {
    push({ type: `source`, key: `d`, action: `upsert`, value: 30 })
  }
  push({ type: `request`, demand: `a` })
  if (hasPeer) push({ type: `request`, demand: `b` })
  if (phase !== `public`) {
    push(settleCurrent(`a`, `resolve`))
    if (hasPeer) push(settleCurrent(`b`, `resolve`))
    push({ type: `truncate` })
    if (phase === `private-settling`) {
      push(settleCurrent(`b`, `resolve`))
    } else if (phase === `private-failed`) {
      push(settleCurrent(`b`, `reject`))
    }
  }

  if (sourceEffect !== `insert`) {
    push({ type: `source`, key: `c`, action: `upsert`, value: 40 })
  }
  const focalSourceIndex = push({
    type: `source`,
    key: `c`,
    action: sourceEffect === `delete` ? `delete` : `upsert`,
    value: 41,
  })
  const settlementIndex =
    settlement === `none` ? undefined : push(settleCurrent(`a`, settlement))
  const pendingProbeIndex = history.length

  let suffixIndex: number
  if (suffix === `release`) {
    suffixIndex = push({ type: `release`, demand: `a` })
    if (hasPeer) suffixIndex = push({ type: `release`, demand: `b` })
    push({ type: `unsubscribe` })
  } else if (suffix === `cleanup`) {
    suffixIndex = push({ type: `cleanup` })
    push({ type: `unsubscribe` })
  } else if (suffix === `restart`) {
    push({ type: `cleanup` })
    suffixIndex = push({ type: `restart` })
    push({ type: `unsubscribe` })
  } else {
    suffixIndex = push({ type: `unsubscribe` })
  }
  if (suffix === `cleanup`) push({ type: `restart` })
  const postUnsubscribeProbeIndex = push({
    type: `source`,
    key: `d`,
    action: `upsert`,
    value: 99,
  })

  return {
    name: `${phase}:${sourceEffect}:${settlement}:${suffix}:prior-${priorIndependentRow}`,
    phase,
    sourceEffect,
    settlement,
    suffix,
    priorIndependentRow,
    history,
    focalSourceIndex,
    ...(settlementIndex === undefined ? {} : { settlementIndex }),
    pendingProbeIndex,
    suffixIndex,
    postUnsubscribeProbeIndex,
  }
}

const publicationPhases = [
  `public`,
  `private-pending`,
  `private-settling`,
  `private-failed`,
] as const

const sourceEffects = [`insert`, `update`, `delete`] as const

const productSettlements = [`none`, `resolve`, `reject`] as const

const productSuffixes = [
  `release`,
  `cleanup`,
  `restart`,
  `unsubscribe`,
] as const

const priorIndependentRows = [`absent`, `present`] as const

export const publicationProductCases = publicationPhases.flatMap((phase) =>
  sourceEffects.flatMap((sourceEffect) =>
    productSettlements.flatMap((settlement) =>
      productSuffixes.flatMap((suffix) =>
        priorIndependentRows.map((priorIndependentRow) =>
          createPublicationProductCase(
            phase,
            sourceEffect,
            settlement,
            suffix,
            priorIndependentRow,
          ),
        ),
      ),
    ),
  ),
)

export const successfulReplacementCases = publicationProductCases.filter(
  ({ phase, sourceEffect, settlement }) =>
    (phase === `private-pending` || phase === `private-settling`) &&
    sourceEffect !== `delete` &&
    settlement === `resolve`,
)

export const replacementOrderingCases = publicationProductCases.filter(
  ({ phase, sourceEffect, settlement, suffix, priorIndependentRow }) =>
    (phase === `private-pending` || phase === `private-settling`) &&
    sourceEffect === `delete` &&
    settlement === `resolve` &&
    suffix !== `release` &&
    priorIndependentRow === `present`,
)

export const replacementRetirementCases = publicationProductCases.filter(
  (scenario) =>
    scenario.phase !== `public` &&
    scenario.suffix === `release` &&
    !successfulReplacementCases.includes(scenario) &&
    !replacementOrderingCases.includes(scenario),
)

export const publicationControlCases = publicationProductCases.filter(
  (scenario) =>
    !successfulReplacementCases.includes(scenario) &&
    !replacementOrderingCases.includes(scenario) &&
    !replacementRetirementCases.includes(scenario),
)

// Keep each semantic cell intact while giving the aggregate campaign several
// scheduler cuts. One 204-history test can exceed Vitest's per-test deadline
// when the full oracle portfolio runs concurrently, even though no history is
// slow or stuck.
export const publicationControlSlices = Array.from(
  { length: 4 },
  (_, index) => ({
    name: `${index * 51 + 1}-${(index + 1) * 51}`,
    scenarios: publicationControlCases.slice(index * 51, (index + 1) * 51),
  }),
)
