import { oracleProperty } from '../../db/tests/oracle-property'
import {
  completedSeedReinsertReloadRegime,
  keptMetadataDurabilityBatch,
  keptMetadataDurabilityInputArbitrary,
  persistedPeerFullGrammar,
  persistedPeerGrammar,
  persistedPeerOnDemandGrammar,
  seedReinsertReloadHistory,
  seedReinsertReloadInputArbitrary,
} from '../../db/tests/sync-metadata-session-oracle'
import {
  checkSessionRuns,
  completedSessionRuns,
  observeSessionRun,
  sessionRunCalibrations,
  sessionRuns,
} from './sync-metadata-session-runs'
import type {
  SeedReinsertReloadInput,
  SessionAction,
  SessionGrammar,
  runSessionHistory,
} from '../../db/tests/sync-metadata-session-oracle'
import type { OwedSessionRun } from './sync-metadata-session-runs'

/**
 * Both receiving drivers run the same generated properties. The shared
 * oracle owns its histories, completed-state classifier and comparison;
 * each host supplies its unchanged runHistory and the production code it
 * owns. Each property registers its fixed-seed and random campaigns, and
 * replays through the framework's own selection.
 */
const productionPaths = [
  persistedPeerGrammar,
  persistedPeerFullGrammar,
  persistedPeerOnDemandGrammar,
]
type RunHistory = (
  history: ReadonlyArray<SessionAction>,
  productionPath: SessionGrammar,
) => ReturnType<typeof runSessionHistory>

/**
 * A source insert can be visible to an inner transaction before it commits;
 * the inner equal re-insert keeps metadata without writing it (D9 and D18),
 * and a later named or unknown-author reload follows D11, D15 and D18. Each
 * history runs through the three peer production paths.
 *
 * Reach on each production path: the inner commit ran; the closing named
 * (`row`) or full-reload (`reload`) notice ran with every authored action;
 * and the completed kept-seed reload, a full reload after an implicit inner
 * re-insert while the enclosing write is unaccepted, over a bare key-1 seed
 * (which only the cached row distinguishes from absence) or a seed with
 * metadata. The classifier is `completedSeedReinsertReloadRegime`.
 *
 * Construction: each state is forced through the history's own choices.
 * `notice` selects the named or full-reload notice. A completed kept-seed
 * reload needs the full-reload notice, implicit inner re-inserts, an
 * enclosing transaction that does not commit (it stays open or is
 * cancelled), and the seed shape: bare on key 1, or with metadata. The other
 * choices stay generated. The completed states were required only in the
 * fixed campaign before (random 40 histories reach the bare key-1
 * conjunction with probability about 1/24 each); construction now requires
 * them in every campaign.
 */
export function registerSeedReinsertReloadProperty({
  property,
  runHistory,
  owns,
}: {
  property: string
  runHistory: RunHistory
  owns: ReadonlyArray<string>
}): void {
  const state = (productionPath: string, name: string) =>
    `${productionPath}: ${name}`
  const forAllPaths = (name: string) =>
    productionPaths.map((productionPath) => state(productionPath.name, name))
  const states = productionPaths.flatMap((productionPath) =>
    [
      `inner commit`,
      `row`,
      `reload`,
      `completed kept bare seed reload`,
      `completed kept non-bare seed reload`,
    ].map((name) => state(productionPath.name, name)),
  )
  const keptSeedReload = (
    input: SeedReinsertReloadInput,
    bare: boolean,
  ): SeedReinsertReloadInput => ({
    ...input,
    notice: `reload`,
    innerMetadata: false,
    ending: input.ending === `commit` ? `open` : input.ending,
    bare,
    ...(bare ? { key: 1 as const } : {}),
  })
  oracleProperty<
    SeedReinsertReloadInput,
    Array<OwedSessionRun>,
    Array<SessionAction>
  >({
    id: property,
    law: {
      statement: `Source metadata reads, consumer rows and durable metadata agree with the session model at every checkpoint of a seed, outer insert over the seed, inner equal re-insert and later named or full-reload notice, on every peer production path: keeping metadata in this tab does not make it durable.`,
      authority: `Sync metadata session oracle decisions D9, D11, D15 and D18 (packages/db/tests/sync-metadata-session-oracle.ts, seedReinsertReloadHistoryArbitrary).`,
      limits: `Store and read holds are excluded because their pending work blocks peer notices; the general session grammar covers them. One sync run per history.`,
    },
    owns: [...owns],
    histories: {
      arbitrary: seedReinsertReloadInputArbitrary,
      runs: 40,
      fixedSeeds: [527962096],
      states,
      constructed: [
        {
          name: `named notice`,
          enters: [...forAllPaths(`inner commit`), ...forAllPaths(`row`)],
          build: (input) => ({ ...input, notice: `row` }),
        },
        {
          name: `full-reload notice`,
          enters: [...forAllPaths(`inner commit`), ...forAllPaths(`reload`)],
          build: (input) => ({ ...input, notice: `reload` }),
        },
        {
          name: `completed kept bare seed reload`,
          enters: forAllPaths(`completed kept bare seed reload`),
          build: (input) => keptSeedReload(input, true),
        },
        {
          name: `completed kept non-bare seed reload`,
          enters: forAllPaths(`completed kept non-bare seed reload`),
          build: (input) => keptSeedReload(input, false),
        },
      ],
    },
    resolve: seedReinsertReloadHistory,
    model: (history) =>
      productionPaths.map((productionPath) => ({
        path: productionPath.name,
        name: `seed/re-insert/reload`,
        actions: history.length,
      })),
    driver: async (history, observe) => {
      for (const productionPath of productionPaths)
        await observeSessionRun(
          observe,
          {
            path: productionPath.name,
            name: `seed/re-insert/reload`,
            actions: history.length,
          },
          history,
          () => runHistory(history, productionPath),
        )
    },
    check: (_history, observations, owed) =>
      checkSessionRuns(observations, owed),
    reached: (history, trace) => {
      const innerCommit = history.findIndex(
        (action) => action.type === `commit`,
      )
      const last = history.at(-1)!
      return sessionRuns(trace).flatMap((run) => {
        const completed = completedSeedReinsertReloadRegime(history, {
          mismatch:
            run.mismatch === null
              ? undefined
              : {
                  step: 0,
                  action: `settle`,
                  law: run.mismatch.law,
                  expected: null,
                  actual: null,
                },
          steps: run.steps,
        })
        return [
          ...(run.steps > innerCommit ? [state(run.path, `inner commit`)] : []),
          ...(last.type === `peer` && run.steps === history.length
            ? [state(run.path, last.notice)]
            : []),
          ...(completed === undefined ? [] : [state(run.path, completed)]),
        ]
      })
    },
    calibrations: sessionRunCalibrations(),
    timeout: 120_000,
  })
}

