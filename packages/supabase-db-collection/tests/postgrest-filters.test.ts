import {
  IR,
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  like,
  lt,
  lte,
  not,
  or,
  upper,
} from '@tanstack/db'
import { describe, expect, test } from 'vitest'
import { subsetOptionsToQueryKey } from '../src/functions'
import {
  cursorCurrentToSearch,
  keyColumnsToSearch,
  loadSubsetOptionsToSearch,
  queryIrToSearch,
  realtimeFiltersToSearch,
  subsetParamsToSearch,
} from '../src/postgrest-filters'

// A bare (unaliased) column ref, as the live subset loader receives them.
const col = (name: string) => new IR.PropRef([name])
// An aliased ref (`user.column`), as the serialized query IR carries them;
// queryIrToSearch strips the alias prefix.
const userCol = (name: string) => new IR.PropRef(['user', name])

const name = col('name')
const id = col('id')
const active = col('active')

// A single orderBy clause, as LoadSubsetOptions carries them.
const sort = (ref: IR.PropRef, direction: 'asc' | 'desc') => ({
  expression: ref,
  compareOptions: { direction, nulls: 'last' as const },
})

// Each active query becomes one `filter` entry: its AND-ed conditions,
// comma-joined into Realtime's wire form. An empty result is the catch-all.
const realtimeEntries = (...where: Array<IR.BasicExpression<boolean>>) =>
  realtimeFiltersToSearch(where).getAll('filter')

describe('realtimeFiltersToSearch', () => {
  test('builds decoded filter strings for supported comparisons', () => {
    expect(realtimeEntries(eq(id, 1))).toEqual(['id=eq.1'])
    // Shares the PostgREST renderer, so negated equality is `not.eq`, not `neq`.
    expect(realtimeEntries(not(eq(active, false)))).toEqual([
      'active=not.eq.false',
    ])
    expect(realtimeEntries(isNull(name))).toEqual(['name=is.null'])
    expect(realtimeEntries(inArray(id, [1, 2, 3]))).toEqual(['id=in.(1,2,3)'])
  })

  test('sorts and deduplicates AND conditions and active-query filters', () => {
    const filter = and(gt(id, 5), eq(active, true), eq(active, true))
    const equivalent = and(eq(active, true), gt(id, 5))
    expect(realtimeEntries(filter, equivalent)).toEqual([
      'active=eq.true,id=gt.5',
    ])
  })

  test('quotes reserved characters without URL-encoding the decoded value', () => {
    expect(realtimeEntries(eq(name, 'Doe, Jane'))).toEqual([
      'name=eq."Doe, Jane"',
    ])
  })

  // Shares PostgREST's quoteValue, so quoting matches the request path: reserved
  // characters, surrounding whitespace, and the empty string are all quoted.
  test.each([
    ['', '""'],
    [' a ', '" a "'],
    ['a"b\\c', '"a\\"b\\\\c"'],
  ])('quotes value %j like the PostgREST request path', (value, quoted) => {
    expect(realtimeEntries(eq(name, value))).toEqual([`name=eq.${quoted}`])
    // A single-member IN renders as an equality via the shared renderer, so the
    // empty string collapses to `eq.""` rather than `in.("")`.
    const inExpected =
      value === '' ? `name=eq.${quoted}` : `name=in.(${quoted})`
    expect(realtimeEntries(inArray(name, [value]))).toEqual([inExpected])
  })

  test('serializes bigints and Dates', () => {
    const when = new Date('2020-01-02T03:04:05.000Z')
    expect(realtimeEntries(eq(id, 9_007_199_254_740_993n))).toEqual([
      'id=eq.9007199254740993',
    ])
    expect(realtimeEntries(eq(name, when))).toEqual([
      'name=eq.2020-01-02T03:04:05.000Z',
    ])
    // A non-finite number renders as `eq.Infinity`: the shared renderer no longer
    // rejects it locally, so the server does (and the swap falls back to
    // catch-all). Correctness is unaffected; only the fallback path differs.
    expect(realtimeEntries(eq(id, Number.POSITIVE_INFINITY))).toEqual([
      'id=eq.Infinity',
    ])
  })

  test('uses empty parameters as the catch-all for unsupported filters', () => {
    expect(realtimeEntries()).toEqual([])
    expect(realtimeEntries(inArray(id, []))).toEqual([])
    expect(realtimeEntries(or(eq(id, 1), eq(id, 2)))).toEqual([])
  })
})

