import { describe, expect, it } from 'vitest'
import { cloneQueryForPlacement } from '../../src/query/builder/clone-query.js'
import {
  Aggregate,
  CollectionRef,
  ConditionalSelect,
  Func,
  PropRef,
  Value,
} from '../../src/query/ir.js'
import type { QueryIR, Select } from '../../src/query/ir.js'

describe(`cloneQueryForPlacement`, () => {
  it.each([
    new PropRef([`u`, `name`]),
    new Func(`upper`, [new PropRef([`u`, `name`])]),
    new Aggregate(`count`, [new PropRef([`u`, `id`])]),
    new ConditionalSelect(
      [
        {
          condition: new Func(`eq`, [
            new PropRef([`u`, `active`]),
            new Value(true),
          ]),
          value: new Value(`active`),
        },
      ],
      new Value(`inactive`),
    ),
  ])(`preserves an immutable scalar select expression %#`, (select) => {
    const query: QueryIR = {
      from: new CollectionRef({} as never, `u`),
      select: select as unknown as Select,
    }

    const cloned = cloneQueryForPlacement(query)

    expect(cloned).not.toBe(query)
    expect(cloned.from).not.toBe(query.from)
    expect(cloned.select).toBe(select)
    expect(Object.getPrototypeOf(cloned.select)).toBe(
      Object.getPrototypeOf(select),
    )
  })
})
