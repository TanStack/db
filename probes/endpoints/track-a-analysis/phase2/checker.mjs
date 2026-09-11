import { createHash } from 'node:crypto'
import { parse } from 'pgsql-ast-parser'
import { classifyKey } from '../probe.mjs'
const gap=(code,reason)=>({status:'not checked',code,reason})
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
export async function inspectSchema(pg) {
 return (await pg.query(`SELECT attname AS name, format_type(atttypid,atttypmod) AS type, attnotnull AS "notNull" FROM pg_attribute WHERE attrelid='public.todo'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows
}
function ref(node) {return node?.type==='ref' && (!node.table || (node.table.name==='todo' && !node.table.schema)) && node.name!=='*'}
function allowedKeys(value,keys) {return Object.keys(value).every(key=>key==='_location'||keys.includes(key))}

// Both adapters call this SQL-only layer. Source text/ranges are never read here.
export function checkSql(input,context) {
 if (!context.schemaIdentity || !context.expectedSchema || !context.schema) return gap('SCHEMA_CONTEXT_MISSING','schema identity and expected/observed schema are required')
 const normalized=rows=>[...rows].sort((a,b)=>a.name.localeCompare(b.name))
 if (fingerprint(normalized(context.expectedSchema))!==fingerprint(normalized(context.schema))) return gap('SCHEMA_MISMATCH','observed column names, SQL types or nullability differ from expected fixture schema')
 if (!Array.isArray(input.params)||input.params.length!==1||typeof input.params[0]!=='string'||input.parameterTypes?.length!==1||input.parameterTypes[0]!=='text') return gap('PARAMETER_CONTEXT_MISMATCH','supported predicate requires exactly one text parameter value and SQL type')
 let statements
 try {statements=parse(input.sql)} catch {return gap('UNSUPPORTED_SQL','SQL parser rejected the statement')}
 if (statements.length!==1) return gap('UNSUPPORTED_SQL','exactly one SELECT is required')
 const query=statements[0]
 if (query.type!=='select'||!allowedKeys(query,['type','columns','from','where','orderBy'])) return gap('UNSUPPORTED_SQL','unsupported relational operation or SELECT clause')
 const table=query.from?.[0]
 if (query.from?.length!==1||table.type!=='table'||table.name.name!=='todo'||table.name.schema||!allowedKeys(table,['type','name'])||!allowedKeys(table.name,['name'])) return gap('UNSUPPORTED_SQL','only unaliased single-table todo is supported')
 if (!query.columns?.length||query.columns.some(c=>!ref(c.expr)||!allowedKeys(c,['expr'])||!context.schema.some(s=>s.name===c.expr.name))) return gap('UNSUPPORTED_SQL','projection must contain unaliased plain known columns')
 if (new Set(query.columns.map(c=>c.expr.name)).size!==query.columns.length) return gap('UNSUPPORTED_SQL','duplicate projected names')
 const predicate=query.where
 if (predicate?.type!=='binary'||predicate.op!=='='||!ref(predicate.left)||predicate.left.name!=='user_id'||predicate.right.type!=='parameter'||predicate.right.name!=='$1') return gap('UNSUPPORTED_SQL','only user_id = $1 predicate is checked')
 if (!query.orderBy?.length||query.orderBy.some(o=>!ref(o.by)||!['id','created_at'].includes(o.by.name)||o.order!=='ASC'||!allowedKeys(o,['by','order']))) return gap('UNSUPPORTED_SQL','only ascending id/created_at column order is checked')
 if (context.indexes.some(index=>index.table_name!=='todo')) return gap('SCHEMA_MISMATCH','index relation does not match the SQL table')
 const key=classifyKey(context.indexes)
 if (key.status!=='supported') return gap('RESULT_KEY_UNPROVEN',key.reason)
 if (!query.columns.some(c=>c.expr.name==='id')) return gap('RESULT_KEY_MISSING','id is not returned under its known name')
 const evidence={schemaIdentity:context.schemaIdentity,schemaFingerprint:fingerprint(normalized(context.schema)),keyIndex:key.evidence}
 if (!query.orderBy.some(o=>o.by.name==='id')) return {status:'violation',code:'ENDPOINT_ORDER_NOT_TOTAL',reason:'created_at can tie; append the non-null unique id',evidence}
 return {status:'supported',code:'SQL_KEY_ORDER_SUPPORTED',key:'id',totalSqlOrder:true,evidence}
}