// ── subsetParamsToSearch ────────────────────────────────────────────
// Most tests here exercise the WHERE quoting/negation/IN/null/wildcard logic,
// which lives in a single internal translator shared by every builder;
// subsetParamsToSearch is its thinnest public wrapper.
describe('subsetParamsToSearch', () => {
  const filters = (where: IR.BasicExpression<boolean>) =>
    subsetParamsToSearch({ where })

  test.each([
    [eq(id, 1), 'eq.1'],
    [gt(id, 1), 'gt.1'],
    [gte(id, 1), 'gte.1'],
    [lt(id, 1), 'lt.1'],
    [lte(id, 1), 'lte.1'],
    [isNull(id), 'is.null'],
    [inArray(id, [1, 2, 3]), 'in.(1,2,3)'],
  ])('renders comparison operators: %s', (where, expected) => {
    expect(filters(where).get('id')).toBe(expected)
  })

  test('leaves top-level scalar values raw (unquoted)', () => {
    expect(filters(eq(name, 'a,b(c)')).get('name')).toBe('eq.a,b(c)')
  })

  test('preserves AND branches inside OR', () => {
    expect(
      filters(or(and(eq(active, true), gt(id, 1)), eq(name, 'Bob'))).get('or'),
    ).toBe('(and(active.eq.true,id.gt.1),name.eq.Bob)')
  })

  test.each([and, or])('negates logical groups', (logical) => {
    expect(
      filters(not(logical(eq(active, true), eq(name, 'Bob')))).get('or'),
    ).toBe(
      logical === and
        ? '(active.not.eq.true,name.not.eq.Bob)'
        : '(and(active.not.eq.true,name.not.eq.Bob))',
    )
  })

  test('supports double negation of comparisons and logical groups', () => {
    expect(filters(not(not(eq(name, 'Alice')))).get('name')).toBe('eq.Alice')
    expect(filters(not(not(or(eq(name, 'Alice'), eq(id, 2))))).get('or')).toBe(
      '(name.eq.Alice,id.eq.2)',
    )
  })

  test('preserves multiple OR parameters under AND', () => {
    expect(
      filters(
        and(or(eq(id, 1), eq(id, 2)), or(eq(name, 'Alice'), eq(name, 'Bob'))),
      ).getAll('or'),
    ).toEqual(['(id.eq.1,id.eq.2)', '(name.eq.Alice,name.eq.Bob)'])
  })

  test.each([
    ['', '""'],
    [' a ', '" a "'],
    ['a,b(c)', '"a,b(c)"'],
    ['a"b\\c', '"a\\"b\\\\c"'],
    ['a.b:c&d=1+%', 'a.b:c&d=1+%'],
  ])('quotes logical values and IN members: %j', (value, quoted) => {
    expect(filters(or(eq(name, value), eq(id, 2))).get('or')).toBe(
      `(name.eq.${quoted},id.eq.2)`,
    )
    expect(filters(inArray(name, [value, value])).get('name')).toBe(
      value === '' ? 'eq.' : `in.(${quoted})`,
    )
    expect(filters(not(inArray(name, [value]))).get('name')).toBe(
      value === '' ? 'not.eq.' : `not.in.(${quoted})`,
    )
  })

  test('renders negated comparisons inside OR', () => {
    expect(
      filters(or(not(isNull(name)), not(inArray(name, ['a,b', 'c'])))).get(
        'or',
      ),
    ).toBe('(name.not.is.null,name.not.in.("a,b",c))')
  })

  test('does not union IN constraints inside logical groups', () => {
    expect(
      filters(
        or(and(inArray(id, [1, 2]), inArray(id, [2, 3])), eq(active, true)),
      ).get('or'),
    ).toBe('(and(id.in.(1,2),id.in.(2,3)),active.eq.true)')
  })

  test('renders empty IN lists with SQL null semantics', () => {
    expect(filters(inArray(id, [])).get('id')).toBe('in.()')
    expect(filters(not(inArray(id, []))).get('id')).toBe('not.is.null')
    expect(filters(not(not(inArray(id, [])))).get('id')).toBe('in.()')
  })

  test('preserves null guards for empty IN inside a negated logical group', () => {
    expect(
      filters(not(and(inArray(name, []), eq(active, true)))).get('or'),
    ).toBe('(name.not.is.null,active.not.eq.true)')
  })

  test('ignores null list members instead of matching literal null strings', () => {
    expect(filters(inArray(name, ['Alice', null])).get('name')).toBe(
      'in.(Alice)',
    )
    expect(filters(not(inArray(name, ['Alice', null]))).get('name')).toBe(
      'not.in.(Alice)',
    )
    expect(filters(not(inArray(name, [null]))).get('name')).toBe('not.is.null')
  })

  test.each([like, ilike])(
    'preserves SQL wildcards and literal backslashes',
    (match) => {
      const op = match === like ? 'like' : 'ilike'
      expect(filters(match(name, 'A_%')).get('name')).toBe(`${op}.A_%`)
      expect(filters(not(match(name, 'a\\%'))).get('name')).toBe(
        `not.${op}.a\\\\%`,
      )
    },
  )

  test.each([
    ['computed OR', or(eq(active, true), eq(upper(name), 'ALICE'))],
    ['computed NOT AND', not(and(eq(active, true), eq(upper(name), 'ALICE')))],
    ['literal asterisk', like(name, '*Ali*')],
    ['negated literal asterisk', not(ilike(name, '*Ali*'))],
  ])('drops unpushable %s, keeping the rest', (_, where) => {
    expect([...filters(and(gt(id, 0), where))]).toEqual([['id', 'gt.0']])
  })

  test('appends a single order direction', () => {
    expect(
      subsetParamsToSearch({ orderBy: [sort(id, 'asc')] }).get('order'),
    ).toBe('id.asc.nullslast')
    expect(
      subsetParamsToSearch({ orderBy: [sort(id, 'desc')] }).get('order'),
    ).toBe('id.desc.nullslast')
  })

  test('merges multiple order columns into one comma-joined value', () => {
    const search = subsetParamsToSearch({
      orderBy: [sort(id, 'asc'), sort(name, 'desc')],
    })
    expect(search.get('order')).toBe('id.asc.nullslast,name.desc.nullslast')
    expect(search.getAll('order')).toHaveLength(1)
  })

  test('appends limit', () => {
    expect(subsetParamsToSearch({ limit: 10 }).get('limit')).toBe('10')
  })

  test('merges duplicate top-level IN demands without mutating the input', () => {
    const where = and(inArray(id, [1, 2]), inArray(id, [2, 3]))
    const before = JSON.stringify(where)
    expect(subsetParamsToSearch({ where }).getAll('id')).toEqual(['in.(1,2,3)'])
    expect(JSON.stringify(where)).toBe(before)
  })

  test('excludes select, offset, and cursor (pagination/request details)', () => {
    const search = subsetParamsToSearch({
      where: eq(id, 1),
      limit: 5,
      offset: 99,
      cursor: { whereFrom: gt(id, 1), whereCurrent: eq(id, 1) },
    })
    expect(search.get('id')).toBe('eq.1')
    expect(search.get('limit')).toBe('5')
    expect(search.has('select')).toBe(false)
    expect(search.has('offset')).toBe(false)
    // The cursor's `gt(id, 1)` must not leak in as an id filter.
    expect(search.getAll('id')).toEqual(['eq.1'])
  })
})

