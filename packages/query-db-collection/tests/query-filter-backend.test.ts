import { IR } from '@tanstack/db'
import { describe, expect, it } from 'vitest'
import { applyPredicates } from '../e2e/query-filter'
import type { LoadSubsetOptions } from '@tanstack/db'

const value = <T>(input: T) => new IR.Value(input)
const ref = (...path: Array<string>) => new IR.PropRef(path)
const call = (name: string, ...args: Array<IR.BasicExpression>) =>
  new IR.Func<boolean>(name, args)
const order = (
  field: string,
  compareOptions: IR.OrderByClause[`compareOptions`] = {
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
  },
): IR.OrderByClause => ({ expression: ref(field), compareOptions })

// This is a finite test-provider contract, not another database oracle. Expected
// rows below are literals; no production evaluator computes the expected side.
describe(`Query scalar test backend`, () => {
  const rows = [
    { id: `null`, score: null },
    { id: `missing`, score: undefined },
    { id: `zero`, score: 0 },
    { id: `two`, score: 2 },
  ]

  it.each([
    [`eq`, [`two`]],
    [`gt`, []],
    [`gte`, [`two`]],
    [`lt`, [`zero`]],
    [`lte`, [`zero`, `two`]],
    [`neq`, [`zero`]],
    [`ne`, [`zero`]],
    [`notEq`, [`zero`]],
  ])(`keeps only true scalar %s comparisons`, (operator, ids) => {
    const actual = applyPredicates(rows, {
      where: call(operator, ref(`score`), value(2)),
    })
    expect(actual).toEqual(rows.filter((row) => ids.includes(row.id)))
  })

  it(`preserves UNKNOWN through nested boolean expressions`, () => {
    const positive = call(`gt`, ref(`score`), value(0))
    expect(applyPredicates(rows, { where: call(`not`, positive) })).toEqual([
      { id: `zero`, score: 0 },
    ])
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`and`, value(true), positive)),
      }),
    ).toEqual([{ id: `zero`, score: 0 }])
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`or`, value(false), positive)),
      }),
    ).toEqual([{ id: `zero`, score: 0 }])
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`and`, value(false), positive)),
      }),
    ).toEqual(rows)
    expect(
      applyPredicates(rows, { where: call(`or`, value(true), positive) }),
    ).toEqual(rows)
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`eq`, ref(`score`), value(null))),
      }),
    ).toEqual([])
  })

  it(`keeps explicit null and undefined tests distinct`, () => {
    expect(
      applyPredicates(rows, { where: call(`isNull`, ref(`score`)) }),
    ).toEqual([{ id: `null`, score: null }])
    expect(
      applyPredicates(rows, { where: call(`isUndefined`, ref(`score`)) }),
    ).toEqual([{ id: `missing`, score: undefined }])
    expect(
      applyPredicates(rows, {
        where: call(
          `and`,
          call(`isNotNull`, ref(`score`)),
          call(`isNotUndefined`, ref(`score`)),
        ),
      }),
    ).toEqual([
      { id: `zero`, score: 0 },
      { id: `two`, score: 2 },
    ])
  })

  it(`keeps nested NOT and undefined comparisons on the full expression path`, () => {
    const positive = call(`gt`, ref(`score`), value(0))
    expect(
      applyPredicates(rows, { where: call(`not`, call(`not`, positive)) }),
    ).toEqual([{ id: `two`, score: 2 }])
    expect(
      applyPredicates(rows, {
        where: call(
          `not`,
          call(`and`, positive, call(`lt`, ref(`score`), value(3))),
        ),
      }),
    ).toEqual([{ id: `zero`, score: 0 }])
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`eq`, ref(`score`), value(undefined))),
      }),
    ).toEqual([])
  })

  it(`preserves native bigint equality, range, and membership without number conversion`, () => {
    const input = [{ count: 9007199254740992n }, { count: 9007199254740993n }]
    expect(
      applyPredicates(input, {
        where: call(`eq`, ref(`count`), value(9007199254740993n)),
      }),
    ).toEqual([{ count: 9007199254740993n }])
    expect(
      applyPredicates(input, {
        where: call(`gt`, ref(`count`), value(9007199254740992n)),
      }),
    ).toEqual([{ count: 9007199254740993n }])
    expect(
      applyPredicates(input, {
        where: call(`in`, ref(`count`), value([9007199254740992n])),
      }),
    ).toEqual([{ count: 9007199254740992n }])
  })

  it(`uses the source scalar IN contract, including null list entries`, () => {
    expect(
      applyPredicates(rows, {
        where: call(`in`, ref(`score`), value([null, 2])),
      }),
    ).toEqual([{ id: `two`, score: 2 }])
    expect(
      applyPredicates(rows, {
        where: call(`not`, call(`in`, ref(`score`), value([null, 2]))),
      }),
    ).toEqual([{ id: `zero`, score: 0 }])
    expect(
      applyPredicates(rows, {
        where: call(`inArray`, ref(`score`), value([])),
      }),
    ).toEqual([])
  })

  it(`compares valid Dates by epoch and follows the entire source-local path`, () => {
    const dated = [
      { id: `first`, at: new Date(100), nested: { score: 1 } },
      { id: `second`, at: new Date(200), nested: { score: 2 } },
    ]
    expect(
      applyPredicates(dated, {
        where: call(`eq`, ref(`at`), value(new Date(100))),
      }),
    ).toEqual([dated[0]])
    expect(
      applyPredicates(dated, {
        where: call(`eq`, ref(`nested`, `score`), value(2)),
      }),
    ).toEqual([dated[1]])
    expect(
      applyPredicates(dated, {
        where: call(`eq`, ref(`absent`, `id`), value(`first`)),
      }),
    ).toEqual([])
  })

  it(`evaluates LIKE, case folding, and UNKNOWN without truthy coercion`, () => {
    const text = [
      { name: null },
      { name: `A.b` },
      { name: `axb` },
      { name: `A\nb` },
    ]
    expect(
      applyPredicates(text, { where: call(`like`, ref(`name`), value(`A.b`)) }),
    ).toEqual([{ name: `A.b` }])
    expect(
      applyPredicates(text, {
        where: call(`ilike`, ref(`name`), value(`a_b`)),
      }),
    ).toEqual([{ name: `A.b` }, { name: `axb` }, { name: `A\nb` }])
    expect(
      applyPredicates(text, {
        where: call(`eq`, call(`lower`, ref(`name`)), value(`a.b`)),
      }),
    ).toEqual([{ name: `A.b` }])
    expect(
      applyPredicates(text, {
        where: call(`eq`, call(`upper`, ref(`name`)), value(`AXB`)),
      }),
    ).toEqual([{ name: `axb` }])
    expect(
      applyPredicates(text, {
        where: call(`not`, call(`like`, ref(`name`), value(`A%`))),
      }),
    ).toEqual([{ name: `axb` }])
  })

  it(`honors lexical and explicit locale/numeric collation`, () => {
    const words = [{ word: `ä` }, { word: `z` }, { word: `a` }]
    expect(applyPredicates(words, { orderBy: [order(`word`)] })).toEqual([
      { word: `a` },
      { word: `z` },
      { word: `ä` },
    ])
    expect(
      applyPredicates(words, {
        orderBy: [
          order(`word`, {
            direction: `asc`,
            nulls: `last`,
            stringSort: `locale`,
            locale: `de-DE`,
            localeOptions: { sensitivity: `variant` },
          }),
        ],
      }),
    ).toEqual([{ word: `a` }, { word: `ä` }, { word: `z` }])
    expect(
      applyPredicates([{ word: `item2` }, { word: `item10` }], {
        orderBy: [
          order(`word`, {
            direction: `desc`,
            nulls: `first`,
            stringSort: `locale`,
            locale: `en-US`,
            localeOptions: { numeric: true },
          }),
        ],
      }),
    ).toEqual([{ word: `item10` }, { word: `item2` }])
  })

  it(`sorts by all keys before applying a zero-aware window without mutating inputs`, () => {
    const input = [
      { id: `b`, score: 2 },
      { id: `n`, score: null },
      { id: `a`, score: 2 },
      { id: `z`, score: 0 },
    ]
    const before = structuredClone(input)
    const options = {
      orderBy: [
        order(`score`, { direction: `desc`, nulls: `first` }),
        order(`id`),
      ],
      offset: 1,
      limit: 2,
    }
    expect(applyPredicates(input, options)).toEqual([
      { id: `a`, score: 2 },
      { id: `b`, score: 2 },
    ])
    expect(applyPredicates(input, { ...options, offset: 0, limit: 0 })).toEqual(
      [],
    )
    expect(applyPredicates(input, { ...options, offset: 99 })).toEqual([])
    expect(input).toEqual(before)
    expect(
      applyPredicates(
        [
          { id: `b`, x: 1 },
          { id: `a`, x: 1 },
        ],
        { orderBy: [order(`x`)] },
      ),
    ).toEqual([
      { id: `b`, x: 1 },
      { id: `a`, x: 1 },
    ])
  })

  it(`uses offset when the request also carries cursor hints`, () => {
    expect(
      applyPredicates(rows, {
        offset: 2,
        limit: 1,
        cursor: {
          whereFrom: value(false),
          whereCurrent: value(false),
          lastKey: `irrelevant`,
        },
      }),
    ).toEqual([{ id: `zero`, score: 0 }])
  })

  it.each([{ input: [] }, { input: [{ score: 2 }] }])(
    `rejects unsupported complete requests before filtering %j`,
    ({ input }) => {
      const unsupported = call(`unsupported`, value(1), value(2))
      for (const where of [
        unsupported,
        call(`or`, value(true), unsupported),
        call(`and`, value(false), unsupported),
        call(`eq`, ref(`score`)),
        call(`in`, ref(`score`), value(2)),
        call(`eq`, ref(`score`), value({ hidden: 2 })),
      ]) {
        expect(() => applyPredicates(input, { where })).toThrow(
          /Unsupported Query test-backend/,
        )
      }
      for (const where of [
        call(`eq`, ref(`score`), value(2)),
        call(`or`, value(true), value(false)),
      ]) {
        expect(() =>
          applyPredicates(input, {
            where,
            orderBy: [
              {
                expression: call(`lower`, ref(`score`)),
                compareOptions: { direction: `asc`, nulls: `last` },
              },
            ],
          }),
        ).toThrow(/order expression/)
      }
      for (const options of [
        { limit: -1 },
        { limit: Infinity },
        { offset: 0.5 },
        { offset: NaN },
      ]) {
        expect(() => applyPredicates(input, options)).toThrow(/window/)
      }
      const malformed = {
        orderBy: [
          {
            expression: ref(`score`),
            compareOptions: { direction: `sideways`, nulls: `last` },
          },
        ],
      } as unknown as LoadSubsetOptions
      expect(() => applyPredicates(input, malformed)).toThrow(/order options/)
    },
  )

  it(`rejects unsupported referenced values even outside the selected result`, () => {
    expect(() =>
      applyPredicates([{ id: 1, score: { nested: 2 } }], {
        where: call(
          `and`,
          call(`eq`, ref(`id`), value(0)),
          call(`eq`, ref(`score`), value(2)),
        ),
      }),
    ).toThrow(/scalar/)
    expect(() =>
      applyPredicates([{ score: new Date(NaN) }], {
        orderBy: [order(`score`)],
      }),
    ).toThrow(/scalar/)
    expect(() =>
      applyPredicates([{ score: 1 }], { where: call(`not`, ref(`score`)) }),
    ).toThrow(/boolean operand/)
  })

  it(`rejects wrong rows and order at the actual backend output boundary`, () => {
    const expected = [
      { id: `two`, score: 2 },
      { id: `zero`, score: 0 },
    ]
    const assertRows = (actual: typeof rows) => expect(actual).toEqual(expected)
    const actual = applyPredicates(rows, {
      where: call(`not`, call(`lt`, ref(`score`), value(0))),
      orderBy: [order(`score`, { direction: `desc`, nulls: `last` })],
    })
    assertRows(actual)
    expect(() => assertRows([...actual].reverse())).toThrow()
    expect(() => assertRows([...actual, { id: `null`, score: null }])).toThrow()
    expect(() => assertRows(actual.slice(1))).toThrow()
  })
})
