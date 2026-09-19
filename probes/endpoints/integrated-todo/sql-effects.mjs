import { createHash } from 'node:crypto'
import {
  analyzeSqlDependencies,
  scalarFunctions,
  casts,
} from './sql-dependencies.mjs'
export {
  canSkipRefetch,
  mutationDependencies,
  queryDependencies,
} from './effect-verdict.mjs'

const relationId = ({ schema, name }) => JSON.stringify([schema, name])
const nativeTypes = new Set(
  [
    16, 20, 21, 23, 25, 114, 700, 701, 1043, 1082, 1114, 1184, 1700, 2950, 3802,
  ].map(String),
)

// Build-only facts, not per-table eligibility. A single catalog statement sees
// one snapshot. No user function is executed to discover its effects.
export async function inspectSqlEffects(query, databaseModule) {
  const result = await query(`SELECT
    pg_catalog.current_schemas(true)::text[] AS search_path,
    (SELECT json_agg(row_to_json(t)) FROM (
      SELECT c.oid, n.nspname AS schema,c.relname AS name,c.relkind AS kind,
        c.relrowsecurity OR c.relforcerowsecurity AS rls,
        c.relam<>(SELECT oid FROM pg_catalog.pg_am WHERE amname='heap') AS custom_access,
        c.relispartition OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid) AS inheritance,
        EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
        COALESCE((SELECT json_agg(json_build_object('name',a.attname,'type',a.atttypid,
          'generated',a.attgenerated,'identity',a.attidentity,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)))
          FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),'[]') AS columns,
        COALESCE((SELECT json_agg(json_build_object('expression',pg_catalog.pg_get_expr(i.indexprs,i.indrelid),
          'predicate',pg_catalog.pg_get_expr(i.indpred,i.indrelid),
          'native',am.oid<16384 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_opclass op WHERE op.oid=ANY(i.indclass) AND op.oid>=16384)))
          FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid JOIN pg_catalog.pg_am am ON am.oid=ix.relam WHERE i.indrelid=c.oid),'[]') AS indexes,
        COALESCE((SELECT json_agg(pg_catalog.pg_get_expr(k.conbin,k.conrelid)) FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='c'),'[]') AS checks,
        EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='x') AS exclusion,
        COALESCE((SELECT json_agg(json_build_object('oid',tr.oid,'function',tr.tgfoid,'events',tr.tgtype,'enabled',tr.tgenabled))
          FROM pg_catalog.pg_trigger tr WHERE tr.tgrelid=c.oid AND NOT tr.tgisinternal),'[]') AS triggers,
        COALESCE((SELECT json_agg(json_build_object('schema',cn.nspname,'name',ch.relname,'update',fk.confupdtype,'delete',fk.confdeltype,
          'parentColumns',(SELECT json_agg(a.attname) FROM unnest(fk.confkey) k JOIN pg_catalog.pg_attribute a ON a.attrelid=fk.confrelid AND a.attnum=k),
          'childColumns',(SELECT json_agg(a.attname) FROM unnest(fk.conkey) k JOIN pg_catalog.pg_attribute a ON a.attrelid=fk.conrelid AND a.attnum=k)))
          FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class ch ON ch.oid=fk.conrelid JOIN pg_catalog.pg_namespace cn ON cn.oid=ch.relnamespace
          WHERE fk.contype='f' AND fk.confrelid=c.oid),'[]') AS children
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
      ORDER BY n.nspname,c.relname) t) AS tables,
    (SELECT json_agg(row_to_json(f)) FROM (
      SELECT p.oid,n.nspname AS schema,p.proname AS name,l.lanname AS language,
        p.prosrc AS body,p.prosqlbody IS NOT NULL AS parsed_body,p.proconfig AS config,p.prosecdef AS definer,
        p.pronargs AS arity,p.pronargdefaults AS defaults,p.provariadic<>0 AS variadic,
        p.proargtypes::oid[] AS args,p.prorettype AS result,p.provolatile AS volatility,p.prokind AS kind,
        EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_catalog.pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') AS extension
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      ORDER BY p.oid) f) AS routines,
    EXISTS (SELECT 1 FROM pg_catalog.pg_cast WHERE oid>=16384) AS custom_casts,
    COALESCE((SELECT json_agg(json_build_object('schema',n.nspname,'name',t.typname,'oid',t.oid,'kind',t.typtype)) FROM pg_catalog.pg_type t
      JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE t.oid>=16384),'[]') AS custom_types,
    COALESCE((SELECT json_agg(json_build_object('schema',n.nspname,'name',o.oprname)) FROM pg_catalog.pg_operator o
      JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace WHERE o.oid>=16384),'[]') AS custom_operators`)
  const row = (Array.isArray(result) ? result : result.rows)[0]
  const facts = {
    format: 2,
    databaseModule,
    searchPath: row.search_path,
    tables: row.tables ?? [],
    routines: row.routines ?? [],
    customOperators: row.custom_operators,
    customCasts: row.custom_casts,
    customTypes: row.custom_types,
  }
  return {
    ...facts,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(facts))
      .digest('hex'),
  }
}