// ── loadSubsetOptionsToSearch ───────────────────────────────────────
describe('loadSubsetOptionsToSearch', () => {
  test('always requests all columns', () => {
    expect(loadSubsetOptionsToSearch({}).get('select')).toBe('*')
  })

  test('empty options produce only select=*', () => {
    expect([...loadSubsetOptionsToSearch({})]).toEqual([['select', '*']])
  })

  test('includes where, order and limit from the subset params', () => {
    const search = loadSubsetOptionsToSearch({
      where: eq(id, 1),
      orderBy: [sort(id, 'asc')],
      limit: 5,
    })
    expect(search.get('id')).toBe('eq.1')
    expect(search.get('order')).toBe('id.asc.nullslast')
    expect(search.get('limit')).toBe('5')
  })

  test('appends offset independently of limit', () => {
    const search = loadSubsetOptionsToSearch({ offset: 20 })
    expect(search.get('offset')).toBe('20')
    expect(search.has('limit')).toBe(false)
  })

  test('appends cursor filters: quotes IN members, leaves scalars raw', () => {
    const search = loadSubsetOptionsToSearch({
      cursor: {
        whereFrom: and(inArray(name, ['a,b', 'c']), gt(id, 5)),
        whereCurrent: eq(id, 5),
      },
    })
    expect(search.get('name')).toBe('in.("a,b",c)')
    expect(search.get('id')).toBe('gt.5')
  })

  test('honours the cursor and skips offset when both are present', () => {
    const search = loadSubsetOptionsToSearch({
      orderBy: [sort(id, 'asc')],
      limit: 20,
      offset: 20,
      cursor: { whereFrom: gt(id, 40), whereCurrent: eq(id, 40) },
    })
    expect(search.get('id')).toBe('gt.40')
    expect(search.get('limit')).toBe('20')
    expect(search.has('offset')).toBe(false)
  })

  test('renders a composite multi-column cursor without throwing', () => {
    const a = col('a')
    const b = col('b')
    const build = () =>
      loadSubsetOptionsToSearch({
        orderBy: [sort(a, 'asc'), sort(b, 'asc')],
        limit: 20,
        cursor: {
          whereFrom: or(gt(a, 1), and(eq(a, 1), gt(b, 2))),
          whereCurrent: eq(a, 1),
        },
      })
    expect(build).not.toThrow()
    expect(build().get('or')).toBe('(a.gt.1,and(a.eq.1,b.gt.2))')
  })

  test('serialises a Date cursor boundary as ISO 8601', () => {
    const createdAt = col('created_at')
    const boundary = new Date('2024-01-01T00:00:00.000Z')
    const search = loadSubsetOptionsToSearch({
      orderBy: [sort(createdAt, 'asc')],
      limit: 20,
      cursor: {
        whereFrom: gt(createdAt, boundary),
        whereCurrent: eq(createdAt, boundary),
      },
    })
    expect(search.get('created_at')).toBe('gt.2024-01-01T00:00:00.000Z')
  })
})

