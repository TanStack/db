/**
 * # Intermediate values keep authored fields until Collection publication.
 *
 * The shared input oracle states the maintainer's source/projection/inline law.
 * This finite receiver exhausts 1,155 root histories, 1,155 wrapped child
 * histories, 825 direct child histories and 1,155 real Effect histories.
 * Each crosses select, where, having and predicate-with-select controls.
 * Another 198 inline value/rejection histories and 20 direct-source controls exercise neighboring
 * boundaries. Effects also check exit, reentry, delivery continuity in both
 * callback channels, every delivered value/previousValue, and post-disposal
 * silence. Another 396 histories use the exported compiler across FROM, JOIN
 * and union placement, both compilation orders and shared/separate caches at
 * initial graph drain. Optimizer cloning can prevent a placement from reusing
 * the original raw key; explicit counters distinguish that from cache reuse.
 * It invokes real query callbacks and compares their copied input and ordinary derived output at
 * initial readiness, held mutation, settlement and later remote use. The
 * materializer receiver uses the same judgment, not a competing child model.
 *
 * Reconstruction retains every single-field collision and both populated union
 * branches with numeric/string keys. Removing path, shape, collision, boolean
 * or checkpoint loses a distinct authored-value or boundary shortcut; the calibrated attacks
 * below exhibit those consequences. Legal direct source returns cannot carry
 * authored overrides. Compiled Collection-valued inputs are the nearby rejected
 * form. Recursion is bounded at two QueryRefs, one LEFT join and flat child
 * values. This establishes no native/framework or provider handoff.
 *
 * There is no random campaign or seed replay for this exhaustive finite grammar.
 * Reach explicitly ignores unrelated seed environment variables. A calibration-
 * only selection enters no receiving campaign; a partial receiving selection
 * still owes the selected campaign's entire required matrix.
 */
import { afterAll, expect } from 'vitest'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import {
  metadataCallbackKinds,
  metadataCallbackReceiverHistories,
  metadataCompilerCacheHistories,
  metadataInlineHistories,
} from './virtual-row-fields-input-oracle.js'
import {
  runInlineMetadataCallbackHistory,
  runMetadataCallbackHistory,
  runMetadataCompilerCacheHistory,
} from './virtual-row-fields-input-driver.js'

const cuts = [`initial`, `held`, `settled`, `remote-next-use`] as const
const receiverCuts = (receiver: string) =>
  receiver === `effect` ? [...cuts, `exit`, `reentry`, `disposed`] : cuts
