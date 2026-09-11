import { PGlite } from '@electric-sql/pglite'
import { inspectCatalog,todo } from '../probe.mjs'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { inspectSchema } from './checker.mjs'
// Bind both adapters' expected context to the SAME trusted Drizzle fixture schema.
// Normalize only the known PG timestamp spelling used by this schema.
export const expectedSchema=getTableConfig(todo).columns.map(column=>({
 name:column.name,type:column.getSQLType()==='timestamp'?'timestamp without time zone':column.getSQLType(),notNull:column.notNull,
}))
export async function fixtureContext() {
 const pg=new PGlite()
 try {
  await pg.exec('CREATE TABLE todo(id text PRIMARY KEY,text text NOT NULL,completed boolean NOT NULL,created_at timestamp NOT NULL,user_id text NOT NULL)')
  return {schema:await inspectSchema(pg),indexes:await inspectCatalog(pg,'todo'),expectedSchema,schemaIdentity:'disposable-public-todo',databaseVersion:(await pg.query('SELECT version()')).rows[0].version}
 } finally {await pg.close()}
}