// ── cursorCurrentToSearch ───────────────────────────────────────────
describe('cursorCurrentToSearch', () => {
  test('returns null without a cursor', () => {
    expect(cursorCurrentToSearch({ where: eq(id, 1) })).toBeNull()
  })

  test('renders where + order + whereCurrent, never limit', () => {
    const search = cursorCurrentToSearch({
      where: eq(active, true),
      orderBy: [sort(id, 'asc')],
      limit: 20,
      cursor: { whereFrom: gt(id, 40), whereCurrent: eq(id, 40) },
    })
    expect(search?.get('active')).toBe('eq.true')
    expect(search?.get('order')).toBe('id.asc.nullslast')
    expect(search?.get('id')).toBe('eq.40')
    expect(search?.has('limit')).toBe(false)
  })
})

// ── keyColumnsToSearch ──────────────────────────────────────────────
describe('keyColumnsToSearch', () => {
  test('serializes Date keys as ISO timestamps', () => {
    const timestamp = new Date('2024-01-01T12:30:00.123Z')
    const search = keyColumnsToSearch(['recorded_at'], {
      recorded_at: timestamp,
    })

    expect(search.get('recorded_at')).toBe('eq.2024-01-01T12:30:00.123Z')
  })

  test('serializes Date values in composite keys without changing other keys', () => {
    const search = keyColumnsToSearch(['sensor_id', 'recorded_at'], {
      sensor_id: 'east,1',
      recorded_at: new Date('2024-01-01T14:30:00.123+02:00'),
    })

    expect([...search]).toEqual([
      ['sensor_id', 'eq.east,1'],
      ['recorded_at', 'eq.2024-01-01T12:30:00.123Z'],
    ])
  })

  test('builds an eq filter for a single key column', () => {
    expect(keyColumnsToSearch(['id'], { id: 1, name: 'x' }).get('id')).toBe(
      'eq.1',
    )
  })

  test('builds one eq filter per composite key, preserving order', () => {
    const search = keyColumnsToSearch(['user_id', 'todo_id'], {
      user_id: 1,
      todo_id: 2,
      title: 'ignored',
    })
    expect(search.get('user_id')).toBe('eq.1')
    expect(search.get('todo_id')).toBe('eq.2')
    expect([...search.keys()]).toEqual(['user_id', 'todo_id'])
  })
})

