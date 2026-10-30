/**
 * # Reserved fields must be correct before user JavaScript consumes them.
 *
 * The shared input oracle states the maintainer's source/projection/inline law.
 * This finite receiver exhausts 231 root histories, 231 wrapped child histories
 * and 165 direct child histories. Another 99 inline-value/rejection histories
 * and three direct-source controls exercise the neighboring boundaries.
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
  metadataCallbackReceiverHistories,
  metadataInlineHistories,
  metadataInputViolations,
  metadataOutputViolations,
} from './virtual-row-fields-input-oracle.js'
import {
  captureMetadataInput,
  runInlineMetadataCallbackHistory,
  runMetadataCallbackHistory,
} from './virtual-row-fields-input-driver.js'
import type { MetadataSourceFact } from './virtual-row-fields-input-oracle.js'

const cuts = [`initial`, `held`, `settled`, `remote-next-use`] as const
const key = (history: {
  shape: string
  collision: string
  authoredPending: boolean
}) => `${history.shape}/${history.collision}/${history.authoredPending}`
// Vitest interprets dollar-prefixed words in table titles as placeholders.
// Escape only the display label; the grammar and reach retain exact names.
const callbackCases = metadataCallbackReceiverHistories.map((history) => ({
  ...history,
  label: `${history.receiver}/${history.path}/${key(history)}`.replaceAll(
    `$`,
    `field:`,
  ),
}))
const inlineCases = metadataInlineHistories.map((history) => ({
  ...history,
  label: `${history.form}/${key(history)}`.replaceAll(`$`, `field:`),
}))
const callbackReach = createOracleReach(
  `functional metadata callback`,
  [
    ...metadataCallbackReceiverHistories.flatMap((history) =>
      cuts.map(
        (cut) => `${history.receiver}/${history.path}/${key(history)}/${cut}`,
      ),
    ),
    ...[`root`, `inline-child`, `inline-child-direct`].flatMap((receiver) =>
      cuts.map((cut) => `${receiver}/direct-source/${cut}`),
    ),
  ],
  { replaying: false },
)
const inlineReach = createOracleReach(
  `inline metadata callback`,
  metadataInlineHistories.flatMap((history) =>
    history.form === `collection`
      ? [`${history.form}/${key(history)}/rejected`]
      : cuts.map((cut) => `${history.form}/${key(history)}/${cut}`),
  ),
  { replaying: false },
)
let callbackEntered = false
let inlineEntered = false
afterAll(() => {
  if (callbackEntered) callbackReach.assertReached()
  if (inlineEntered) inlineReach.assertReached()
  if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
    for (const [name, reach] of [
      [`callback`, callbackReach],
      [`inline`, inlineReach],
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
    metadataCallbackReceiverHistories,
    metadataInlineHistories,
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
          `${history.receiver}/${history.path}/${key(history)}/${cut}`,
        ),
      history.receiver,
    )
    expect(
      report.violations,
      JSON.stringify(report.violations[0]),
    ).toStrictEqual([])
  },
)
test.each([`root`, `inline-child`, `inline-child-direct`] as const)(
  `receives direct source metadata before deriving ordinary values: %s`,
  async (receiver) => {
    callbackEntered = true
    callbackReach.beginHistory()
    const report = await runMetadataCallbackHistory(
      {
        shape: `functional-direct`,
        collision: `none`,
        authoredPending: false,
      },
      `direct-source`,
      (cut) => callbackReach.reach(`${receiver}/direct-source/${cut}`),
      receiver,
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
      (cut) => inlineReach.reach(`${history.form}/${key(history)}/${cut}`),
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
