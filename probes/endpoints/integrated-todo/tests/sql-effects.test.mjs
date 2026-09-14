import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import {
  inspectSqlEffects,
  analyzeSqlEffects,
  queryDependencies,
  mutationDependencies,
  canSkipRefetch,
} from '../sql-effects.mjs'

const id = (name) => JSON.stringify(['public', name])
const authority = { hasBaseline: true, optimistic: false, needsRepair: false }

test('native enum and clock or UUID defaults do not invent writes, while changing query values stay unknown', async () => {
  await fixture(
    `CREATE TYPE state AS ENUM ('ready','done');
    CREATE TABLE items(id uuid DEFAULT gen_random_uuid(), state state DEFAULT 'ready', created_at timestamptz DEFAULT now());`,
    async (pg, analyze) => {
      assert.deepEqual(queryDependencies(analyze('SELECT * FROM items')), [
        id('items'),
      ])
      assert.deepEqual(
        mutationDependencies(
          analyze("INSERT INTO items(state) VALUES('ready')"),
        ),
        [id('items')],
      )
      assert.equal(queryDependencies(analyze('SELECT now()')), null)
      assert.equal(queryDependencies(analyze('SELECT gen_random_uuid()')), null)
      await pg.exec('INSERT INTO items DEFAULT VALUES')
      const rows = (await pg.query('SELECT * FROM items')).rows
      assert.equal(rows[0].state, 'ready')
      assert.ok(rows[0].id)
      assert.ok(rows[0].created_at)
    },
  )
})
async function fixture(ddl, run) {
  const pg = new PGlite()
  let primary
  try {
    await pg.exec(ddl)
    const snapshot = await inspectSqlEffects((sql) => pg.query(sql), 'fixture')
    await run(pg, (sql) => analyzeSqlEffects(sql, snapshot), snapshot)
  } catch (error) {
    primary = error
    throw error
  } finally {
    try {
      await pg.close()
    } catch (cleanup) {
      if (primary) primary.cleanup = cleanup
      else throw cleanup
    }
  }
}

test('SQL bodies retain hidden reads through recursive calls and misleading volatility labels', async () => {
  await fixture(
    `CREATE TABLE facts(value integer); INSERT INTO facts VALUES(11);
    CREATE FUNCTION recur(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$SELECT CASE WHEN $1>0 THEN recur($1 - 1) ELSE (SELECT value FROM facts) END$$;`,
    async (pg, analyze) => {
      for (let depth = 0; depth <= 5; depth++) {
        const sql = `SELECT recur(${depth}) AS value`
        assert.deepEqual((await pg.query(sql)).rows, [{ value: 11 }])
        assert.deepEqual(queryDependencies(analyze(sql)), [id('facts')])
      }
    },
  )
})

test('defaults contribute writes only when selected, including positional omission and upsert DEFAULT', async () => {
  await fixture(
    `CREATE TABLE audit(value integer); INSERT INTO audit VALUES(0);
    CREATE FUNCTION record_default() RETURNS integer LANGUAGE sql AS $$UPDATE audit SET value=value+1; SELECT 3$$;
    CREATE TABLE items(id text PRIMARY KEY,value integer DEFAULT record_default());`,
    async (pg, analyze) => {
      const steps = [
        ["INSERT INTO items VALUES('a',8)", false],
        ["INSERT INTO items VALUES('b')", true],
        ["INSERT INTO items(id) VALUES('c')", true],
        ["UPDATE items SET value=9 WHERE id='b'", false],
        ["UPDATE items SET value=DEFAULT WHERE id='b'", true],
        [
          "INSERT INTO items VALUES('a',8) ON CONFLICT(id) DO UPDATE SET value=DEFAULT",
          true,
        ],
      ]
      let count = 0
      for (const [sql, invokes] of steps) {
        const effects = analyze(sql)
        assert.deepEqual(
          mutationDependencies(effects),
          invokes ? [id('audit'), id('items')] : [id('items')],
        )
        await pg.exec(sql)
        count += Number(invokes)
        assert.deepEqual((await pg.query('SELECT value FROM audit')).rows, [
          { value: count },
        ])
      }
      assert.deepEqual(queryDependencies(analyze('SELECT * FROM items')), [
        id('items'),
      ])
    },
  )
})