// ── subsetOptionsToQueryKey ─────────────────────────────────────────
describe('queryIrToSearch', () => {
  const table = { type: 'table', name: 'users', alias: 'user' } as const
  const build = (ir: Parameters<typeof queryIrToSearch>[0]) =>
    queryIrToSearch(ir)

  test('resolves the base table name', () => {
    expect(build({ from: table }).tableName).toBe('users')
  })

  test('builds an explicit select list and renames columns', () => {
    expect(
      build({
        from: table,
        select: {
          id: { type: 'ref', path: ['user', 'id'] },
          alias: { type: 'ref', path: ['user', 'name'] },
        },
      }).search.get('select'),
    ).toBe('id,alias:name')
  })

  test('falls back to select=* for non-pushable select expressions', () => {
    expect(
      build({
        from: table,
        select: {
          upper: {
            type: 'func',
            name: 'upper',
            args: [{ type: 'ref', path: ['user', 'name'] }],
          },
        },
      }).search.get('select'),
    ).toBe('*')
  })

  test('pushes where filters, stripping the table alias', () => {
    expect(
      build({ from: table, where: [eq(userCol('active'), true)] }).search.get(
        'active',
      ),
    ).toBe('eq.true')
  })

  test.each([
    [
      'computed OR',
      or(eq(userCol('active'), true), eq(upper(userCol('name')), 'A')),
    ],
    ['literal asterisk', like(userCol('name'), '*Ali*')],
  ])('throws on non-pushable %s (strict)', (_, where) => {
    expect(() => build({ from: table, where: [where] })).toThrow(
      'fully pushable filters',
    )
  })

  test('does not merge duplicate IN demands', () => {
    expect(
      build({
        from: table,
        where: [inArray(userCol('id'), [1, 2]), inArray(userCol('id'), [2, 3])],
      }).search.getAll('id'),
    ).toEqual(['in.(1,2)', 'in.(2,3)'])
  })

  test('orders by real columns and skips computed/$selected refs', () => {
    const search = build({
      from: table,
      orderBy: [
        {
          expression: { type: 'ref', path: ['user', 'id'] },
          direction: 'asc',
          nulls: 'last',
        },
        {
          expression: { type: 'ref', path: ['$selected', 'score'] },
          direction: 'desc',
          nulls: 'last',
        },
        {
          expression: { type: 'ref', path: ['user', 'name'] },
          direction: 'desc',
          nulls: 'first',
        },
      ],
    }).search
    expect(search.get('order')).toBe('id.asc.nullslast,name.desc.nullsfirst')
  })

  test('emits offset independently of limit', () => {
    const search = build({ from: table, offset: 20 }).search
    expect(search.get('offset')).toBe('20')
    expect(search.has('limit')).toBe(false)
  })

  test("pushes a subquery FROM's where down and resolves the base table", () => {
    const { tableName, search } = build({
      from: {
        type: 'subquery',
        alias: 'activeUser',
        query: { from: table, where: [eq(userCol('active'), true)] },
      },
    })
    expect(tableName).toBe('users')
    expect(search.get('active')).toBe('eq.true')
  })

  test('skips residual (client-side) where clauses', () => {
    const search = build({
      from: table,
      where: [{ expression: eq(userCol('id'), 1), residual: true }],
    }).search
    expect(search.has('id')).toBe(false)
  })
})

