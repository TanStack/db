import { PGlite } from '@electric-sql/pglite'

// Independent SQL authority. Does not import SUT renderers, compiler metadata,
// membership evaluation, response decoding or affected-collection analysis.
const quote = (name) => '"' + name.replaceAll('"', '""') + '"'
const physical = (name) =>
  ({ createdAt: 'created_at', scope: 'user_id', parentId: 'parent_id' })[
    name
  ] ?? name
export class SchemaReference {
  pg = new PGlite()
  operations = []
  async init() {
    this.engine = (
      await this.pg.query(
        "SELECT version() AS version,current_setting('server_version_num') AS version_num",
      )
    ).rows[0]
  }
  async configure(program) {
    this.program = program
    await this.pg.exec(
      'DROP SCHEMA IF EXISTS confirmed CASCADE; DROP SCHEMA IF EXISTS visible CASCADE; CREATE SCHEMA confirmed; CREATE SCHEMA visible',
    )
    for (const state of ['confirmed', 'visible'])
      for (const table of program.tables) {
        const definitions = [
          'id text PRIMARY KEY',
          'text text NOT NULL',
          'completed boolean NOT NULL',
          'created_at timestamp NOT NULL',
          'user_id text NOT NULL',
        ]
        for (const column of table.columns) {
          const sqlType = { integer: 'int4', text: 'text', boolean: 'bool' }[
            column.type
          ]
          if (!sqlType) throw Error('Unknown reference type')
          definitions.push(
            quote(column.name) +
              ' ' +
              sqlType +
              (column.nullable ? '' : ' NOT NULL'),
          )
        }
        if (table.parent !== null)
          definitions.push(
            'parent_id text' +
              (state === 'confirmed'
                ? ` REFERENCES confirmed.${quote(program.tables[table.parent].name)}(id) ON DELETE SET NULL`
                : ''),
          )
        // Optimism models direct authored guesses, not unobserved FK actions.
        await this.pg.exec(
          `CREATE TABLE ${state}.${quote(table.name)}(${definitions.join(',')})`,
        )
      }
  }
  fields(table) {
    return [
      'id',
      'text',
      'completed',
      'createdAt',
      'scope',
      ...table.columns.map((c) => c.name),
      ...(table.parent === null ? [] : ['parentId']),
    ]
  }
  async reset(rows) {
    await this.pg.exec(
      'TRUNCATE ' +
        this.program.tables.map((t) => 'confirmed.' + quote(t.name)).join(',') +
        ' CASCADE',
    )
    for (const table of this.program.tables)
      for (const row of rows.filter((row) => row.table === table.name)) {
        const fields = this.fields(table)
        await this.pg.query(
          `INSERT INTO confirmed.${quote(table.name)} VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})`,
          fields.map((field) => row[field]),
        )
      }
    await this.restore()
  }
  async restore() {
    for (const table of this.program.tables)
      await this.pg.exec(
        `TRUNCATE visible.${quote(table.name)}; INSERT INTO visible.${quote(table.name)} SELECT * FROM confirmed.${quote(table.name)}`,
      )
  }
  async query(query, state = 'visible') {
    const table = this.program.tables[query.table]
    const parameters = [this.program.scope]
    function expression(node) {
      if (node.args)
        return (
          '(' +
          node.args.map(expression).join(node.op === 'and' ? ' AND ' : ' OR ') +
          ')'
        )
      const column = quote(physical(node.column))
      if (node.op === 'isNull') return column + ' IS NULL'
      if (node.op === 'isNotNull') return column + ' IS NOT NULL'
      const operator = {
        eq: '=',
        ne: '<>',
        gt: '>',
        gte: '>=',
        lt: '<',
        lte: '<=',
      }[node.op]
      if (!operator) throw Error('Unknown reference operator')
      parameters.push(node.value)
      return `${column} ${operator} $${parameters.length}`
    }
    const filter = query.predicate ? ' AND ' + expression(query.predicate) : ''
    const fields = this.fields(table).filter((f) => f !== 'scope')
    const { rows } = await this.pg.query(
      `SELECT ${fields.map((field) => (field === 'createdAt' ? "created_at AT TIME ZONE 'UTC'" : quote(physical(field))) + ' AS ' + quote(field)).join(',')} FROM ${state}.${quote(table.name)} WHERE user_id=$1${filter} ORDER BY ${query.order.map((field) => quote(physical(field))).join(',')}`,
      parameters,
    )
    return rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt).toISOString(),
    }))
  }
  async expected(program) {
    return Promise.all(
      program.queries.map((query, i) =>
        this.query({ ...query, order: program.orders[i] }),
      ),
    )
  }
  async operation(program, step, index) {
    const choices = program.queries.flatMap((query, i) =>
      query.predicate === null ? [i] : [],
    )
    const target = choices[step.target % choices.length],
      query = program.queries[target],
      table = program.tables[query.table]
    const rows = await this.query({ ...query, order: ['id'] })
    const row = rows[step.slot % Math.max(1, rows.length)]
    const kind = step.kind === 'insert' || !row ? 'insert' : step.kind
    const extra = Object.fromEntries(
      table.columns.map((column, i) => [
        column.name,
        column.nullable && step.rank % 3 === 0
          ? null
          : column.type === 'integer'
            ? step.rank - 2
            : column.type === 'boolean'
              ? step.rank % 2 === 0
              : step.text + '-' + i,
      ]),
    )
    if (table.parent !== null)
      extra.parentId = kind === 'insert' ? null : row.parentId
    const next = (query.table + 1) % program.tables.length
    const other = await this.query(
      { table: next, predicate: null, order: ['id'] },
      'confirmed',
    )
    const input = {
      id: kind === 'insert' ? `new-${index}` : row.id,
      text: step.text,
      completed: kind === 'insert' ? false : !row.completed,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, step.rank)).toISOString(),
      extra,
      token: `operation-${index}`,
      cross: step.cross ?? false,
      otherId: other[0]?.id ?? null,
      failAfterCommit: step.failAfterCommit ?? false,
    }
    // Keep updates observable, including shrink-to-empty strings.
    if (kind === 'edit' && input.text === row.text) input.text += '!'
    const operation = {
      kind,
      input,
      target,
      outcome: step.outcome,
      table: query.table,
      scope: program.scope,
      next,
    }
    this.operations.push(operation)
    return operation
  }
  async apply(state, operation) {
    if (!['visible', 'confirmed'].includes(state))
      throw Error('Unknown reference state')
    try {
      await this.applyStatements(state, operation)
    } catch (error) {
      // A concurrent parent deletion may invalidate a child's earlier guess.
      // PostgreSQL decides this outcome; syntax/model errors must still fail.
      if (state !== 'confirmed' || error?.code !== '23503') throw error
      operation.serverError = { code: error.code, message: error.message }
    }
  }
  async applyStatements(state, operation) {
    const { kind, input, scope, next } = operation,
      table = this.program.tables[operation.table]
    const name = state + '.' + quote(table.name)
    const text =
      state === 'confirmed'
        ? (await this.pg.query('SELECT btrim($1::text) AS value', [input.text]))
            .rows[0].value
        : input.text
    if (kind === 'insert') {
      const value = { ...input, ...input.extra, text, scope },
        fields = this.fields(table)
      await this.pg.query(
        `INSERT INTO ${name} VALUES (${fields.map((_, i) => '$' + (i + 1)).join(',')})`,
        fields.map((field) => value[field]),
      )
    } else if (kind === 'delete')
      await this.pg.query(`DELETE FROM ${name} WHERE id=$1 AND user_id=$2`, [
        input.id,
        scope,
      ])
    else {
      const values =
        kind === 'edit'
          ? { text, ...input.extra }
          : { completed: input.completed }
      const fields = Object.keys(values),
        parameters = [...Object.values(values), input.id, scope]
      await this.pg.query(
        `UPDATE ${name} SET ${fields.map((field, i) => quote(physical(field)) + '=$' + (i + 1)).join(',')} WHERE id=$${fields.length + 1} AND user_id=$${fields.length + 2}`,
        parameters,
      )
    }
    if (state === 'confirmed' && input.cross && input.otherId !== null)
      await this.pg.query(
        `UPDATE confirmed.${quote(this.program.tables[next].name)} SET text=$1,completed=$2 WHERE id=$3 AND user_id=$4`,
        [text, input.completed, input.otherId, scope],
      )
  }
  async close() {
    await this.pg.close()
  }
}
