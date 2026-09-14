import { parse } from 'pgsql-ast-parser'
import { schemaFootprint } from './schema-footprint.mjs'

export const scalarFunctions = new Set([
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'round',
  'lower',
  'upper',
  'length',
  'char_length',
  'trim',
  'btrim',
  'ltrim',
  'rtrim',
  'replace',
  'substring',
  'concat',
  'concat_ws',
  'coalesce',
  'nullif',
  'greatest',
  'least',
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'bool_and',
  'bool_or',
  'every',
  'array_agg',
  'string_agg',
  'json_agg',
  'jsonb_agg',
  'json_build_object',
  'jsonb_build_object',
  'json_build_array',
  'jsonb_build_array',
])
export const casts = new Set([
  'bool',
  'boolean',
  'int',
  'int2',
  'int4',
  'int8',
  'integer',
  'smallint',
  'bigint',
  'float4',
  'float8',
  'real',
  'double precision',
  'numeric',
  'decimal',
  'text',
  'varchar',
  'character varying',
  'uuid',
  'date',
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'json',
  'jsonb',
])

// SQL-only inference, under the snapshot's ordinary built-in SQL assumptions.
// Unknown syntax/schema/functions invalidate the complete footprint. No catalog
// access, user-code execution, SQL parameters, or authentication policy here.
export function analyzeSqlDependencies(sql, snapshot, visitor = {}) {
  const reads = new Set(),
    writes = new Set()
  const fail = (reason) => {
    throw Error(reason)
  }
  function keys(node, allowed) {
    if (
      Object.keys(node).some(
        (key) => key !== '_location' && !allowed.includes(key),
      )
    )
      fail('Unsupported SQL clause')
  }
  function relation(table, operation, aliases, details = {}) {
    if (operation === 'select' && !table.schema && aliases.has(table.name))
      return
    if (visitor.relation) return visitor.relation(table, operation, details)
    const footprint = schemaFootprint(snapshot, [table], operation)
    if (footprint === null) fail('Unsupported schema footprint')
    for (const id of footprint)
      (operation === 'select' ? reads : writes).add(id)
  }
  function type(node) {
    if (visitor.type) return visitor.type(node)
    if (node?.kind === 'array') return type(node.arrayOf)
    if (
      !node ||
      (node.schema && node.schema !== 'pg_catalog') ||
      !casts.has(node.name)
    )
      fail('Unsupported SQL type')
  }
  function expression(node, aliases) {
    if (!node) return
    const walk = (value) => expression(value, aliases)
    if (['select', 'union', 'union all', 'with', 'values'].includes(node.type))
      return statement(node, aliases)
    switch (node.type) {
      case 'ref':
      case 'parameter':
      case 'null':
      case 'integer':
      case 'numeric':
      case 'string':
      case 'boolean':
      case 'default':
        return
      case 'binary':
        visitor.operator?.(node)
        if (node.opSchema && node.opSchema !== 'pg_catalog')
          fail('Custom SQL operator')
        walk(node.left)
        walk(node.right)
        return
      case 'unary':
        visitor.operator?.(node)
        if (node.opSchema && node.opSchema !== 'pg_catalog')
          fail('Custom SQL operator')
        walk(node.operand)
        return
      case 'ternary':
        walk(node.value)
        walk(node.lo)
        walk(node.hi)
        return
      case 'cast':
        type(node.to)
        walk(node.operand)
        return
      case 'constant':
        type(node.dataType)
        return
      case 'call':
        if (visitor.call) visitor.call(node)
        else if (
          (node.function.schema && node.function.schema !== 'pg_catalog') ||
          !scalarFunctions.has(node.function.name)
        )
          fail('Unsupported SQL function')
        node.args.forEach(walk)
        node.orderBy?.forEach((order) => walk(order.by))
        walk(node.filter)
        if (node.withinGroup) walk(node.withinGroup.by)
        node.over?.orderBy?.forEach((order) => walk(order.by))
        node.over?.partitionBy?.forEach(walk)
        return
      case 'case':
        walk(node.value)
        walk(node.else)
        node.whens.forEach((branch) => {
          walk(branch.when)
          walk(branch.value)
        })
        return
      case 'list':
      case 'array':
        node.expressions.forEach(walk)
        return
      case 'array select':
        statement(node.select, aliases)
        return
      case 'arrayIndex':
        walk(node.array)
        walk(node.index)
        return
      case 'member':
        walk(node.operand)
        return
      case 'extract':
        walk(node.from)
        return
      case 'substring':
        walk(node.value)
        walk(node.from)
        walk(node.for)
        return
      case 'overlay':
        walk(node.value)
        walk(node.placing)
        walk(node.from)
        walk(node.for)
        return
      default:
        fail('Unsupported SQL expression: ' + node.type)
    }
  }
  function from(node, aliases) {
    if (node.type === 'table') relation(node.name, 'select', aliases)
    else if (node.type === 'statement') statement(node.statement, aliases)
    else fail('Unsupported SQL source')
    expression(node.join?.on, aliases)
  }
  function statement(node, aliases = new Set()) {
    const expr = (value) => expression(value, aliases)
    const projection = (columns) =>
      columns?.forEach((column) => expr(column.expr))
    switch (node.type) {
      case 'with': {
        keys(node, ['type', 'bind', 'in'])
        const local = new Set(aliases),
          names = new Set()
        for (const binding of node.bind) {
          if (names.has(binding.alias.name)) fail('Duplicate SQL CTE')
          statement(binding.statement, local)
          local.add(binding.alias.name)
          names.add(binding.alias.name)
        }
        statement(node.in, local)
        return
      }
      case 'select':
        keys(node, [
          'type',
          'columns',
          'from',
          'where',
          'groupBy',
          'having',
          'limit',
          'orderBy',
          'distinct',
        ])
        node.from?.forEach((source) => from(source, aliases))
        projection(node.columns)
        expr(node.where)
        expr(node.having)
        node.groupBy?.forEach(expr)
        node.orderBy?.forEach((order) => expr(order.by))
        expr(node.limit?.limit)
        expr(node.limit?.offset)
        if (Array.isArray(node.distinct)) node.distinct.forEach(expr)
        return
      case 'union':
      case 'union all':
        keys(node, ['type', 'left', 'right'])
        statement(node.left, aliases)
        statement(node.right, aliases)
        return
      case 'values':
        keys(node, ['type', 'values'])
        node.values.forEach((row) => row.forEach(expr))
        return
      case 'insert':
        keys(node, [
          'type',
          'into',
          'columns',
          'insert',
          'returning',
          'onConflict',
          'overriding',
        ])
        relation(node.into, 'insert', aliases, {
          columns: node.columns?.map((c) => c.name),
          valueCount:
            node.insert.type === 'values'
              ? Math.min(...node.insert.values.map((row) => row.length))
              : undefined,
          defaultValues:
            node.insert.type === 'values' &&
            node.insert.values.some((row) =>
              row.some((value) => value.type === 'default'),
            ),
        })
        statement(node.insert, aliases)
        if (node.onConflict) {
          relation(node.into, 'select', aliases)
          if (node.onConflict.do !== 'do nothing') {
            relation(node.into, 'update', aliases, {
              columns: node.onConflict.do.sets.map((set) => set.column.name),
              defaults: node.onConflict.do.sets
                .filter((set) => set.value.type === 'default')
                .map((set) => set.column.name),
            })
            node.onConflict.do.sets.forEach((set) => expr(set.value))
          }
          if (node.onConflict.on?.type === 'on expr')
            node.onConflict.on.exprs.forEach(expr)
          expr(node.onConflict.where)
        }
        projection(node.returning)
        return
      case 'update':
        keys(node, ['type', 'table', 'sets', 'where', 'from', 'returning'])
        relation(node.table, 'update', aliases, {
          columns: node.sets.map((set) => set.column.name),
          defaults: node.sets
            .filter((set) => set.value.type === 'default')
            .map((set) => set.column.name),
        })
        relation(node.table, 'select', aliases)
        node.sets.forEach((set) => expr(set.value))
        expr(node.where)
        if (node.from) from(node.from, aliases)
        projection(node.returning)
        return
      case 'delete':
        keys(node, ['type', 'from', 'where', 'returning'])
        relation(node.from, 'delete', aliases)
        relation(node.from, 'select', aliases)
        expr(node.where)
        projection(node.returning)
        return
      default:
        fail('Unsupported SQL statement: ' + node.type)
    }
  }
  try {
    if (!snapshot) fail('Missing build-time schema snapshot')
    const statements = parse(sql)
    if (!statements.length) fail('Empty SQL')
    statements.forEach((node) => statement(node))
    return {
      reads: [...reads].sort(),
      writes: [...writes].sort(),
      reason: null,
    }
  } catch (error) {
    return { reads: null, writes: null, reason: error.message }
  }
}
