/**
 * Unit checks for SQLite subset binding capacity. They compare with literal
 * expectations: the controlled driver rejects an over-cap statement, a cursor
 * request issues two bounded SELECTs and returns its literal row, and index
 * DDL keeps IN values as literals. The binding-capacity oracle in
 * sqlite-core-adapter-oracle.test.ts registers them in its suite, so their
 * names stay under that suite. They reach no model or check, so they are
 * supplemental coverage here.
 */
import assert from 'node:assert/strict'
import { IR } from '@tanstack/db'
import { expect, it } from 'vitest'
import { SQLiteCorePersistenceAdapter } from '../src'
import {
  BINDING_CAP,
  limitedDatabase,
  predicate,
  preparedDriver,
  single,
} from './sqlite-core-adapter-binding-support'
import type { Attempt } from './sqlite-core-adapter-binding-support'

async function runIndexContext() {
  const db = limitedDatabase()
  const attempts: Array<Attempt> = []
  try {
    const driver = preparedDriver(db, attempts)
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: 'oracle-index' },
      {
        txId: 'seed',
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: 'insert',
            key: 'target',
            value: { a: 'target', b: 'target' },
          },
        ],
      },
    )
    driver.startObservation()
    await adapter.ensureIndex(
      { kind: `eager`, collectionId: 'oracle-index' },
      'small-in-partial',
      {
        expressionSql: [JSON.stringify({ type: 'ref', path: ['a'] })],
        whereSql: JSON.stringify({
          type: 'func',
          name: 'in',
          args: [
            { type: 'ref', path: ['b'] },
            { type: 'val', value: ['target', 'other'] },
          ],
        }),
      },
    )
    await adapter.ensureIndex(
      { kind: `eager`, collectionId: 'oracle-index' },
      'small-in-expression',
      {
        expressionSql: [
          JSON.stringify({
            type: 'func',
            name: 'in',
            args: [
              { type: 'ref', path: ['a'] },
              { type: 'val', value: ['target', 'other'] },
            ],
          }),
        ],
      },
    )
    const ddl = attempts.filter(
      (entry) => entry.method === 'exec' && entry.sql.includes('CREATE INDEX'),
    )
    assert.equal(ddl.length, 2, 'both index-definition paths reached')
    for (const entry of ddl) {
      assert.ok(
        !entry.sql.includes('json_each') && !entry.sql.includes('?'),
        'index DDL must use literal values',
      )
      assert.ok(entry.sql.includes(`'target'`) && entry.sql.includes(`'other'`))
    }
  } finally {
    db.close()
  }
}

async function runCursorContext(): Promise<string | undefined> {
  const db = limitedDatabase()
  const attempts: Array<Attempt> = []
  let error: string | undefined
  let actual: Array<string> | undefined
  try {
    const driver = preparedDriver(db, attempts, true)
    const adapter = new SQLiteCorePersistenceAdapter({ driver })
    await adapter.applyCommittedTx(
      { kind: `eager`, collectionId: 'oracle-cursor' },
      {
        txId: 'seed',
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: [
          {
            type: 'insert',
            key: 'target',
            value: { a: 'target', b: 'target' },
          },
        ],
      },
    )
    driver.startObservation()
    try {
      const rows = await adapter.loadSubset(
        { kind: `eager`, collectionId: 'oracle-cursor' },
        {
          where: predicate(single('string', 999)),
          cursor: {
            whereCurrent: new IR.Func('eq', [
              new IR.PropRef(['a']),
              new IR.Value('target'),
            ]),
            whereFrom: new IR.Func('eq', [
              new IR.PropRef(['b']),
              new IR.Value('target'),
            ]),
          },
        },
      )
      actual = rows.map((row) => String(row.key))
    } catch (cause) {
      error = String(cause)
    }
  } finally {
    db.close()
  }
  const reads = attempts.filter(
    (entry) =>
      entry.method === 'query' &&
      entry.sql.startsWith('SELECT key, value, metadata, row_version'),
  )
  const counts = reads.map((entry) => entry.bindings)
  const problem =
    reads.length !== 2
      ? `expected two cursor SELECTs, got ${reads.length}`
      : counts.some((count) => count > BINDING_CAP)
        ? `two cursor SELECTs bind=${counts}; error=${error ?? 'none'}`
        : error
          ? `cursor load rejected ${error}`
          : actual?.join(',') !== 'target'
            ? `cursor rows=${actual}`
            : undefined
  return problem
}

export function runSQLiteBindingCapacityUnitTests(): void {
  it(`rejects over-cap bindings at the controlled driver boundary`, async () => {
    const db = limitedDatabase(100)
    try {
      const driver = preparedDriver(db, [], false, 100, false, true)
      const sql = `SELECT ${Array(101).fill('?').join(' + ')}`
      await expect(driver.query(sql, Array(101).fill(1))).rejects.toThrow(
        /host parameter limit exceeded: 101 > 100/,
      )
    } finally {
      db.close()
    }
  })

  it(`honors total capacity in each cursor SELECT`, async () => {
    expect(await runCursorContext()).toBeUndefined()
  })

  it(`keeps IN values literal in both index-definition contexts`, async () => {
    await runIndexContext()
  })
}