test('foreign key effects follow the event and changed key rather than predicate reads', async () => {
  for (const action of ['CASCADE', 'SET NULL', 'SET DEFAULT'])
    await fixture(
      `
    CREATE TABLE parent(id integer PRIMARY KEY,value integer); INSERT INTO parent VALUES(1,1);
    CREATE TABLE child(id integer PRIMARY KEY,parent_id integer REFERENCES parent(id) ON UPDATE ${action} ON DELETE ${action}); INSERT INTO child VALUES(1,1);`,
      async (pg, analyze) => {
        assert.deepEqual(
          mutationDependencies(analyze('UPDATE parent SET value=2')),
          [id('parent')],
        )
        const update = 'UPDATE parent SET id=2 WHERE id=1'
        assert.deepEqual(mutationDependencies(analyze(update)), [
          id('child'),
          id('parent'),
        ])
        await pg.exec(update)
        assert.deepEqual((await pg.query('SELECT parent_id FROM child')).rows, [
          { parent_id: action === 'CASCADE' ? 2 : null },
        ])
        const remove = 'DELETE FROM parent WHERE id=2'
        assert.deepEqual(mutationDependencies(analyze(remove)), [
          id('child'),
          id('parent'),
        ])
        await pg.exec(remove)
        assert.deepEqual(
          (await pg.query('SELECT parent_id FROM child')).rows,
          action === 'CASCADE' ? [] : [{ parent_id: null }],
        )
      },
    )
})

test('unsupported procedural bodies are unknown at the call and trigger event, including zero-row writes', async () => {
  await fixture(
    `CREATE TABLE items(id integer); CREATE TABLE audit(value integer); INSERT INTO audit VALUES(0);
    CREATE FUNCTION hidden() RETURNS integer LANGUAGE plpgsql AS $$BEGIN EXECUTE 'UPDATE audit SET value=value+1'; RETURN 1; END$$;
    CREATE FUNCTION log_statement() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM hidden(); RETURN NULL; END$$;
    CREATE TRIGGER log_statement AFTER UPDATE ON items FOR EACH STATEMENT EXECUTE FUNCTION log_statement();`,
    async (pg, analyze) => {
      assert.deepEqual(queryDependencies(analyze('SELECT * FROM items')), [
        id('items'),
      ])
      assert.deepEqual(mutationDependencies(analyze('DELETE FROM items')), [
        id('items'),
      ])
      const write = analyze('UPDATE items SET id=2 WHERE false')
      assert.equal(mutationDependencies(write), null)
      assert.ok(
        write.unknown.some((item) => item.reason === 'Unresolved trigger body'),
      )
      await pg.exec('UPDATE items SET id=2 WHERE false')
      assert.deepEqual((await pg.query('SELECT value FROM audit')).rows, [
        { value: 1 },
      ])
      const call = analyze('SELECT hidden()')
      assert.equal(mutationDependencies(call), null)
      assert.ok(call.unknown.some((item) => item.source.startsWith('routine:')))
      assert.equal(
        canSkipRefetch(analyze('SELECT 1'), call, authority).verdict,
        'skip',
      )
      assert.equal(
        canSkipRefetch(analyze('SELECT 1'), call, {
          ...authority,
          optimistic: true,
        }).verdict,
        'refresh',
      )
    },
  )
})

test('stored generated values, checks, and SQL expression indexes preserve ordinary table effects', async () => {
  await fixture(
    `CREATE FUNCTION scalar(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1+1';
    CREATE TABLE items(id integer PRIMARY KEY,value integer CHECK(value>0),twice integer GENERATED ALWAYS AS(value*2) STORED);
    CREATE INDEX expression ON items(scalar(value)) WHERE value>0; INSERT INTO items(id,value) VALUES(1,3);`,
    async (pg, analyze) => {
      assert.deepEqual(queryDependencies(analyze('SELECT * FROM items')), [
        id('items'),
      ])
      assert.deepEqual(
        mutationDependencies(analyze('UPDATE items SET value=4')),
        [id('items')],
      )
      await pg.exec('UPDATE items SET value=4')
      assert.deepEqual((await pg.query('SELECT twice FROM items')).rows, [
        { twice: 8 },
      ])
    },
  )
})

test('complete overload unions retain every possible body and incompatible artifacts do not prove independence', async () => {
  await fixture(
    `CREATE TABLE a(value integer); INSERT INTO a VALUES(1); CREATE TABLE b(value integer); INSERT INTO b VALUES(2);
    CREATE FUNCTION overloaded(integer) RETURNS integer LANGUAGE sql AS 'SELECT value FROM a';
    CREATE FUNCTION overloaded(text) RETURNS integer LANGUAGE sql AS 'SELECT value FROM b';`,
    async (pg, analyze) => {
      const query = analyze('SELECT overloaded($1)')
      assert.deepEqual(queryDependencies(query), [id('a'), id('b')])
      assert.deepEqual((await pg.query('SELECT overloaded(1) AS value')).rows, [
        { value: 1 },
      ])
      assert.deepEqual(
        (await pg.query("SELECT overloaded('x'::text) AS value")).rows,
        [{ value: 2 }],
      )
      assert.equal(
        canSkipRefetch(
          query,
          { ...analyze('SELECT 1'), artifact: 'different' },
          authority,
        ).verdict,
        'unknown',
      )
    },
  )
})
