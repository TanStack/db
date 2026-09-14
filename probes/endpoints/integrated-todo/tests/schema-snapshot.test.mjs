import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { inspectSchema, schemaFootprint } from '../schema-snapshot.mjs'

test('catalog footprints follow transitive FK actions and stop at unknown recipients', async () => {
  const pg = new PGlite()
  try {
    await pg.exec(
      `CREATE TABLE a(id text PRIMARY KEY);CREATE TABLE b(id text PRIMARY KEY REFERENCES a(id) ON DELETE CASCADE);CREATE TABLE c(id text PRIMARY KEY,parent text REFERENCES b(id) ON DELETE SET NULL)`,
    )
    let snapshot = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    const target = [{ schema: 'public', name: 'a' }]
    assert.deepEqual(schemaFootprint(snapshot, target, 'delete'), [
      '["public","a"]',
      '["public","b"]',
      '["public","c"]',
    ])
    assert.deepEqual(schemaFootprint(snapshot, target, 'update'), [
      '["public","a"]',
    ])
    assert.deepEqual(schemaFootprint(snapshot, target, 'insert'), [
      '["public","a"]',
    ])
    await pg.exec(
      `CREATE FUNCTION opaque() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER opaque AFTER UPDATE ON c FOR EACH ROW EXECUTE FUNCTION opaque()`,
    )
    snapshot = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    assert.equal(schemaFootprint(snapshot, target, 'delete'), null)
  } finally {
    await pg.close()
  }
})

test('policies, views, custom types, defaults and generated values keep the fallback', async () => {
  const pg = new PGlite()
  try {
    await pg.exec(`CREATE TABLE protected(id text PRIMARY KEY);ALTER TABLE protected ENABLE ROW LEVEL SECURITY;
      CREATE VIEW opaque AS SELECT * FROM protected;
      CREATE DOMAIN custom AS integer;CREATE TABLE custom_values(id text PRIMARY KEY,value custom);
      CREATE FUNCTION hidden_default() RETURNS integer LANGUAGE SQL AS 'SELECT 1';
      CREATE TABLE defaults(id text PRIMARY KEY,value integer DEFAULT hidden_default());
      CREATE TABLE generated(id text PRIMARY KEY,value integer,twice integer GENERATED ALWAYS AS (value*2) STORED);
      CREATE TABLE checked(id text PRIMARY KEY,value integer CHECK(value>0));
      CREATE FUNCTION opaque_index(integer) RETURNS integer LANGUAGE SQL IMMUTABLE AS 'SELECT $1+1';
      CREATE TABLE indexed(id text PRIMARY KEY,value integer);CREATE INDEX expression_index ON indexed(opaque_index(value))`)
    const snapshot = await inspectSchema(
      (sql) => pg.query(sql),
      'src/database.server.ts',
    )
    for (const name of [
      'protected',
      'opaque',
      'custom_values',
      'generated',
      'checked',
      'indexed',
      'missing',
    ]) {
      assert.equal(
        schemaFootprint(snapshot, [{ schema: 'public', name }], 'select'),
        null,
        name,
      )
      assert.equal(
        schemaFootprint(snapshot, [{ schema: 'public', name }], 'update'),
        null,
        name,
      )
    }
    assert.deepEqual(
      schemaFootprint(snapshot, [{ name: 'defaults' }], 'select'),
      ['["public","defaults"]'],
    )
    assert.equal(
      schemaFootprint(snapshot, [{ name: 'defaults' }], 'insert'),
      null,
    )
  } finally {
    await pg.close()
  }
})