const key = (history: {
  shape: string
  collision: string
  authoredPending: boolean
}) => `${history.shape}/${history.collision}/${history.authoredPending}`
// Vitest interprets dollar-prefixed words in table titles as placeholders.
// Escape only the display label; the grammar and reach retain exact names.
const callbackCases = metadataCallbackReceiverHistories.map((history) => ({
  ...history,
  label:
    `${history.kind}/${history.receiver}/${history.path}/${key(history)}`.replaceAll(
      `$`,
      `field:`,
    ),
}))
const inlineCases = metadataInlineHistories.map((history) => ({
  ...history,
  label: `${history.path}/${history.form}/${key(history)}`.replaceAll(
    `$`,
    `field:`,
  ),
}))
const compilerCases = metadataCompilerCacheHistories.map((history) => ({
  ...history,
  label:
    `${history.path}/${history.order}/${history.cache}/${key(history)}`.replaceAll(
      `$`,
      `field:`,
    ),
}))
const compilerObservations = [
  `callback`,
  `derived-output`,
  `authored-output`,
] as const
// Each finite history has one numeric token. A state keeps that token once,
// so repeated observations preserve the original per-history checkpoint count.
const compilerHistoriesByState = new Map<string, Set<number>>(
  metadataCompilerCacheHistories
    .flatMap((history) =>
      compilerObservations.map(
        (observation) =>
          `${history.path}/${history.order}/${history.cache}/${key(history)}/${observation}`,
      ),
    )
    .map((state) => [state, new Set<number>()]),
)
let compilerHistory = 0
const callbackHistoriesByState = new Map<string, Set<number>>(
  [
    ...metadataCallbackReceiverHistories.flatMap((history) =>
      receiverCuts(history.receiver).map(
        (cut) =>
          `${history.kind}/${history.receiver}/${history.path}/${key(history)}/${cut}`,
      ),
    ),
    ...metadataCallbackKinds.flatMap((kind) =>
      [`root`, `inline-child`, `inline-child-direct`, `effect`].flatMap(
        (receiver) =>
          receiverCuts(receiver).map(
            (cut) => `${kind}/${receiver}/direct-source/${cut}`,
          ),
      ),
    ),
  ].map((state) => [state, new Set<number>()]),
)
let callbackHistory = 0
const inlineHistoriesByState = new Map<string, Set<number>>(
  metadataInlineHistories
    .flatMap((history) =>
      history.form === `collection`
        ? [`${history.path}/${history.form}/${key(history)}/rejected`]
        : cuts.map(
            (cut) => `${history.path}/${history.form}/${key(history)}/${cut}`,
          ),
    )
    .map((state) => [state, new Set<number>()]),
)
let inlineHistory = 0
let callbackEntered = false
let inlineEntered = false
let compilerEntered = false
afterAll(() => {
  if (callbackEntered)
    expect(
      [...callbackHistoriesByState].filter(
        ([, histories]) => histories.size < 1,
      ),
      `functional metadata callback`,
    ).toEqual([])
  if (inlineEntered)
    expect(
      [...inlineHistoriesByState].filter(([, histories]) => histories.size < 1),
      `inline metadata callback`,
    ).toEqual([])
  if (compilerEntered)
    expect(
      [...compilerHistoriesByState].filter(
        ([, histories]) => histories.size < 1,
      ),
      `compiler cache metadata`,
    ).toEqual([])
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
    for (const [name, historiesByState] of [
      [`callback`, callbackHistoriesByState],
      [`inline`, inlineHistoriesByState],
      [`compiler`, compilerHistoriesByState],
    ] as const) {
      const counts = [...historiesByState.values()].map(
        (histories) => histories.size,
      )
      console.info(`${name} metadata reach`, {
        states: counts.length,
        reached: counts.filter(Boolean).length,
        minimum: Math.min(...counts),
      })
    }
  }
})
// The former case body, unchanged.
async function judgeCallbackMetadata(
  history: (typeof callbackCases)[number],
): Promise<void> {
  callbackEntered = true
  callbackHistory++
  const report = await runMetadataCallbackHistory(
    history,
    history.path,
    (cut) =>
      callbackHistoriesByState
        .get(
          `${history.kind}/${history.receiver}/${history.path}/${key(history)}/${cut}`,
        )!
        .add(callbackHistory),
    history.receiver,
    history.kind,
  )
  expect(report.violations, JSON.stringify(report.violations[0])).toStrictEqual(
    [],
  )
}

const callbackLaw = `Functional select, where, and having callbacks receive authored metadata before they derive ordinary values, at every receiver cut.`

