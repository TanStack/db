import { processGroupBy, replaceAggregatesByRefs } from './group-by.js'

/**
 * The grouping compiler. Aggregate values and `groupKeys` carry it onto the
 * query IR, so apps that never group or aggregate do not bundle it.
 */
export const grouping = { processGroupBy, replaceAggregatesByRefs }

export type Grouping = typeof grouping