/**
 * D9 separates keeping metadata in this tab from writing it; D18 says that
 * storing a row over a DbClient seed stores only the row; D15 lets an
 * unknown reload expose differing durable metadata. Every generated batch
 * reaches every write/seed/metadata/notice premise on each production path,
 * so every generated history is the construction that enters every declared
 * state; the seed shape, timing and repeats still vary. Drivers own their
 * real entry point and recovery evidence: `extraStates` and `extraReached`
 * name a host's own reach facts, read from each completed run's result.
 */
export function registerKeptMetadataDurabilityProperty({
  property,
  runHistory,
  owns,
  extraStates = [],
  extraReached = () => [],
  timeout,
}: {
  property: string
  runHistory: RunHistory
  owns: ReadonlyArray<string>
  extraStates?: ReadonlyArray<string>
  extraReached?: (
    productionPath: SessionGrammar,
    result: Awaited<ReturnType<typeof runSessionHistory>>,
  ) => ReadonlyArray<string>
  timeout: number
}): void {
  type Batch = ReturnType<typeof keptMetadataDurabilityBatch>
  type Case = Batch[number]
  const caseName = ({ write, bare, metadata, notice }: Case) =>
    `${write}: ${bare ? `bare` : `metadata`} seed: ${metadata ? `explicit` : `implicit`}: ${notice}`
  const state = (productionPath: string, name: string) =>
    `${productionPath}: ${name}`
  const caseNames = ([`update`, `reinsert`, `inner-reinsert`] as const).flatMap(
    (write) =>
      [false, true].flatMap((bare) =>
        [false, true].flatMap((metadata) =>
          ([`none`, `row`, `reload`] as const).map((notice) =>
            caseName({ write, bare, metadata, notice, history: [] }),
          ),
        ),
      ),
  )
  const states = [
    ...productionPaths.flatMap((productionPath) =>
      caseNames.map((name) => state(productionPath.name, name)),
    ),
    ...extraStates,
  ]
  const owedRuns = (batch: Batch): Array<OwedSessionRun> =>
    productionPaths.flatMap((productionPath) =>
      batch.map((entry) => ({
        path: productionPath.name,
        name: caseName(entry),
        actions: entry.history.length,
      })),
    )
  oracleProperty<
    { narrow: boolean; seedInside: boolean; repeats: number },
    Array<OwedSessionRun>,
    Batch
  >({
    id: property,
    law: {
      statement: `Tab-local and durable metadata stay distinct: cross updates and equal re-inserts with implicit keeps and explicit writes, before no notice, a named notice or a full reload, leave source reads, consumer rows and durable metadata equal to the session model at every checkpoint on every peer production path.`,
      authority: `Sync metadata session oracle decisions D9, D15 and D18 (packages/db/tests/sync-metadata-session-oracle.ts, keptMetadataDurabilityHistoriesArbitrary).`,
      limits: `Key 1 with one peer key; one sync run per history; store and read holds are outside this batch.`,
    },
    owns: [...owns],
    histories: {
      arbitrary: keptMetadataDurabilityInputArbitrary,
      runs: 8,
      fixedSeeds: [2220031],
      states,
      constructed: [
        {
          name: `every write/seed/metadata/notice case on every production path`,
          enters: states,
          build: (input) => input,
        },
      ],
    },
    resolve: keptMetadataDurabilityBatch,
    model: owedRuns,
    driver: async (batch, observe) => {
      for (const productionPath of productionPaths)
        for (const entry of batch)
          await observeSessionRun(
            observe,
            {
              path: productionPath.name,
              name: caseName(entry),
              actions: entry.history.length,
            },
            entry.history,
            () => runHistory(entry.history, productionPath),
            (result) => extraReached(productionPath, result),
          )
    },
    check: (_batch, observations, owed) => checkSessionRuns(observations, owed),
    reached: (_batch, trace) =>
      completedSessionRuns(trace).flatMap((run) => [
        state(run.path, run.name),
        ...(run.facts ?? []),
      ]),
    calibrations: sessionRunCalibrations(),
    timeout,
  })
}
