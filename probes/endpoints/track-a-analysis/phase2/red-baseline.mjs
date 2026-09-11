// Baseline intentionally retains phase 1's narrow schema checking for red tests.
import { extract, check } from '../probe.mjs'
export async function inspectSchema(pg) {
 return (await pg.query(`SELECT attname AS name, format_type(atttypid,atttypmod) AS type, attnotnull AS "notNull" FROM pg_attribute WHERE attrelid='public.todo'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows
}
export function checkSql(input, context) {
 if (!input.drizzleSource) return {status:'not checked',code:'SQL_ADAPTER_MISSING'}
 return check(extract(input.drizzleSource),context.indexes)
}
