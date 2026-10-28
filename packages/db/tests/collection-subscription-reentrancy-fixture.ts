import { Func, PropRef, Value } from '../src/query/ir.js'

/** The equality predicate on `id` that the reentry histories request. */
export const where = () =>
  new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
