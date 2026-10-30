/**
 * # Reserved fields must be correct before user JavaScript consumes them.
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
 * or checkpoint loses a distinct sanitizer shortcut; the calibrated attacks
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
import { afterAll, expect, test } from 'vitest'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  expectedMetadataInput,
  expectedMetadataRecord,
  expectedSourceVirtualFields,
  metadataCallbackHistories,
  metadataCallbackKinds,
  metadataCallbackReceiverHistories,
  metadataCompilerCacheHistories,
  metadataInlineHistories,
  metadataInputViolations,
  metadataOutputViolations,
} from './virtual-row-fields-input-oracle.js'
import {
  captureMetadataInput,
  runInlineMetadataCallbackHistory,
  runMetadataCallbackHistory,
  runMetadataCompilerCacheHistory,
} from './virtual-row-fields-input-driver.js'
import type { MetadataSourceFact } from './virtual-row-fields-input-oracle.js'

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
const compilerReach = createOracleReach(
  `compiler cache metadata`,
  metadataCompilerCacheHistories.flatMap((history) =>
    compilerObservations.map(
      (observation) =>
        `${history.path}/${history.order}/${history.cache}/${key(history)}/${observation}`,
    ),
  ),
  { replaying: false },
)
const callbackReach = createOracleReach(
  `functional metadata callback`,
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
  ],
  { replaying: false },
)
const inlineReach = createOracleReach(
  `inline metadata callback`,
  metadataInlineHistories.flatMap((history) =>
    history.form === `collection`
      ? [`${history.path}/${history.form}/${key(history)}/rejected`]
      : cuts.map(
          (cut) => `${history.path}/${history.form}/${key(history)}/${cut}`,
        ),
  ),
  { replaying: false },
)
let callbackEntered = false
let inlineEntered = false
let compilerEntered = false
afterAll(() => {
  if (callbackEntered) callbackReach.assertReached()
  if (inlineEntered) inlineReach.assertReached()
  if (compilerEntered) compilerReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
    for (const [name, reach] of [
      [`callback`, callbackReach],
      [`inline`, inlineReach],
      [`compiler`, compilerReach],
    ] as const) {
      const counts = [...reach.counts().values()]
      console.info(`${name} metadata reach`, {
        states: counts.length,
        reached: counts.filter(Boolean).length,
        minimum: Math.min(...counts),
      })
    }
  }
})
declareOracle({
  check: [metadataInputViolations, metadataOutputViolations],
  model: [expectedMetadataInput],
  grammar: [
    metadataCallbackHistories,
    metadataCallbackKinds,
    metadataCallbackReceiverHistories,
    metadataInlineHistories,
    metadataCompilerCacheHistories,
  ],
})

test.each(callbackCases)(
  `receives callback metadata before deriving ordinary values: $label`,
  async (history) => {
    callbackEntered = true
    callbackReach.beginHistory()
    const report = await runMetadataCallbackHistory(
      history,
      history.path,
      (cut) =>
        callbackReach.reach(
          `${history.kind}/${history.receiver}/${history.path}/${key(history)}/${cut}`,
        ),
      history.receiver,
      history.kind,
    )
    expect(
      report.violations,
      JSON.stringify(report.violations[0]),
    ).toStrictEqual([])
  },
)
test.each(
  metadataCallbackKinds.flatMap((kind) =>
    ([`root`, `inline-child`, `inline-child-direct`, `effect`] as const).map(
      (receiver) => ({ kind, receiver }),
    ),
  ),
)(
  `receives direct source metadata before deriving ordinary values: %j`,
  async ({ kind, receiver }) => {
    callbackEntered = true
    callbackReach.beginHistory()
    const report = await runMetadataCallbackHistory(
      {
        shape: `functional-direct`,
        collision: `none`,
        authoredPending: false,
      },
      `direct-source`,
      (cut) => callbackReach.reach(`${kind}/${receiver}/direct-source/${cut}`),
      receiver,
      kind,
    )
    expect(report.violations).toStrictEqual([])
  },
)
test.each(inlineCases)(
  `receives inline authored metadata or rejects compiled Collection input: $label`,
  async (history) => {
    inlineEntered = true
    inlineReach.beginHistory()
    const report = await runInlineMetadataCallbackHistory(
      history,
      history.form,
      (cut) =>
        inlineReach.reach(
          `${history.path}/${history.form}/${key(history)}/${cut}`,
        ),
      history.path,
    )
    expect(
      report.violations,
      JSON.stringify(report.violations[0]),
    ).toStrictEqual([])
  },
)

// The initial compiler graph-drain cut is distinct from the Collection
// lifecycle cuts above. Both orders must preserve the cache-transparency
// relation. Independent source/projection judgments still check both executions;
// raw output does not borrow an implicit Effect-root attribution policy.
test.each(compilerCases)(
  `preserves metadata across compiler cache modes: $label`,
  async (history) => {
    compilerEntered = true
    compilerReach.beginHistory()
    const report = await runMetadataCompilerCacheHistory(
      history,
      history.order,
      history.cache,
      history.path,
      (observation) =>
        compilerReach.reach(
          `${history.path}/${history.order}/${history.cache}/${key(history)}/${observation}`,
        ),
    )
    expect(
      report.violations,
      JSON.stringify(report.violations[0]),
    ).toStrictEqual([])
  },
)

const sourceFact: MetadataSourceFact = {
  row: { id: 1, parentId: `group`, label: `before`, optional: undefined },
  sourceId: `genuine-source`,
  pending: false,
}
// Controls alter observations, never source files. The allowed answer comes
// from the same judgment used for every real receiving history above.
test.each([
  `source-spoof`,
  `source-stripped`,
  `projection-leak`,
  `inline-stripped`,
  `own-undefined-lost`,
  `mixed-before-after`,
  `late-capture-rewrite`,
] as const)(`rejects a hostile callback-input observation: %s`, (fault) => {
  const description = {
    shape: `structured-spread`,
    collision: `all`,
    authoredPending: true,
  } as const
  const projected = { ...description, shape: `functional-spread` } as const
  const use = fault === `projection-leak` ? projected : description
  const inline = fault === `inline-stripped`
  const expected = expectedMetadataInput(sourceFact, use, inline)
  const hostile = structuredClone(expected)
  if (fault === `source-spoof`) hostile.fields.$collectionId!.value = `spoof`
  if (fault === `source-stripped` || fault === `inline-stripped`)
    hostile.fields.$key = { present: false, own: false, value: undefined }
  if (fault === `projection-leak`)
    hostile.fields.$key = { present: true, own: true, value: `spoof` }
  if (fault === `own-undefined-lost`) delete hostile.ordinary.optional
  const next = expectedMetadataInput(
    {
      ...sourceFact,
      row: { ...sourceFact.row, label: `pending` },
      pending: true,
    },
    use,
    inline,
  )
  if (fault === `mixed-before-after`) hostile.fields = next.fields
  if (fault === `late-capture-rewrite`) hostile.ordinary.label = `later`
  expect(metadataInputViolations(expected, [expected])).toStrictEqual([])
  expect(metadataInputViolations(hostile, [expected, next])).not.toStrictEqual(
    [],
  )
})
test.each([
  `omitted-peer`,
  `duplicate-peer`,
  `wrong-key-kind`,
  `publication-only-sanitizer`,
  `missing-derived-field`,
] as const)(`rejects a hostile derived ordinary output: %s`, (fault) => {
  const description = {
    shape: `functional-projection`,
    collision: `$collectionId`,
    authoredPending: false,
  } as const
  const expected = [
    sourceFact,
    { ...sourceFact, row: { ...sourceFact.row, id: `1` } },
  ].map((fact) => ({
    id: fact.row.id,
    observed: expectedMetadataInput(fact, description),
  }))
  const hostile = structuredClone(expected)
  if (fault === `omitted-peer`) hostile.pop()
  if (fault === `duplicate-peer`) hostile.push(structuredClone(hostile[1]!))
  if (fault === `wrong-key-kind`) hostile[1]!.id = 1
  if (fault === `publication-only-sanitizer`)
    hostile[0]!.observed.fields.$collectionId = {
      present: true,
      own: true,
      value: `spoof`,
    }
  if (fault === `missing-derived-field`)
    Reflect.deleteProperty(hostile[0]!, `observed`)
  expect(metadataOutputViolations(expected, expected)).toStrictEqual([])
  expect(metadataOutputViolations(hostile, expected)).not.toStrictEqual([])
})
test(`copies callback input before later source objects change`, () => {
  const description = {
    shape: `functional-direct`,
    collision: `none`,
    authoredPending: false,
  } as const
  const value = {
    ...sourceFact.row,
    ...expectedSourceVirtualFields(sourceFact),
  }
  const capture = captureMetadataInput(value)
  value.label = `later`
  expect(
    metadataInputViolations(capture, [
      expectedMetadataInput(sourceFact, description),
    ]),
  ).toStrictEqual([])
})
test(`accepts readable inherited source metadata at callback input`, () => {
  const description = {
    shape: `functional-direct`,
    collision: `none`,
    authoredPending: false,
  } as const
  const value: object = Object.assign(
    Object.create(expectedSourceVirtualFields(sourceFact)),
    sourceFact.row,
  )
  const capture = captureMetadataInput(value)
  const expected = expectedMetadataInput(sourceFact, description)
  expect(metadataInputViolations(capture, [expected])).toStrictEqual([])
  expect(
    metadataOutputViolations(
      [{ id: 1, observed: capture }],
      [{ id: 1, observed: expected }],
    ),
  ).toStrictEqual([])
})
test(`copies nested callback values before later child objects change`, () => {
  const child = {
    ...sourceFact.row,
    ...expectedSourceVirtualFields(sourceFact),
  }
  const capture = captureMetadataInput({ id: `parent`, children: [child] })
  const expected = expectedMetadataRecord({
    id: `parent`,
    children: [
      { ...sourceFact.row, ...expectedSourceVirtualFields(sourceFact) },
    ],
  })
  child.label = `later`
  expect(metadataInputViolations(capture, [expected])).toStrictEqual([])
})
test.each([`selected-virtual`, `own-undefined`] as const)(
  `rejects an inherited replacement for an authored inline field: %s`,
  (fault) => {
    const description = {
      shape: `functional-projection`,
      collision: `$collectionId`,
      authoredPending: false,
    } as const
    const selected = expectedMetadataInput(sourceFact, description, true)
    const child: Record<string, unknown> = {
      ...selected.ordinary,
      ...Object.fromEntries(
        Object.entries(selected.fields)
          .filter(([, field]) => field.present)
          .map(([name, field]) => [name, field.value]),
      ),
    }
    const expected = expectedMetadataRecord({ id: `parent`, children: [child] })
    const field = fault === `selected-virtual` ? `$collectionId` : `optional`
    const inherited: object = Object.assign(
      Object.create({ [field]: child[field] }),
      Object.fromEntries(
        Object.entries(child).filter(([name]) => name !== field),
      ),
    )
    const actual = captureMetadataInput({ id: `parent`, children: [inherited] })
    expect(
      metadataInputViolations(
        captureMetadataInput({ id: `parent`, children: [child] }),
        [expected],
      ),
    ).toStrictEqual([])
    expect(metadataInputViolations(actual, [expected])).not.toStrictEqual([])
    expect(
      metadataOutputViolations(
        [{ id: `parent`, observed: actual }],
        [{ id: `parent`, observed: expected }],
      ),
    ).not.toStrictEqual([])
  },
)

// The inline array is public data too. An extra ordinary or reserved own field
// must survive capture so both judgments can reject the unauthored shape.
test.each([`unexpected`, `$collectionId`] as const)(
  `rejects an extra own field on an inline array: %s`,
  (field) => {
    const child = expectedMetadataInput(
      sourceFact,
      {
        shape: `functional-projection`,
        collision: `none`,
        authoredPending: false,
      },
      true,
    ).ordinary
    const authored = { id: `parent`, children: [child] }
    const expected = expectedMetadataRecord(authored)
    const value = structuredClone(authored)
    const lawful = captureMetadataInput(value)
    expect(metadataInputViolations(lawful, [expected])).toStrictEqual([])
    Object.assign(value.children, { [field]: `spoof` })
    const hostile = captureMetadataInput(value)
    const rejected = {
      input: metadataInputViolations(hostile, [expected]).length > 0,
      output:
        metadataOutputViolations(
          [{ id: `parent`, observed: hostile }],
          [{ id: `parent`, observed: expected }],
        ).length > 0,
    }
    expect(rejected).toStrictEqual({ input: true, output: true })
  },
)
