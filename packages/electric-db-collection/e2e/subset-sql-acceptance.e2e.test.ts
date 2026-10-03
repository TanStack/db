import { ShapeStream } from '@electric-sql/client'
import { IR } from '@tanstack/db'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import { compileSQL } from '../src/sql-compiler'
import type { SubsetParams } from '@electric-sql/client'
import type { Client } from 'pg'

type TestRow = Record<string, unknown> & { id: number }

describe(`Electric subset SQL acceptance`, () => {
  let client: Client
  let baseUrl: string
  let schema: string
  let table: string
  let qualifiedTable: string

  const ref = (column: string) => new IR.PropRef([column])
  const call = (name: string, ...args: Array<IR.BasicExpression>) =>
    new IR.Func<boolean>(name, args)

  async function selectedIds(params: SubsetParams): Promise<Array<number>> {
    const stream = new ShapeStream<TestRow>({
      url: `${baseUrl}/v1/shape`,
      params: { table: qualifiedTable },
      log: `changes_only`,
    })
    const snapshot = await stream.fetchSnapshot(params)
    return snapshot.data.map(({ value }) => value.id)
  }

  beforeAll(async () => {
    baseUrl = inject(`baseUrl`)
    schema = inject(`testSchema`)
    table = `subset_sql_acceptance_${Date.now().toString(16)}`
    qualifiedTable = `${schema}.${table}`
    client = makePgClient()
    await client.connect()
    await client.query(
      `CREATE TABLE "${schema}"."${table}" (
        id INTEGER PRIMARY KEY,
        roles TEXT[],
        integer_roles INTEGER[],
        required_role VARCHAR(16)
      )`,
    )
    await client.query(
      `INSERT INTO "${schema}"."${table}" VALUES
        (1, ARRAY['admin'], ARRAY[1, 2], 'admin'),
        (2, ARRAY['viewer'], ARRAY[3], 'admin'),
        (3, NULL, NULL, NULL),
        (4, ARRAY[NULL]::TEXT[], ARRAY[NULL]::INTEGER[], 'admin')`,
    )
  })

  afterAll(async () => {
    await client.query(`DROP TABLE IF EXISTS "${schema}"."${table}"`)
    await client.end()
  })

  it(`accepts generated plain-column predicates`, async () => {
    const equality = compileSQL({
      where: call(`eq`, ref(`id`), new IR.Value(1)),
    })
    expect(await selectedIds(equality)).toEqual([1])

    const textMembership = compileSQL({
      where: call(`in`, new IR.Value(`admin`), ref(`roles`)),
    })
    expect(await selectedIds(textMembership)).toEqual([1])
    expect(
      await selectedIds(
        compileSQL({
          where: call(`not`, call(`in`, new IR.Value(`admin`), ref(`roles`))),
          orderBy: [
            {
              expression: ref(`id`),
              compareOptions: { direction: `asc`, nulls: `last` },
            },
          ],
        }),
      ),
    ).toEqual([2, 3, 4])

    const integerMembership = compileSQL({
      where: call(`in`, new IR.Value(2), ref(`integer_roles`)),
    })
    expect(await selectedIds(integerMembership)).toEqual([1])
  })

  it(`preserves compatible ref-to-array membership`, async () => {
    const membership = compileSQL({
      where: call(`in`, ref(`required_role`), ref(`roles`)),
    })
    const ids = await selectedIds(membership)
    expect(membership.where).toBe(`"required_role" = ANY("roles")`)
    expect(ids).toEqual([1])
  })

  it(`accepts generated plain-column ordering`, async () => {
    const ordered = compileSQL({
      orderBy: [
        {
          expression: ref(`id`),
          compareOptions: { direction: `desc`, nulls: `last` },
        },
      ],
      limit: 2,
    })
    expect(await selectedIds(ordered)).toEqual([4, 3])
  })
})
