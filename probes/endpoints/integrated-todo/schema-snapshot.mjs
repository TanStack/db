import { createHash } from 'node:crypto'
import { analyzeSqlDependencies } from './sql-dependencies.mjs'

// Build tooling only. One catalog statement gives a consistent schema snapshot;
// this module is never imported by generated request handlers.
export async function inspectSchema(query, databaseModule) {
  const result = await query(`
    SELECT pg_catalog.current_schemas(false)::text[] AS search_path,
      COALESCE((SELECT json_agg(row_to_json(t)) FROM (
        SELECT n.nspname AS schema, c.relname AS name,
          (c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
           AND NOT c.relispartition AND c.relpersistence='p'
           AND c.relam=(SELECT oid FROM pg_catalog.pg_am WHERE amname='heap')
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
             AND ((a.atttypid NOT IN (16,20,21,23,25,114,700,701,1043,1082,1114,1184,1700,2950,3802)
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type ty WHERE ty.oid=a.atttypid AND ty.typtype='e')) OR a.attgenerated<>''))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype IN ('c','x'))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
             JOIN pg_catalog.pg_am am ON am.oid=ix.relam WHERE i.indrelid=c.oid AND
             (am.amname<>'btree' OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_opclass op JOIN pg_catalog.pg_namespace ns ON ns.oid=op.opcnamespace
               WHERE op.oid=ANY(i.indclass) AND ns.nspname<>'pg_catalog')))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=c.oid)) AS readable,
          (NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger tr JOIN pg_catalog.pg_proc p ON p.oid=tr.tgfoid
             JOIN pg_catalog.pg_namespace pn ON pn.oid=p.pronamespace
             WHERE tr.tgrelid=c.oid AND NOT (tr.tgisinternal AND pn.nspname='pg_catalog' AND p.proname LIKE 'RI_FKey_%'))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype IN ('c','x'))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=c.oid AND (
             NOT (pg_catalog.pg_get_expr(d.adbin,d.adrelid) IN ('now()', 'gen_random_uuid()', 'true', 'false', 'NULL')
               OR pg_catalog.pg_get_expr(d.adbin,d.adrelid) ~ '^-?[0-9]+([.][0-9]+)?$'
               OR (EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_type ty ON ty.oid=a.atttypid
                   WHERE a.attrelid=d.adrelid AND a.attnum=d.adnum AND ty.typtype='e')
                 AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) ~ '^''([^'']|'''')*''::[a-zA-Z_".][a-zA-Z0-9_".]*$'))
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep JOIN pg_catalog.pg_proc p ON p.oid=dep.refobjid
               JOIN pg_catalog.pg_namespace ns ON ns.oid=p.pronamespace
               WHERE dep.classid='pg_catalog.pg_attrdef'::regclass AND dep.objid=d.oid
                 AND dep.refclassid='pg_catalog.pg_proc'::regclass
                 AND (ns.nspname<>'pg_catalog' OR p.proname NOT IN ('now','gen_random_uuid')))))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND (a.attgenerated<>'' OR a.attidentity<>''))
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
             JOIN pg_catalog.pg_am am ON am.oid=ix.relam WHERE i.indrelid=c.oid AND
             (am.amname<>'btree' OR EXISTS (
               SELECT 1 FROM pg_catalog.pg_opclass op JOIN pg_catalog.pg_namespace ns ON ns.oid=op.opcnamespace
               WHERE op.oid=ANY(i.indclass) AND ns.nspname<>'pg_catalog')))) AS writable,
          COALESCE((SELECT json_agg(json_build_object(
            'expression', pg_catalog.pg_get_expr(i.indexprs,i.indrelid),
            'predicate', pg_catalog.pg_get_expr(i.indpred,i.indrelid),
            'builtin', NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_depend dep
              LEFT JOIN pg_catalog.pg_proc p ON dep.refclassid='pg_catalog.pg_proc'::regclass AND p.oid=dep.refobjid
              LEFT JOIN pg_catalog.pg_operator op ON dep.refclassid='pg_catalog.pg_operator'::regclass AND op.oid=dep.refobjid
              JOIN pg_catalog.pg_namespace ns ON ns.oid=COALESCE(p.pronamespace,op.oprnamespace)
              WHERE dep.classid='pg_catalog.pg_class'::regclass AND dep.objid=i.indexrelid AND ns.nspname<>'pg_catalog'
            ))) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND (i.indexprs IS NOT NULL OR i.indpred IS NOT NULL)), '[]') AS index_expressions,
          COALESCE((SELECT json_agg(json_build_object('schema',cn.nspname,'name',ch.relname,'update',fk.confupdtype,'delete',fk.confdeltype))
            FROM pg_catalog.pg_constraint fk JOIN pg_catalog.pg_class ch ON ch.oid=fk.conrelid
            JOIN pg_catalog.pg_namespace cn ON cn.oid=ch.relnamespace WHERE fk.contype='f' AND fk.confrelid=c.oid), '[]') AS children
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
        ORDER BY n.nspname,c.relname
      ) t), '[]') AS tables
  `)
  const rows = Array.isArray(result) ? result : result.rows
  const schema = rows[0]
  if (!Array.isArray(schema?.tables) || !Array.isArray(schema.search_path))
    throw Error('Unsupported schema inspection result')
  for (const table of schema.tables) {
    const safe = table.index_expressions.every(
      (index) =>
        index.builtin &&
        [index.expression, index.predicate].every((expression) => {
          if (expression === null) return true
          const effects = analyzeSqlDependencies('SELECT ' + expression, {
            tables: [],
            searchPath: [],
          })
          return effects.reads?.length === 0 && effects.writes?.length === 0
        }),
    )
    table.readable &&= safe
    table.writable &&= safe
    delete table.index_expressions
  }
  const contents = {
    format: 1,
    databaseModule,
    searchPath: schema.search_path,
    tables: schema.tables,
  }
  return {
    ...contents,
    fingerprint: createHash('sha256')
      .update(JSON.stringify(contents))
      .digest('hex'),
  }
}

export { schemaFootprint } from './schema-footprint.mjs'
