// Ordinary PostgreSQL compiler checks for boolean grouping beneath a comparison and
// array membership. The predicate meaning law (selected IDs match a finite
// three-valued evaluator) is owned by sql-predicate-semantics-oracle.e2e.test.ts.
import { IR } from '@tanstack/db'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { compileSQL } from '../src/sql-compiler'
import type { Client } from 'pg'

type Row = {
  id: number
  count: number | null
  label: string | null
  enabled: boolean | null
}

describe(`Electric predicate compiler semantics`, () => {
  let client: Client
  let table: string

  beforeAll(async () => {
    client = makePgClient()
    await client.connect()
    await client.query(`SET search_path TO ${inject(`testSchema`)}`)
    table = `predicate_semantics_${Date.now().toString(16)}`
    await client.query(
      `CREATE TABLE "${table}" (
        id INTEGER PRIMARY KEY,
        count INTEGER,
        label TEXT,
        enabled BOOLEAN,
        roles TEXT[],
        integer_roles INTEGER[],
        required_role VARCHAR(16)
      )`,
    )
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS "${table}"`)
    await client.end()
  })

  it(`preserves boolean grouping beneath a comparison`, async () => {
    const world: Array<Row> = [
      { id: 1, count: 0, label: null, enabled: true },
      { id: 2, count: 0, label: null, enabled: false },
      { id: 3, count: 0, label: null, enabled: null },
    ]
    await client.query(`TRUNCATE "${table}"`)
    for (const row of world) {
      await client.query(
        `INSERT INTO "${table}" (id, count, label, enabled) VALUES ($1, $2, $3, $4)`,
        [row.id, row.count, row.label, row.enabled],
      )
    }
    const compiled = compileSQL({
      where: new IR.Func(`eq`, [
        new IR.Func(`or`, [new IR.PropRef([`enabled`]), new IR.Value(false)]),
        new IR.Value(false),
      ]),
    })
    const result = await client.query<{ id: number }>(
      `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
      Object.values(compiled.params ?? {}),
    )

    expect(result.rows.map(({ id }) => id)).toEqual([2])
  })

  it(`preserves PostgreSQL array membership semantics`, async () => {
    await client.query(`TRUNCATE "${table}"`)
    await client.query(
      `INSERT INTO "${table}" (id, roles, integer_roles, required_role) VALUES
        (1, ARRAY['admin', 'editor'], ARRAY[1, 2], 'admin'),
        (2, ARRAY['viewer'], ARRAY[3], 'admin'),
        (3, NULL, NULL, NULL),
        (4, ARRAY[NULL]::TEXT[], ARRAY[NULL]::INTEGER[], 'admin')`,
    )

    const ref = (column: string) => new IR.PropRef([column])
    const call = (name: string, ...args: Array<IR.BasicExpression>) =>
      new IR.Func<boolean>(name, args)
    const selectedIds = async (
      where: IR.BasicExpression<boolean>,
    ): Promise<Array<number>> => {
      const compiled = compileSQL({ where })
      const params = Object.entries(compiled.params ?? {})
        .sort(([left], [right]) => Number(left) - Number(right))
        .map(([, value]) => value)
      const result = await client.query<{ id: number }>(
        `SELECT id FROM "${table}" WHERE ${compiled.where} ORDER BY id`,
        params,
      )
      return result.rows.map(({ id }) => id)
    }

    const integerMembership = call(`in`, new IR.Value(2), ref(`integer_roles`))
    expect(await selectedIds(integerMembership)).toEqual([1])
    expect(await selectedIds(call(`not`, integerMembership))).toEqual([2, 3, 4])
    expect(
      await selectedIds(call(`in`, ref(`required_role`), ref(`roles`))),
    ).toEqual([1])

    const reversedContainment = await client.query<{ id: number }>(
      `SELECT id FROM "${table}" WHERE ARRAY[$1] @> roles ORDER BY id`,
      [`admin`],
    )
    expect(reversedContainment.rows.map(({ id }) => id)).not.toEqual([1])
    await expect(
      client.query(
        `SELECT id FROM "${table}" WHERE integer_roles @> ARRAY[$1]`,
        [`2`],
      ),
    ).rejects.toMatchObject({ code: `42883` })
  })
})
