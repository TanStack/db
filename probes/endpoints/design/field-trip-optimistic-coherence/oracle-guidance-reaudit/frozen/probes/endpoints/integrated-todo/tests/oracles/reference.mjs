import { PGlite } from '@electric-sql/pglite'

// This is the query authority. No imports from the SUT renderer or runtime.
export class Reference {
  pg = new PGlite()
  async init() {
    const { rows } = await this.pg.query(
      "SELECT version() AS version, current_setting('server_version_num') AS version_num",
    )
    this.engine = rows[0]
    await this.pg
      .exec(`CREATE TABLE confirmed(id text PRIMARY KEY, text text NOT NULL, completed boolean NOT NULL, created_at timestamptz NOT NULL, scope text NOT NULL);
      CREATE TABLE visible (LIKE confirmed INCLUDING ALL);`)
  }
  async reset(rows) {
    await this.pg.exec('TRUNCATE confirmed, visible')
    for (const row of rows) {
      await this.pg.query('INSERT INTO confirmed VALUES ($1,$2,$3,$4,$5)', [
        row.id,
        row.text,
        row.completed,
        row.createdAt,
        row.scope,
      ])
    }
    await this.restore()
  }
  async restore() {
    await this.pg.exec(
      'TRUNCATE visible; INSERT INTO visible SELECT * FROM confirmed',
    )
  }
  async apply(table, operation) {
    if (!['confirmed', 'visible'].includes(table))
      throw Error('Invalid reference table')
    const { kind, input, scope } = operation
    if (table === 'confirmed' && input.actualEffect === 'noop') return
    const textParameter =
      table === 'confirmed' && operation.canonicalize ? 'btrim($1)' : '$1'
    const insertText =
      table === 'confirmed' && operation.canonicalize ? 'btrim($2)' : '$2'
    switch (kind) {
      case 'insert':
        await this.pg.query(
          `INSERT INTO ${table} VALUES ($1,${insertText},$3,$4,$5)`,
          [input.id, input.text, input.completed, input.createdAt, scope],
        )
        break
      case 'edit':
        await this.pg.query(
          `UPDATE ${table} SET text=${textParameter} WHERE id=$2 AND scope=$3`,
          [input.text, input.id, scope],
        )
        break
      case 'complete':
        await this.pg.query(
          `UPDATE ${table} SET completed=$1 WHERE id=$2 AND scope=$3`,
          [input.completed, input.id, scope],
        )
        break
      case 'delete':
        await this.pg.query(`DELETE FROM ${table} WHERE id=$1 AND scope=$2`, [
          input.id,
          scope,
        ])
        break
      default:
        throw Error('Unknown reference operation')
    }
    if (table === 'confirmed' && input.actualEffect === 'flip')
      await this.pg.query(
        'UPDATE confirmed SET completed=$1 WHERE id=$2 AND scope=$3',
        [!input.completed, input.id, scope],
      )
    if (
      table === 'confirmed' &&
      input.actualEffect === 'other' &&
      input.otherId !== null
    )
      await this.pg.query(
        'UPDATE confirmed SET completed=$1,text=$2 WHERE id=$3 AND scope=$4',
        [input.completed, input.text, input.otherId, scope],
      )
  }
  async query(order, scope, table = 'visible', completed = null) {
    const columns = { createdAt: 'created_at', id: 'id' }
    if (!order.every((field) => Object.hasOwn(columns, field)))
      throw Error('Unknown reference order')
    const { rows } = await this.pg.query(
      `SELECT id,text,completed,created_at FROM ${table} WHERE scope=$1 AND ($2::boolean IS NULL OR completed=$2) ORDER BY ${order.map((field) => columns[field] + ' ASC').join(', ')}`,
      [scope, completed],
    )
    return rows.map((row) => ({
      id: row.id,
      text: row.text,
      completed: row.completed,
      createdAt: new Date(row.created_at).toISOString(),
    }))
  }
  async expected(program) {
    return Promise.all(
      program.orders.map((order, i) =>
        program.gced?.includes(i)
          ? []
          : this.query(
              order,
              program.scope,
              'visible',
              program.filters?.[i] ?? null,
            ),
      ),
    )
  }
  async operation(program, step, index) {
    const targets = program.orders
      .map((_, i) => i)
      .filter((i) => !program.gced?.includes(i))
    const target = targets[step.target % targets.length]
    const filter = program.filters?.[target] ?? null
    const rows = await this.query(['id'], program.scope, 'visible', filter)
    const row = rows[step.slot % Math.max(rows.length, 1)]
    const kind = step.kind === 'insert' || !row ? 'insert' : step.kind
    const others = await this.query(['id'], program.scope, 'confirmed')
    const input = {
      id: kind === 'insert' ? `${step.idPrefix ?? 'new'}-new-${index}` : row.id,
      text: step.text,
      completed: kind === 'insert' ? (filter ?? false) : !row.completed,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, step.rank)).toISOString(),
      token: `operation-${index}`,
      actualEffect: step.actualEffect ?? 'same',
      otherId: others.find((other) => other.id !== row?.id)?.id ?? null,
      failAfterCommit: step.failAfterCommit ?? false,
    }
    if (kind === 'edit' && input.text === row.text) input.text += '!'
    return {
      kind,
      input,
      scope: program.scope,
      canonicalize: program.canonicalize,
      target,
      outcome: step.outcome,
    }
  }
  async close() {
    await this.pg.close()
  }
}
