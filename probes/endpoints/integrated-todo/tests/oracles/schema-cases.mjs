import fc from 'fast-check'
const text = fc.stringOf(fc.constantFrom('a', 'é', ' ', '"', '界'), {
  maxLength: 12,
})
const step = fc.record({
  kind: fc.constantFrom('insert', 'edit', 'complete', 'delete'),
  target: fc.nat(5),
  slot: fc.nat(3),
  text,
  rank: fc.nat(5),
  outcome: fc.constantFrom('success', 'reject'),
  cross: fc.boolean(),
  failAfterCommit: fc.boolean(),
})

// Derive names, constraints, references, queries and rows after shrinking the
// schema choices; no dangling foreign keys or expressions survive a shrink.
export function materialize(spec) {
  const tables = spec.shapes.map((shape, index) => ({
    name: `relation_${index}_${shape.suffix}`,
    columns: shape.columns.map((column, i) => ({
      ...column,
      name: `field_${i}_${column.type}`,
    })),
    parent: index > 0 && shape.related ? 0 : null,
  }))
  const queries = tables.flatMap((table, index) => {
    const column = table.columns[0]
    const leaf = {
      op:
        column.type === 'integer'
          ? (spec.integerOp ?? 'gt')
          : (spec.equalityOp ?? 'eq'),
      column: column.name,
      value:
        column.type === 'integer' ? 0 : column.type === 'boolean' ? true : 'a',
    }
    const predicate = spec.nullMode
      ? { op: 'or', args: [leaf, { op: 'isNull', column: column.name }] }
      : { op: 'and', args: [leaf, { op: 'isNotNull', column: column.name }] }
    return [
      { table: index, predicate: null },
      { table: index, predicate },
    ]
  })
  const initial = tables.flatMap((table) =>
    ['alice', 'bob'].flatMap((scope) =>
      [0, 1, 2].map((index) => ({
        table: table.name,
        id: scope + '-' + index,
        text: spec.payload ?? `row-${index}`,
        completed: index === 1,
        createdAt: new Date(
          Date.UTC(2026, 0, 1, 0, 0, index % 2),
        ).toISOString(),
        scope,
        ...Object.fromEntries(
          table.columns.map((column) => [
            column.name,
            column.nullable && index === 0
              ? null
              : column.type === 'integer'
                ? [0, -1, 2][index]
                : column.type === 'boolean'
                  ? index !== 1
                  : ['a', 'b', 'é'][index],
          ]),
        ),
        ...(table.parent === null ? {} : { parentId: scope + '-' + index }),
      })),
    ),
  )
  return {
    tables,
    queries,
    scope: spec.scope,
    orders: queries.map((_, i) =>
      i % 2 ? ['id', 'createdAt'] : ['createdAt', 'id'],
    ),
    initial,
  }
}
export const schemaScenario = (sequences, steps) =>
  fc
    .record({
      shapes: fc.array(
        fc.record({
          suffix: fc.nat(9),
          related: fc.boolean(),
          columns: fc.array(
            fc.record({
              type: fc.constantFrom('integer', 'text', 'boolean'),
              nullable: fc.boolean(),
            }),
            { minLength: 1, maxLength: 3 },
          ),
        }),
        { minLength: 2, maxLength: 3 },
      ),
      scope: fc.constantFrom('alice', 'bob'),
      nullMode: fc.boolean(),
      integerOp: fc.constantFrom('eq', 'ne', 'gt', 'gte', 'lt', 'lte'),
      equalityOp: fc.constantFrom('eq', 'ne'),
      sequences: fc.array(
        fc.array(step, { minLength: steps, maxLength: steps }),
        { minLength: sequences, maxLength: sequences },
      ),
    })
    .map((spec) => ({ program: materialize(spec), sequences: spec.sequences }))

export const controls = {
  program: materialize({
    scope: 'alice',
    nullMode: true,
    shapes: [
      {
        suffix: 0,
        related: false,
        columns: [
          { type: 'integer', nullable: true },
          { type: 'text', nullable: true },
          { type: 'boolean', nullable: false },
        ],
      },
      {
        suffix: 1,
        related: true,
        columns: [
          { type: 'boolean', nullable: true },
          { type: 'integer', nullable: false },
        ],
      },
    ],
  }),
  sequences: [
    [
      {
        kind: 'edit',
        target: 0,
        slot: 0,
        text: '  corrected  ',
        rank: 4,
        outcome: 'success',
        cross: true,
      },
      {
        kind: 'delete',
        target: 0,
        slot: 1,
        text: 'delete parent',
        rank: 1,
        outcome: 'success',
      },
      {
        kind: 'insert',
        target: 1,
        slot: 0,
        text: 'new child',
        rank: 0,
        outcome: 'success',
      },
      {
        kind: 'edit',
        target: 1,
        slot: 0,
        text: 'commit then fail',
        rank: 5,
        outcome: 'success',
        cross: true,
        failAfterCommit: true,
      },
      {
        kind: 'complete',
        target: 0,
        slot: 0,
        text: 'rollback',
        rank: 1,
        outcome: 'reject',
      },
    ],
  ],
}
