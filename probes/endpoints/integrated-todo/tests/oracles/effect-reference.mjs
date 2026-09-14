import { SchemaReference } from './schema-reference.mjs'
const quote = (name) => '"' + name.replaceAll('"', '""') + '"'

export class EffectReference extends SchemaReference {
  async applyStatements(state, operation) {
    if (operation.input.cross)
      throw Error(
        'Effect oracle does not model handler cross-writes and recursive triggers yet',
      )
    const mode = this.program.effect
    const applies =
      state === 'confirmed' &&
      operation.table === 0 &&
      ['edit', 'complete'].includes(operation.kind)
    if (!applies) return super.applyStatements(state, operation)
    const origin = `confirmed.${quote(this.program.tables[0].name)}`
    const target = `confirmed.${quote(this.program.tables[1].name)}`
    const { rows } = await this.pg.query(
      `SELECT id FROM ${origin} WHERE id=$1 AND user_id=$2`,
      [operation.input.id, operation.scope],
    )
    if (!rows.length) return super.applyStatements(state, operation)
    operation.effectWitness = mode
    if (mode === 'reject') {
      operation.serverError = {
        code: '23514',
        message: 'oracle constraint rejection',
      }
      return
    }
    if (mode !== 'suppress') {
      await super.applyStatements(state, operation)
      if (mode === 'rewrite')
        await this.pg.query(
          `UPDATE ${origin} SET text=$1 || text,completed=NOT completed WHERE id=$2 AND user_id=$3`,
          ['rewritten:', operation.input.id, operation.scope],
        )
      else if (mode === 'transition')
        await this.pg.query(
          `UPDATE ${target} SET text=$1,completed=true WHERE user_id=$2`,
          ['transition:1', operation.scope],
        )
      else {
        const row = (
          await this.pg.query(`SELECT text FROM ${origin} WHERE id=$1`, [
            operation.input.id,
          ])
        ).rows[0]
        await this.pg.query(
          `UPDATE ${target} SET text=$1,completed=NOT completed WHERE user_id=$2`,
          ['trigger:' + row.text, operation.scope],
        )
      }
    }
  }
  async externalWrite(scope, text) {
    await this.pg.query(
      `UPDATE confirmed.${quote(this.program.tables[1].name)} SET text=$1,completed=true WHERE user_id=$2`,
      [text, scope],
    )
  }
}
