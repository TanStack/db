// @vitest-environment node
/**
 * Scenario checks for SQLite boolean-arity reads: a large string-ID OR scope
 * stays selective, and bound string membership avoids discarded quoting. The
 * boolean-arity oracle in `sqlite-boolean-arity-oracle.test.ts` owns the law.
 */
import { expect, it, vi } from 'vitest'
import { IR } from '@tanstack/db'
import { SQLiteCorePersistenceAdapter, createPersistedTableName } from '../src'
import { CountingDriver } from './sqlite-boolean-arity-support'

it('keeps large string-ID OR scopes selective at the SQLite boundary', async () => {
  const driver = new CountingDriver()
  const adapter = new SQLiteCorePersistenceAdapter({ driver })
  const collectionId = 'string-id-scope'
  const scopeRows = Array.from({ length: 20 }, (_, index) => ({
    issueId: `issue-${index}`,
    relatedIssueId:
      ['related-\uD800', 'related-\u0000', 'related-😀'][index] ??
      `related-${index}`,
  }))
  const ids = Array.from({ length: 50_582 }, (_, index) => `other-${index}`)
  ids[5_001] = 'related-\uD800'
  ids[25_291] = 'issue-1'
  ids[35_001] = 'related-\u0000'
  ids[45_001] = 'related-😀'
  const allowed = new Set(ids)

  try {
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: collectionId },
      {
        txId: 'seed-string-scope',
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: scopeRows.map((row) => ({
          type: 'insert' as const,
          key: row.issueId,
          value: structuredClone(row),
        })),
      },
    )
    for (const field of ['issueId', 'relatedIssueId']) {
      await adapter.ensureIndex(
        { kind: `eager`, collectionId: collectionId },
        field,
        {
          expressionSql: [JSON.stringify(new IR.PropRef([field]))],
        },
      )
    }

    driver.reads = []
    const rows = await adapter.loadSubset(
      { kind: `eager`, collectionId: collectionId },
      {
        where: new IR.Func('and', [
          new IR.Func('or', [
            new IR.Func('in', [new IR.PropRef(['issueId']), new IR.Value(ids)]),
            new IR.Func('in', [
              new IR.PropRef(['relatedIssueId']),
              new IR.Value(ids),
            ]),
          ]),
        ]),
      },
    )
    const expected = scopeRows
      .filter(
        (row) => allowed.has(row.issueId) || allowed.has(row.relatedIssueId),
      )
      .map((row) => row.issueId)
    expect(rows.map((row) => row.key).sort()).toEqual(expected.sort())
    expect(driver.reads).toHaveLength(1)
    expect(driver.reads[0]?.rawRows).toBe(expected.length)
    expect(driver.reads[0]?.parameters).toBe(2)
    const plan = driver.db
      .prepare(`EXPLAIN QUERY PLAN ${driver.reads[0]!.sql}`)
      .all(JSON.stringify(ids), JSON.stringify(ids)) as Array<{
      detail: string
    }>
    const tableName = createPersistedTableName(collectionId, 'c')
    expect(
      plan.some(
        ({ detail }) =>
          detail.startsWith(`SCAN ${tableName}`) ||
          detail.startsWith(`SCAN "${tableName}"`),
      ),
    ).toBe(false)
    for (const field of ['issueId', 'relatedIssueId']) {
      const index = driver.db
        .prepare(
          `SELECT index_name FROM persisted_index_registry WHERE collection_id = ? AND signature = ?`,
        )
        .get(collectionId, field) as { index_name: string }
      expect(
        plan.some(
          ({ detail }) =>
            detail.startsWith('SEARCH') && detail.includes(index.index_name),
        ),
      ).toBe(true)
    }
  } finally {
    driver.db.close()
  }
})

// Ordinary runtime membership transports its list through one JSON binding.
// The independent work rule therefore permits zero SQL-literal quoting of list
// values. Counting the quoting primitive detects discarded construction that
// cannot be seen in the final SQL. The original compiler performs two quotes
// per value; exact result and binding checks retain the receiving contract.
// A sequential index-expression control proves the sensor still sees quoting
// before the bound-path counter resets; changing the primitive cannot pass silently.
it.sequential.each([0, 1, 32, 1_025])(
  'avoids discarded literal quoting for bound string membership / %i',
  async (size) => {
    const driver = new CountingDriver()
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    const values = Array.from({ length: size }, (_, index) => `work-${index}`)
    const control = 'quote-probe-control'
    const observedValues = new Set([...values, control])
    let quotedValues = 0
    const replace = String.prototype.replace
    const quoteProbe = vi
      .spyOn(String.prototype, 'replace')
      .mockImplementation(function (
        this: string,
        ...args: Parameters<typeof replace>
      ) {
        if (observedValues.has(String(this))) quotedValues++
        return Reflect.apply(replace, this, args)
      })
    try {
      await adapter.applyCommittedTx(
        { kind: `eager`, collectionId: 'string-membership-work' },
        {
          txId: 'seed',
          term: 1,
          seq: 1,
          rowVersion: 1,
          mutations: [
            { type: 'insert', key: 'match', value: { value: 'work-0' } },
            { type: 'insert', key: 'other', value: { value: 'outside' } },
          ],
        },
      )
      // An index literal must reach the probe, even for an empty bound list.
      await adapter.ensureIndex(
        { kind: `eager`, collectionId: 'string-membership-work' },
        'quote-control',
        {
          expressionSql: [
            JSON.stringify(
              new IR.Func('coalesce', [
                new IR.PropRef(['value']),
                new IR.Value(control),
              ]),
            ),
          ],
        },
      )
      expect(quotedValues).toBeGreaterThan(0)
      quotedValues = 0
      driver.reads = []
      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: 'string-membership-work' },
        {
          where: new IR.Func('in', [
            new IR.PropRef(['value']),
            new IR.Value(values),
          ]),
        },
      )
      expect(rows.map((row) => row.key)).toEqual(size === 0 ? [] : ['match'])
      expect(driver.reads).toHaveLength(1)
      expect(driver.reads[0]?.parameters).toBe(size === 0 ? 0 : 1)
      expect(quotedValues).toBe(0)
    } finally {
      quoteProbe.mockRestore()
      driver.db.close()
    }
  },
)
