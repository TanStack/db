// Checker calibrations and capture controls for the virtual-field input
// oracle in virtual-row-fields-input-oracle.test.ts. They run no production:
// each builds an observation from the independent model, or captures a
// hand-built value, and feeds it to the oracle's input and output checks.
import { expect, test } from 'vitest'
import {
  expectedMetadataInput,
  expectedMetadataRecord,
  expectedSourceVirtualFields,
  metadataInputViolations,
  metadataOutputViolations,
} from './virtual-row-fields-input-oracle.js'
import { captureMetadataInput } from './virtual-row-fields-input-driver.js'
import type { MetadataSourceFact } from './virtual-row-fields-input-oracle.js'

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
  `projection-stripped`,
  `inline-stripped`,
  `own-undefined-lost`,
  `mixed-before-after`,
  `late-capture-rewrite`,
  `compiler-symbol`,
] as const)(`rejects a hostile callback-input observation: %s`, (fault) => {
  const description = {
    shape: `structured-spread`,
    collision: `all`,
    authoredPending: true,
  } as const
  const projected = { ...description, shape: `functional-spread` } as const
  const direct = {
    ...description,
    shape: `functional-direct`,
    collision: `none`,
  } as const
  const use =
    fault === `projection-stripped`
      ? projected
      : fault.startsWith(`source-`) || fault === `mixed-before-after`
        ? direct
        : description
  const expected = expectedMetadataInput(sourceFact, use)
  const hostile = structuredClone(expected)
  if (fault === `compiler-symbol`)
    hostile.symbols.push(Symbol(`compiler-state`))
  if (fault === `source-spoof`) hostile.fields.$collectionId!.value = `spoof`
  if (fault === `source-stripped` || fault === `inline-stripped`)
    hostile.fields.$key = { present: false, own: false, value: undefined }
  if (fault === `projection-stripped`)
    hostile.fields.$key = { present: false, own: false, value: undefined }
  if (fault === `own-undefined-lost`) delete hostile.ordinary.optional
  const next = expectedMetadataInput(
    {
      ...sourceFact,
      row: { ...sourceFact.row, label: `pending` },
      pending: true,
    },
    use,
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
  `intermediate-sanitizer`,
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
  if (fault === `intermediate-sanitizer`)
    hostile[0]!.observed.fields.$collectionId = {
      present: false,
      own: false,
      value: undefined,
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
    const selected = expectedMetadataInput(sourceFact, description)
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
    const child = expectedMetadataInput(sourceFact, {
      shape: `functional-projection`,
      collision: `none`,
      authoredPending: false,
    }).ordinary
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