oracleProperty({
  id: `virtual-row-fields-input.callback`,
  law: {
    statement: callbackLaw,
    authority: `Reserved public row fields and the boundary-only metadata rule (maintainer decision, 2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md: callback inputs and inline values keep their authored values, stated at the start of this owner.`,
    limits: `The enumerated callback kind, receiver, path, shape, collision, and pending histories.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/compiler/index.ts#compileQuery`,
    `src/query/effect.ts#createEffect`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  histories: callbackCases,
  label: (history) =>
    `receives callback metadata before deriving ordinary values: ${history.label}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(callbackLaw, plan, observe, () =>
      judgeCallbackMetadata(plan.history),
    ),
  check: forwardAssertionJudgment,
})
const directSourceCases = metadataCallbackKinds.flatMap((kind) =>
  ([`root`, `inline-child`, `inline-child-direct`, `effect`] as const).map(
    (receiver) => ({ kind, receiver }),
  ),
)

// The former case body, unchanged.
async function judgeDirectSourceMetadata({
  kind,
  receiver,
}: (typeof directSourceCases)[number]): Promise<void> {
  callbackEntered = true
  callbackHistory++
  const report = await runMetadataCallbackHistory(
    {
      shape: `functional-direct`,
      collision: `none`,
      authoredPending: false,
    },
    `direct-source`,
    (cut) =>
      callbackHistoriesByState
        .get(`${kind}/${receiver}/direct-source/${cut}`)!
        .add(callbackHistory),
    receiver,
    kind,
  )
  expect(report.violations).toStrictEqual([])
}

const directSourceLaw = `A callback that returns its source row directly receives that row's genuine source metadata before deriving ordinary values.`

oracleProperty({
  id: `virtual-row-fields-input.direct-source`,
  law: {
    statement: directSourceLaw,
    authority: `Reserved public row fields and the boundary-only metadata rule (maintainer decision, 2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md: callback inputs and inline values keep their authored values, stated at the start of this owner.`,
    limits: `The enumerated callback kind and receiver cells over one functional-direct source.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/compiler/index.ts#compileQuery`,
    `src/query/effect.ts#createEffect`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  histories: directSourceCases,
  label: (history) =>
    `receives direct source metadata before deriving ordinary values: ${JSON.stringify(history)}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(directSourceLaw, plan, observe, () =>
      judgeDirectSourceMetadata(plan.history),
    ),
  check: forwardAssertionJudgment,
})
// The former case body, unchanged.
async function judgeInlineMetadata(
  history: (typeof inlineCases)[number],
): Promise<void> {
  inlineEntered = true
  inlineHistory++
  const report = await runInlineMetadataCallbackHistory(
    history,
    history.form,
    (cut) =>
      inlineHistoriesByState
        .get(`${history.path}/${history.form}/${key(history)}/${cut}`)!
        .add(inlineHistory),
    history.path,
  )
  expect(report.violations, JSON.stringify(report.violations[0])).toStrictEqual(
    [],
  )
}

const inlineLaw = `Inline include values keep their authored metadata at callback input, and a compiled Collection-valued input is rejected.`

oracleProperty({
  id: `virtual-row-fields-input.inline`,
  law: {
    statement: inlineLaw,
    authority: `Reserved public row fields and the boundary-only metadata rule (maintainer decision, 2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md: callback inputs and inline values keep their authored values, stated at the start of this owner.`,
    limits: `The enumerated inline path, form, shape, collision, and pending histories.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/compiler/index.ts#compileQuery`,
    `src/query/effect.ts#createEffect`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  histories: inlineCases,
  label: (history) =>
    `receives inline authored metadata or rejects compiled Collection input: ${history.label}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(inlineLaw, plan, observe, () =>
      judgeInlineMetadata(plan.history),
    ),
  check: forwardAssertionJudgment,
})

// The initial compiler graph-drain cut is distinct from the Collection
// lifecycle cuts above. Both orders must preserve the cache-transparency
// relation. Independent source/projection judgments still check both executions;
// raw output does not borrow an implicit Effect-root attribution policy.
// The former case body, unchanged.
async function judgeCompilerCacheMetadata(
  history: (typeof compilerCases)[number],
): Promise<void> {
  compilerEntered = true
  compilerHistory++
  const report = await runMetadataCompilerCacheHistory(
    history,
    history.order,
    history.cache,
    history.path,
    (observation) =>
      compilerHistoriesByState
        .get(
          `${history.path}/${history.order}/${history.cache}/${key(history)}/${observation}`,
        )!
        .add(compilerHistory),
  )
  expect(report.violations, JSON.stringify(report.violations[0])).toStrictEqual(
    [],
  )
}

const compilerCacheLaw = `A compilation cache on one graph preserves the callback inputs and authored selected output that separate compilations produce, in both compilation orders.`

oracleProperty({
  id: `virtual-row-fields-input.compiler-cache`,
  law: {
    statement: compilerCacheLaw,
    authority: `Reserved public row fields and the boundary-only metadata rule (maintainer decision, 2026-11-05) in packages/db/src/query/live/ARCHITECTURE.md: callback inputs and inline values keep their authored values, stated at the start of this owner.`,
    limits: `The enumerated path, order, cache, shape, collision, and pending histories at the initial graph drain.`,
  },
  owns: [
    `src/collection/index.ts#createCollection`,
    `src/query/compiler/index.ts#compileQuery`,
    `src/query/effect.ts#createEffect`,
    `src/query/live-query-collection.ts#createLiveQueryCollection`,
  ],
  histories: compilerCases,
  label: (history) =>
    `preserves metadata across compiler cache modes: ${history.label}`,
  resolve: (history) => ({ history }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(compilerCacheLaw, plan, observe, () =>
      judgeCompilerCacheMetadata(plan.history),
    ),
  check: forwardAssertionJudgment,
})
