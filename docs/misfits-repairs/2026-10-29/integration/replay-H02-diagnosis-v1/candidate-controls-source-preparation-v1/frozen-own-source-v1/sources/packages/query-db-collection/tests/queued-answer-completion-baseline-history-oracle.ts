import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { completionFacts } from './queued-answer-completion-history-oracle.js'
import type { CompletionParameters } from './queued-answer-completion-history-oracle.js'
import type {
  CompletionAction,
  CompletionBaselineObservation,
  CompletionFacts,
  CompletionOverlay,
  CompletionSetup,
  CompletionTarget,
} from './queued-answer-completion-oracle.js'

/**
 * Existing public laws have baseline constituent witnesses independent of the
 * proposed continuation mechanism. These recipes author their facts, output
 * targets, optimistic fixture values, operation dependencies and errors before
 * the ordinary driver runs. No recipe asks for a candidate task, incarnation,
 * attachment set or cooperative D2 stop. No baseline count fills the raw20
 * candidate inventory, and no source recipe is an executed witness.
 *
 * The driver supplies real QueryDB writes, actual output receipts, public
 * operations, callback errors and cleanup. It must retain first failures and
 * refuse missing physical bindings. The common completion model and baseline
 * comparison own every expected value. Controls supply premises only.
 */
export type CompletionBaselineGate =
  | `establish`
  | `park-root`
  | `park-facade`
  | `facade-rollback`
  | `held-window`
  | `source-failed-peer`
  | `subscriber-tail`
  | `initial-status-tail`
  | `graph-failure`
  | `cleanup-abandonment`
export type CompletionBaselineControl =
  | `bind-output-holds`
  | `begin-replay`
  | `hold-demand-sources`
  | `arm-facade-B-commit-fault`
  | `retry-publication`
  | `arm-subscriber-tail`
  | `prepare-held-initial`
  | `arm-initial-status-tail`
  | `throw-current-graph`
  | `establish-replacement`
export type CompletionBaselineStep =
  | { kind: `semantic`; action: CompletionAction }
  | { kind: `control`; control: CompletionBaselineControl }
  | {
      kind: `baseline-observe`
      boundary: CompletionBaselineObservation[`boundary`]
    }
export type CompletionBaselineProgram = {
  gate: CompletionBaselineGate
  parameters: CompletionParameters
  setup: CompletionSetup
  changedFacts: CompletionFacts
  selectedKeys: {
    root: number
    facadeA: number
    facadeB: number
    pivot: number
    optimisticChild: number
  }
  target: CompletionTarget
  overlay: CompletionOverlay
  errors: { source: string; tail: string; graph: string; facadeB: string }
  answerScopes: {
    failure: { source: `marked`; scope: Array<number> }
    peer: { source: `children`; scope: Array<number> }
  }
  steps: Array<CompletionBaselineStep>
}
const semantic = (action: CompletionAction): CompletionBaselineStep => ({
  kind: `semantic`,
  action,
})
const control = (value: CompletionBaselineControl): CompletionBaselineStep => ({
  kind: `control`,
  control: value,
})
const observe = (
  boundary: CompletionBaselineObservation[`boundary`],
): CompletionBaselineStep => ({ kind: `baseline-observe`, boundary })
const require = (id: string, kind: `source` | `output` | `publication`) =>
  semantic({ type: `require`, requirement: { id, kind } })

/**
 * Root holds change one present rank within its existing order interval.
 * Facade holds insert one explicitly authored child key, then remove it when
 * the optimistic transaction settles. A raw facade insertion supplies that
 * authored key as `$key`; this mapping is fixture input, not an inference of
 * production's generated key encoding. Facade root overlays preserve the actual
 * child Collection handle; the model reads its evolving child rows separately.
 */