// ── subsetOptionsToQueryKey ─────────────────────────────────────────
describe('subsetOptionsToQueryKey', () => {
  const key = (where: IR.BasicExpression<boolean>) =>
    subsetOptionsToQueryKey('users', { where })

  test('collapses to [tableName] when nothing is pushable', () => {
    expect(key(or(eq(name, 'Alice'), eq(upper(name), 'BOB')))).toEqual([
      'users',
    ])
  })

  test('literal query delimiters cannot collide with extra filters', () => {
    expect(key(eq(name, 'Alice&active=eq.true'))).not.toEqual(
      key(and(eq(name, 'Alice'), eq(active, true))),
    )
  })

  test('distinguishes NOT, OR branches, and IN list boundaries', () => {
    expect(key(eq(name, 'Alice'))).not.toEqual(key(not(eq(name, 'Alice'))))
    expect(key(or(eq(name, 'Alice'), eq(active, true)))).not.toEqual(
      key(or(eq(name, 'Bob'), eq(active, true))),
    )
    expect(key(inArray(name, ['a,b', 'c']))).not.toEqual(
      key(inArray(name, ['a', 'b,c'])),
    )
  })

  test('uses the merged IN request', () => {
    expect(
      key(and(inArray(name, ['a', 'b']), inArray(name, ['b', 'c']))),
    ).toEqual(key(inArray(name, ['a', 'b', 'c'])))
  })

  test('gives distinct cursor windows of one subset distinct keys', () => {
    const base = { orderBy: [sort(id, 'asc')], limit: 20 }
    const page2 = subsetOptionsToQueryKey('users', {
      ...base,
      cursor: { whereFrom: gt(id, 20), whereCurrent: eq(id, 20) },
    })
    const page3 = subsetOptionsToQueryKey('users', {
      ...base,
      cursor: { whereFrom: gt(id, 40), whereCurrent: eq(id, 40) },
    })
    expect(page2).not.toEqual(page3)
    // The prefix stays `[tableName]` so realtime keeps matching every window.
    expect(page2[0]).toBe('users')
    expect(page3[0]).toBe('users')
  })

  test('gives distinct offset windows of one subset distinct keys', () => {
    const base = { orderBy: [sort(id, 'asc')], limit: 20 }
    expect(
      subsetOptionsToQueryKey('users', { ...base, offset: 20 }),
    ).not.toEqual(subsetOptionsToQueryKey('users', { ...base, offset: 40 }))
  })

  test('gives distinct multi-column cursor windows distinct keys', () => {
    const a = col('a')
    const b = col('b')
    const base = { orderBy: [sort(a, 'asc'), sort(b, 'asc')], limit: 20 }
    const page2 = subsetOptionsToQueryKey('users', {
      ...base,
      cursor: {
        whereFrom: or(gt(a, 1), and(eq(a, 1), gt(b, 2))),
        whereCurrent: eq(a, 1),
      },
    })
    const page3 = subsetOptionsToQueryKey('users', {
      ...base,
      cursor: {
        whereFrom: or(gt(a, 3), and(eq(a, 3), gt(b, 4))),
        whereCurrent: eq(a, 3),
      },
    })
    expect(page2).not.toEqual(page3)
    expect(page2[0]).toBe('users')
    expect(page3[0]).toBe('users')
  })

  test('keeps limit: 0 distinct from an unlimited subset', () => {
    const zero = subsetOptionsToQueryKey('users', {
      where: eq(id, 1),
      limit: 0,
    })
    const unlimited = subsetOptionsToQueryKey('users', { where: eq(id, 1) })
    expect(zero).not.toEqual(unlimited)
    expect(new URLSearchParams(zero[1]).get('limit')).toBe('0')
  })
})