// Initial supported fragment: native scalar columns/operators and string-bodied
// SQL routines. We join every possible overload in the binding environment;
// this avoids pretending that an arity match is PostgreSQL type resolution.
// Each body/event is visited once. Recursion adds facts until the worklist empties.
export function analyzeSqlEffects(sql, snapshot) {
  return analyzeEffects([{ sql }], snapshot)
}

// Drizzle bindings and parsed SQL share the same relation/event worklist.
export function analyzeEffects(statements, snapshot) {
  const reads = new Set(),
    writes = new Set(),
    unknown = [],
    derivation = []
  const enumTypes = snapshot.customTypes.filter((type) => type.kind === 'e')
  const enumOids = new Set(enumTypes.map((type) => String(type.oid)))
  const tables = new Map(
    snapshot.tables.map((table) => [relationId(table), table]),
  )
  const pending = statements
      .filter((item) => item.sql !== undefined)
      .map((item) => ({ ...item, source: 'endpoint' })),
    visited = new Set()
  const unresolved = (source, reason, dimensions = ['reads', 'writes']) => {
    unknown.push({ source, reason, dimensions })
  }
  // Until expression types are bound, implicit assignment/operator coercions
  // cannot be matched to application-defined casts. Preserve that missing proof.
  if (snapshot.customCasts)
    unresolved('endpoint:binding', 'Custom cast binding is unresolved')
  if (snapshot.searchPath.some((schema) => schema.startsWith('pg_temp_')))
    unresolved('endpoint:binding', 'Temporary relation binding is unresolved')
  const enqueue = (expression, source) => {
    if (expression) pending.push({ sql: 'SELECT ' + expression, source })
  }
  function routine(fn, source) {
    const key = `routine:${fn.oid}`
    derivation.push({ rule: 'routine-call', source, target: key })
    if (visited.has(key)) return
    visited.add(key)
    if (
      fn.oid < 16384 &&
      fn.schema === 'pg_catalog' &&
      !fn.extension &&
      [
        'now',
        'transaction_timestamp',
        'statement_timestamp',
        'clock_timestamp',
        'gen_random_uuid',
      ].includes(fn.name)
    ) {
      unresolved(key, 'Value can change independently of table writes', [
        'reads',
      ])
      return
    }
    if (
      fn.oid < 16384 &&
      fn.schema === 'pg_catalog' &&
      !fn.extension &&
      scalarFunctions.has(fn.name)
    ) {
      derivation.push({ rule: 'native-scalar-contract', source: key })
      return
    }
    if (
      fn.language !== 'sql' ||
      fn.parsed_body ||
      fn.config ||
      fn.definer ||
      fn.kind !== 'f' ||
      !fn.args.every((type) => nativeTypes.has(type)) ||
      !nativeTypes.has(fn.result)
    ) {
      unresolved(
        key,
        'Unsupported routine body, signature, or execution context',
      )
      return
    }
    pending.push({ sql: fn.body, source: key })
  }
  function relation(table, operation, details, source) {
    const schema =
      table.schema ??
      snapshot.searchPath.find((schema) =>
        tables.has(relationId({ ...table, schema })),
      )
    const id = relationId({ ...table, schema }),
      actual = tables.get(id)
    derivation.push({
      rule: 'relation-event',
      source,
      target: id,
      operation,
      details,
    })
    if (!actual) {
      unresolved(source, `Unresolved relation ${id}`)
      return
    }
    ;(operation === 'select' ? reads : writes).add(id)
    const key = JSON.stringify([id, operation, details])
    if (visited.has(key)) return
    visited.add(key)
    if (
      actual.kind !== 'r' ||
      actual.rls ||
      actual.inheritance ||
      actual.rules ||
      actual.custom_access
    ) {
      unresolved(id, `Unresolved ${operation} relation semantics`)
      return
    }
    if (
      actual.columns.some(
        (column) =>
          (!nativeTypes.has(column.type) &&
            !enumOids.has(String(column.type))) ||
          column.generated === 'v',
      )
    )
      unresolved(id, 'Unsupported type or virtual generated expression')
    // Index expressions can be evaluated during an index scan or maintenance.
    // Pure expressions add no table dependency; an index is never itself a table.
    for (const [i, index] of actual.indexes.entries()) {
      if (!index.native)
        unresolved(id, 'Unresolved index access method or operator class')
      enqueue(index.expression, `${id}:index:${i}`)
      enqueue(index.predicate, `${id}:index:${i}:predicate`)
    }
    if (operation === 'select') return
    const event = { insert: 4, delete: 8, update: 16 }[operation]
    for (const trigger of actual.triggers) {
      if (trigger.enabled === 'D' || !(trigger.events & event)) continue
      // Statement triggers are reachable even for a zero-row write. Trigger
      // record semantics are not part of the initial SQL routine fragment.
      unresolved(`${id}:trigger:${trigger.oid}`, 'Unresolved trigger body')
    }
    if (operation !== 'delete') {
      for (const [index, column] of actual.columns.entries()) {
        const selected =
          column.generated ||
          (operation === 'insert'
            ? details.defaultValues ||
              (details.columns
                ? !details.columns.includes(column.name)
                : details.valueCount === undefined ||
                  index >= details.valueCount)
            : details.defaults?.includes(column.name))
        if (selected) {
          enqueue(column.default, `${id}:column:${column.name}`)
          if (column.identity)
            unresolved(id, 'Sequence identity effects are unresolved')
        }
      }
      for (const [i, expression] of actual.checks.entries())
        enqueue(expression, `${id}:check:${i}`)
      if (actual.exclusion) unresolved(id, 'Unresolved exclusion constraint')
    }
    if (operation === 'insert') return
    for (const child of actual.children) {
      if (
        operation === 'update' &&
        details.columns &&
        child.parentColumns.every((column) => !details.columns.includes(column))
      )
        continue
      const action = child[operation]
      if (['a', 'r'].includes(action)) continue
      if (!['c', 'n', 'd'].includes(action)) {
        unresolved(id, 'Unresolved foreign key action')
        continue
      }
      const childOperation =
        operation === 'delete' && action === 'c' ? 'delete' : 'update'
      derivation.push({
        rule: 'foreign-key-action',
        source: id,
        target: relationId(child),
        operation: childOperation,
      })
      relation(
        child,
        childOperation,
        {
          columns: child.childColumns,
          defaults: action === 'd' ? child.childColumns : [],
        },
        id,
      )
    }
  }
  for (const item of statements)
    if (item.table)
      relation(item.table, item.operation, item.details ?? {}, 'endpoint')
  while (pending.length) {
    const item = pending.pop()
    const parsed = analyzeSqlDependencies(item.sql, snapshot, {
      relation: (table, operation, details) =>
        relation(table, operation, details, item.source),
      call: (node) => {
        const name = node.function
        // PostgreSQL special expressions, represented as calls by this parser;
        // these do not resolve through pg_proc. Their arguments are still walked.
        if (
          !name.schema &&
          ['coalesce', 'nullif', 'greatest', 'least'].includes(name.name)
        )
          return
        const schemas = name.schema ? [name.schema] : snapshot.searchPath
        const possible = snapshot.routines.filter(
          (fn) =>
            schemas.includes(fn.schema) &&
            fn.name === name.name &&
            (fn.variadic ||
              (node.args.length <= fn.arity &&
                node.args.length >= fn.arity - fn.defaults)),
        )
        if (!possible.length)
          unresolved(item.source, `Unresolved routine ${JSON.stringify(name)}`)
        for (const fn of possible) {
          if (fn.defaults || fn.variadic)
            unresolved(
              `routine:${fn.oid}`,
              'Routine argument defaults or variadic binding are unresolved',
            )
          routine(fn, item.source)
        }
      },
      operator: (node) => {
        if (
          snapshot.customOperators.some(
            (op) =>
              op.name === node.op &&
              (node.opSchema
                ? node.opSchema === op.schema
                : snapshot.searchPath.includes(op.schema)),
          )
        )
          unresolved(item.source, `Unresolved operator ${node.op}`)
      },
      type: (type) => {
        if (
          enumTypes.some(
            (candidate) =>
              candidate.name === type.name &&
              (type.schema
                ? candidate.schema === type.schema
                : snapshot.searchPath.includes(candidate.schema)),
          )
        )
          return
        if (
          !casts.has(type.name) ||
          (type.schema && type.schema !== 'pg_catalog') ||
          (!type.schema &&
            snapshot.customTypes.some(
              (custom) =>
                custom.name === type.name &&
                snapshot.searchPath.includes(custom.schema),
            ))
        )
          unresolved(
            item.source,
            `Unresolved cast type ${JSON.stringify(type)}`,
          )
      },
    })
    if (parsed.reason) unresolved(item.source, parsed.reason)
  }
  return {
    reads: [...reads].sort(),
    writes: [...writes].sort(),
    unknown,
    derivation,
    artifact: snapshot.fingerprint,
    statement: createHash('sha256')
      .update(JSON.stringify(statements))
      .digest('hex'),
  }
}
