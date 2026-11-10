import { declareOracle } from '../../db/tests/oracle-declaration.js'
import { completionFacts } from './queued-answer-completion-history-oracle.js'
import {
  createCompletionModel,
  stepCompletionModel,
} from './queued-answer-completion-oracle.js'
import type { CompletionParameters } from './queued-answer-completion-history-oracle.js'
import type {
  CompletionAction,
  CompletionBaselineObservation,
  CompletionFacts,
  CompletionModel,
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
export type CompletionBaselinePublicationEpoch = {
  id: string
  kind: `initialization` | `publication` | `cleanup`
  fromStep: number
  throughStep: number
}
export type CompletionBaselineSourcePremise = {
  source: `roots` | `marked` | `children`
  requiredKeys: Array<number>
  permittedKeys: Array<number>
  knowledge: `rows` | `complete-domain`
  since: `fixture-start` | `answer-release`
}
export type CompletionBaselineProgram = {
  windowReceivingSchedule?: `failure-first` | `success`
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
  publicationEpochs: Array<CompletionBaselinePublicationEpoch>
  sourceAnswerPremises: Record<string, Array<CompletionBaselineSourcePremise>>
}

/**
 * Two receiving witnesses share the primary pagination law and finite facts.
 * Failure stops at the first handled-failure barrier: teardown, not a fictional
 * answer of a canceled peer, follows it. Later settlement/retry remain open on
 * this real-provider path. The success neighbor keeps the pivot eligible, so
 * its complete target needs the held child's actual answer.
 *
 * The original constituent recipes remain unchanged. These explicit successors
 * reuse their steps and independent publication model without adding a new
 * lifecycle model or changing any generated campaign budget.
 */
export function constructCompletionWindowReceivingProgram(
  parameters: CompletionParameters,
  schedule: `failure-first` | `success`,
): CompletionBaselineProgram {
  const program = constructCompletionBaselineProgram(
    parameters,
    `inline`,
    schedule === `failure-first` ? `source-failed-peer` : `held-window`,
  )
  if (schedule === `failure-first`) {
    const boundary = program.steps.findIndex(
      (step) =>
        step.kind === `baseline-observe` &&
        step.boundary === `source-failed-peer`,
    )
    program.steps = program.steps.slice(0, boundary + 1)
    program.sourceAnswerPremises = {}
  } else {
    program.setup.facts.marked = program.setup.facts.marked.filter(
      (id) => id !== program.selectedKeys.pivot,
    )
    program.steps = program.steps.map((step) => {
      if (step.kind === `control` && step.control === `begin-replay`)
        return control(`hold-demand-sources`)
      if (step.kind === `semantic` && step.action.type === `source-answer`)
        return semantic({
          ...step.action,
          facts: structuredClone(program.setup.facts),
        })
      return step
    })
    for (const premise of program.sourceAnswerPremises.answer ?? [])
      if (premise.source === `children`) premise.since = `answer-release`
  }
  program.windowReceivingSchedule = schedule
  program.publicationEpochs = authorCompletionBaselinePublicationEpochs(
    program.setup,
    program.steps,
  )
  return program
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
  // These keys author the information needed at the answer cut. They are not
  // inferred from actual loads or Query keys. Complete-domain knowledge includes
  // an empty marker/child answer; returned row membership alone cannot prove it.
  // Root rows instead require the authored value under the actual ordered load.
  const initialKeys = prior.roots
    .slice(0, setup.window.limit)
    .map(({ id }) => id)
  const pivot = parameters.keyShift + 3
  const pivotRank = prior.roots.find(({ id }) => id === pivot)!.rank
  const windowKeys = prior.roots
    .filter(({ id, rank }) => initialKeys.includes(id) || rank === pivotRank)
    .map(({ id }) => id)
  const sourceAnswerPremises: CompletionBaselineProgram[`sourceAnswerPremises`] =
    gate === `initial-status-tail`
      ? {
          answer: [
            {
              source: `roots`,
              requiredKeys: initialKeys,
              permittedKeys: prior.roots.map(({ id }) => id),
              knowledge: `rows`,
              since: `answer-release`,
            },
            ...([`marked`, `children`] as const).map((source) => ({
              source,
              requiredKeys: initialKeys,
              permittedKeys: initialKeys,
              knowledge: `complete-domain` as const,
              since: `answer-release` as const,
            })),
          ],
        }
      : gate === `held-window`
        ? {
            answer: [
              {
                source: `marked`,
                requiredKeys: [pivot],
                permittedKeys: windowKeys,
                knowledge: `complete-domain`,
                since: `answer-release`,
              },
              {
                source: `roots`,
                requiredKeys: [pivot],
                permittedKeys: prior.roots.map(({ id }) => id),
                knowledge: `rows`,
                since: `fixture-start`,
              },
              {
                source: `children`,
                requiredKeys: [pivot],
                permittedKeys: windowKeys,
                knowledge: `complete-domain`,
                since: `fixture-start`,
              },
            ],
          }
        : gate === `source-failed-peer`
          ? {
              peer: [
                {
                  source: `children`,
                  requiredKeys: [pivot],
                  permittedKeys: [pivot],
                  knowledge: `complete-domain`,
                  since: `answer-release`,
                },
              ],
            }
          : {}
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
            // The pivot child load establishes its unchanged children. It
            // supplies no new root ranks or retained first-two child values.
            facts: prior,
          }),
          observe(`public-state`),
        )
      else
        steps.push(
          semantic({
            type: `source-answer`,
            requirement: `answer`,
            // Only marked demand is replayed here. Root ranks and retained
            // children keep their prior facts until their own source writes.
            facts: { ...prior, marked: answered.marked },
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
    publicationEpochs: authorCompletionBaselinePublicationEpochs(setup, steps),
    sourceAnswerPremises,
  }
}

/**
 * A publication epoch is a model-only observation interval, not a production
 * task, receipt, generation, or promise. These baseline programs arrange at
 * most one net public payload in each interval. An optimistic hold publishes
 * its overlay; its settlement publishes the queued output with the drop.
 * Failed-flush atomicity forbids forward/restoration events in the rollback
 * interval. The later drop and queued forward/restore publish only their net
 * restored value. Retry is a separate interval. Source replay and window holds
 * retain prior payload until their completed answer interval. A graph failure
 * keeps prior payload. Initial readiness exposes one completed initial window.
 * Authority is ARCHITECTURE's Coherent publication: accepted sync transactions
 * publish with the optimistic drop (1709–1712), and a failed flush emits no
 * facade event or layout revision (1724–1733). The optimistic-history-oracle
 * opening contract (24–34) states the same atomic drop. Atomic window
 * publication owns completed window/initial intervals. These expectations are
 * not scheduling choices inferred from recorded callbacks.
 *
 * Each authored observe cut closes its interval. Ready fixtures first establish
 * their setup through the actual initial callback stream. Cleanup is a separate
 * raw lifecycle interval: old teardown is not a publication by the replacement
 * run. The replacement's next interval starts its event replicas empty.
 */
export function authorCompletionBaselinePublicationEpochs(
  setup: CompletionSetup,
  steps: ReadonlyArray<CompletionBaselineStep>,
): Array<CompletionBaselinePublicationEpoch> {
  const epochs: Array<CompletionBaselinePublicationEpoch> = setup.ready
    ? [
        {
          id: `initialization`,
          kind: `initialization`,
          fromStep: -1,
          throughStep: -1,
        },
      ]
    : []
  let fromStep = 0
  for (const [index, step] of steps.entries()) {
    if (step.kind !== `baseline-observe`) continue
    epochs.push({
      id: `${epochs.length}:${step.boundary}`,
      kind: step.boundary === `cleanup-abandoned` ? `cleanup` : `publication`,
      fromStep,
      throughStep: index,
    })
    fromStep = index + 1
  }
  if (fromStep !== steps.length)
    throw new Error(`completion grammar: every publication interval has a cut`)
  return epochs
}

/**
 * Compute one expectation before running its physical interval. Replay only
 * authored semantic actions in a fresh model; no actual request, output,
 * callback, or late mutable outcome model supplies this value. A driver arms
 * the returned snapshot before fromStep, records every raw public callback,
 * then compares the captured callbacks and persistent replicas at throughStep.
 * Main outcome
 * actions still wait for their exact physical boundaries before being stepped.
 */
export function modelCompletionBaselinePublicationEpoch(
  program: CompletionBaselineProgram,
  epoch: CompletionBaselinePublicationEpoch,
): CompletionModel {
  const authored = authorCompletionBaselinePublicationEpochs(
    program.setup,
    program.steps,
  ).find((entry) => entry.id === epoch.id)
  if (
    !authored ||
    authored.kind !== epoch.kind ||
    authored.fromStep !== epoch.fromStep ||
    authored.throughStep !== epoch.throughStep
  )
    throw new Error(`completion grammar: unknown authored publication interval`)
  const model = createCompletionModel(program.setup)
  for (const step of program.steps.slice(0, epoch.throughStep + 1))
    if (step.kind === `semantic`) stepCompletionModel(model, step.action)
  return model
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
  model: [modelCompletionBaselinePublicationEpoch],
  grammar: [
    authorCompletionBaselinePublicationEpochs,
    constructCompletionBaselineProgram,
    constructCompletionWindowReceivingProgram,
    completionBaselineProgramFamily,
  ],
})
