/**
 * The pagination fixture that pagination-oracle.property.test.ts and the fixed
 * tests in pagination.test.ts share. The provider answers mathematical rank
 * intervals rather than following the adapter's page state; the oracle file
 * states its premises.
 */
import { makeFunctionReference } from 'convex/server'
import { expect } from 'vitest'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { ConvexCollectionClient } from '../src/index'

export type Row = { id: string; rank: number; text: string }
export const query = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<Row>
>(`rows:list`)
type Slot = {
  options: PaginationOptions
  current?: PaginationResult<Row>
  callback: (value: PaginationResult<Row>) => void
  active: boolean
}
export function provider(
  reverse: boolean,
  split: `none` | `required` | `recommended`,
) {
  const slots: Array<Slot> = []
  let rowVisits = 0
  const client = {
    onUpdate: (
      _query: unknown,
      args: { paginationOpts: PaginationOptions },
      callback: Slot[`callback`],
    ) => {
      const slot: Slot = {
        options: args.paginationOpts,
        callback,
        active: true,
      }
      slots.push(slot)
      return Object.assign(
        () => {
          slot.active = false
        },
        { getCurrentValue: () => slot.current },
      )
    },
  } as ConvexCollectionClient
  return {
    client,
    slots,
    get rowVisits() {
      return rowVisits
    },
    publish: async (rows: Array<Row>, checkpoint?: () => void) => {
      const served = new Set<Slot>()
      for (let turn = 0; turn < 100; turn++) {
        const pending = slots.filter((slot) => slot.active && !served.has(slot))
        if (reverse) pending.reverse()
        for (const slot of pending) {
          served.add(slot)
          const { cursor, endCursor, numItems } = slot.options
          const from = cursor === null ? -Infinity : Number(cursor)
          const to = endCursor == null ? Infinity : Number(endCursor)
          const interval = rows
            .filter((row) => row.rank > from && row.rank <= to)
            .sort((a, b) => a.rank - b.rank)
          const page =
            endCursor == null ? interval.slice(0, numItems) : interval
          const boundary = endCursor ?? String(page.at(-1)?.rank ?? from)
          // A split belongs strictly inside the returned cursor range. For an
          // unbounded query that range ends at the returned page's boundary,
          // not at the end of all rows matching the query.
          const needsSplit = split !== `none` && page.length > 2
          const splitCursor = needsSplit
            ? String(page[Math.floor((page.length - 1) / 2)]!.rank)
            : undefined
          if (splitCursor !== undefined) {
            expect(Number(splitCursor)).toBeGreaterThan(from)
            expect(Number(splitCursor)).toBeLessThan(Number(boundary))
          }
          slot.current = {
            page: new Proxy(needsSplit && split === `required` ? [] : page, {
              get(target, key, receiver) {
                if (typeof key === `string` && /^\d+$/.test(key)) rowVisits++
                return Reflect.get(target, key, receiver)
              },
            }),
            continueCursor: boundary,
            isDone: endCursor == null && page.length === interval.length,
            ...(needsSplit
              ? {
                  pageStatus:
                    split === `required`
                      ? (`SplitRequired` as const)
                      : (`SplitRecommended` as const),
                  splitCursor,
                }
              : {}),
          }
          slot.callback(slot.current)
        }
        await Promise.resolve()
        if (slots.some((slot) => slot.active && slot.current === undefined)) {
          // Drain the acquisition's scheduled flush before checking. Otherwise
          // the fixture could fill its new subscriptions before production ever
          // reaches the incomplete-range path, hiding partial publication.
          await Promise.resolve()
          checkpoint?.()
        }
        if (slots.every((slot) => !slot.active || served.has(slot))) return
      }
      throw new Error(`Pagination did not exhaust finite fixture`)
    },
  }
}

export function copyRows(rows: ReadonlyArray<Row>): Array<Row> {
  return rows.map(({ id, rank, text }) => ({ id, rank, text }))
}
/** Collection iteration order is not query order, so rows compare by key. */
export function keyedRows(rows: ReadonlyArray<Row>): Array<Row> {
  return copyRows(rows).sort((a, b) => a.id.localeCompare(b.id))
}