export function constructCompletionBaselineProgram(
  parameters: CompletionParameters,
  profile: CompletionSetup[`profile`],
  gate: CompletionBaselineGate,
): CompletionBaselineProgram {
  if (
    profile === `inline` &&
    (gate === `park-facade` || gate === `facade-rollback`)
  )
    throw new Error(`completion grammar: ${gate} requires a Collection facade`)
  const { prior, answered } = completionFacts(parameters, true)
  const root = prior.roots[0]!
  const facadeB = prior.roots[1]!.id
  const target: CompletionTarget =
    gate === `park-root` || profile === `inline` ? `root` : { bucket: root.id }
  const child = root.id * 100 + 99
  const overlay: CompletionOverlay =
    target === `root`
      ? {
          id: `baseline-hold`,
          kind: `root`,
          row: {
            ...root,
            rank: root.rank - parameters.rankScale / 100,
            children: prior.children
              .filter((row) => row.parent === root.id)
              .map((row) => row.id),
          },
        }
      : {
          id: `baseline-hold`,
          kind: `facade`,
          bucket: root.id,
          rows: [
            ...prior.children
              .filter((row) => row.parent === root.id)
              .map((row) => row.id),
            child,
          ],
        }
  const errors = {
    source: `baseline-source`,
    tail: `baseline-tail`,
    graph: `baseline-graph`,
    facadeB: `baseline-facade-B`,
  }
  const setup: CompletionSetup = {
    run: `run-1`,
    profile,
    facts: prior,
    window: { offset: 0, limit: 2 },
    ready: gate !== `initial-status-tail`,
  }
  const changedFacts: CompletionFacts =
    gate === `park-root` ||
    gate === `subscriber-tail` ||
    (gate === `cleanup-abandonment` && target === `root`)
      ? { ...prior, roots: answered.roots }
      : {
          ...prior,
          children:
            gate === `facade-rollback`
              ? answered.children
              : [...prior.children, { id: root.id * 100 + 3, parent: root.id }],
        }
  const steps: Array<CompletionBaselineStep> = []
  const installAll = (): Array<CompletionBaselineStep> => [
    ...(profile === `facade`
      ? prior.roots.map((row) =>
          semantic({
            type: `install`,
            target: { bucket: row.id },
            snapshot: `desired`,
          }),
        )
      : []),
    semantic({ type: `install`, target: `root`, snapshot: `desired` }),
  ]
  const park = (
    name: string,
    outputTarget: CompletionTarget = target,
    snapshot: `desired` | `restore` = `desired`,
  ) => [
    require(name, `output`),
    semantic({
      type: `stage-output`,
      requirement: name,
      target: outputTarget,
      snapshot,
      disposition: `retained`,
    }),
  ]
  switch (gate) {
    case `establish`:
      break
    case `park-root`:
    case `park-facade`:
    case `cleanup-abandonment`:
      steps.push(
        semantic({ type: `optimistic-overlay`, overlay }),
        control(`bind-output-holds`),
        semantic({ type: `source-write`, facts: changedFacts }),
        ...park(`selected`),
        observe(`held-output`),
      )
      if (gate === `cleanup-abandonment`)
        steps.push(
          semantic({ type: `cleanup` }),
          semantic({ type: `restart`, run: `run-2`, facts: changedFacts }),
          observe(`cleanup-abandoned`),
          control(`establish-replacement`),
          ...installAll(),
          semantic({ type: `mark-ready` }),
          observe(`public-state`),
        )
      else
        steps.push(
          semantic({ type: `settle-optimistic`, overlay: overlay.id }),
          semantic({ type: `apply-output`, requirement: `selected` }),
          observe(`public-state`),
        )
      break
    case `facade-rollback`:
      steps.push(
        require(`error-tail`, `publication`),
        semantic({ type: `optimistic-overlay`, overlay }),
        control(`bind-output-holds`),
        control(`arm-facade-B-commit-fault`),
        semantic({ type: `source-write`, facts: changedFacts }),
        ...park(`A-forward`, { bucket: root.id }),
        ...park(`A-restore`, { bucket: root.id }, `restore`),
        semantic({
          type: `tail-failure`,
          requirement: `error-tail`,
          error: errors.facadeB,
          affected: [],
        }),
        observe(`facade-rollback`),
        semantic({ type: `settle-optimistic`, overlay: overlay.id }),
        semantic({ type: `apply-output`, requirement: `A-forward` }),
        semantic({ type: `apply-output`, requirement: `A-restore` }),
        observe(`public-state`),
        control(`retry-publication`),
        ...installAll(),
        observe(`public-state`),
      )
      break
    case `held-window`:
    case `source-failed-peer`:
      steps.push(
        require(`answer`, `source`),
        ...(gate === `source-failed-peer` ? [require(`peer`, `source`)] : []),
        control(
          gate === `source-failed-peer`
            ? `hold-demand-sources`
            : `begin-replay`,
        ),
        semantic({
          type: `request-window`,
          operation: `window`,
          options: { limit: 3 },
          requires:
            gate === `source-failed-peer` ? [`answer`, `peer`] : [`answer`],
        }),
        observe(`held-window`),
      )
      if (gate === `source-failed-peer`)
        steps.push(
          semantic({
            type: `source-failure`,
            requirement: `answer`,
            error: errors.source,
          }),
          observe(`source-failed-peer`),
          semantic({
            type: `source-answer`,
            requirement: `peer`,
            facts: answered,
          }),
          observe(`public-state`),
        )
      else
        steps.push(
          semantic({
            type: `source-answer`,
            requirement: `answer`,
            facts: answered,
          }),
          ...installAll(),
          observe(`completed-window`),
        )
      break
    case `subscriber-tail`:
      steps.push(
        require(`error-tail`, `publication`),
        control(`arm-subscriber-tail`),
        semantic({ type: `source-write`, facts: changedFacts }),
        ...installAll(),
        semantic({
          type: `tail-failure`,
          requirement: `error-tail`,
          error: errors.tail,
          affected: [],
        }),
        observe(`installed-tail-exception`),
      )
      break
    case `initial-status-tail`:
      steps.push(
        require(`answer`, `source`),
        require(`error-tail`, `publication`),
        control(`prepare-held-initial`),
        control(`arm-initial-status-tail`),
        semantic({
          type: `request-initial`,
          operation: `initial`,
          requires: [`answer`],
        }),
        semantic({
          type: `source-answer`,
          requirement: `answer`,
          facts: answered,
        }),
        ...installAll(),
        semantic({ type: `mark-ready` }),
        semantic({
          type: `tail-failure`,
          requirement: `error-tail`,
          error: errors.tail,
          affected: [],
        }),
        observe(`installed-tail-exception`),
      )
      break
    case `graph-failure`:
      steps.push(
        require(`peer`, `source`),
        control(`hold-demand-sources`),
        semantic({
          type: `request-window`,
          operation: `window`,
          options: { limit: 3 },
          requires: [`peer`],
        }),
        control(`throw-current-graph`),
        semantic({ type: `graph-failure`, error: errors.graph }),
        observe(`graph-exception`),
      )
      break
  }
  return {
    gate,
    parameters,
    setup,
    changedFacts,
    target,
    overlay,
    selectedKeys: {
      root: root.id,
      facadeA: root.id,
      facadeB,
      pivot: parameters.keyShift + 3,
      optimisticChild: child,
    },
    answerScopes: {
      failure: { source: `marked`, scope: [parameters.keyShift + 3] },
      peer: { source: `children`, scope: [parameters.keyShift + 3] },
    },
    errors,
    steps,
  }
}

export const completionBaselineGates: ReadonlyArray<CompletionBaselineGate> = [
  `establish`,
  `park-root`,
  `park-facade`,
  `facade-rollback`,
  `held-window`,
  `source-failed-peer`,
  `subscriber-tail`,
  `initial-status-tail`,
  `graph-failure`,
  `cleanup-abandonment`,
]
export function completionBaselineProgramFamily(
  parameters: CompletionParameters,
): Array<CompletionBaselineProgram> {
  return ([`inline`, `facade`] as const).flatMap((profile) =>
    completionBaselineGates
      .filter(
        (gate) =>
          profile === `facade` ||
          (gate !== `park-facade` && gate !== `facade-rollback`),
      )
      .map((gate) =>
        constructCompletionBaselineProgram(parameters, profile, gate),
      ),
  )
}

declareOracle({
  grammar: [
    constructCompletionBaselineProgram,
    completionBaselineProgramFamily,
  ],
})
