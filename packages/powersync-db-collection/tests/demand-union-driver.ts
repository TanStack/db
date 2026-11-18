/**
 * The actual SDK SQLite table receives concurrent native adapter demands.
 * Public direct subscriptions acquire and release them. Successful loads drain
 * initial source reads. For later updates, the real SDK change callback must
 * finish before the recorder reads public rows. These barriers never poll for
 * expected rows or readiness, and provide no replacement writes.
 */
import { Schema, Table, column } from '@powersync/common'
import { IR, createCollection, eq, lte } from '@tanstack/db'
import { z } from 'zod'
import { untilStartup } from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { powerSyncCollectionOptions } from '../src'
import { unionRows } from './demand-union-oracle'
import { retainNativeObservation } from './receiving-cleanup'
import type { NativeReceivingOpen } from './hook-lifecycle-driver'
import type {
  UnionHistory,
  UnionObservation,
  UnionScope,
  UnionState,
} from './demand-union-oracle'

const schema = new Schema({
  rows: new Table({ rank: column.integer, value: column.text }),
})
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function observeDemandUnion(
  open: NativeReceivingOpen,
  h: UnionHistory,
  id: string,
): Promise<UnionObservation> {
  const source = await open(schema)
  return retainNativeObservation<UnionObservation>(async () => {
    const database = source.database
    let callbacks = 0
    const register = database.onChangeWithCallback.bind(database)
    database.onChangeWithCallback = (handler, options) =>
      register(
        {
          ...handler,
          onChange: async (...args) => {
            await handler?.onChange(...args)
            callbacks++
          },
        },
        options,
      )
    let triggerSetups = 0
    const createTrigger = database.triggers.createDiffTrigger.bind(
      database.triggers,
    )
    database.triggers.createDiffTrigger = async (options) => {
      const disposer = await createTrigger(options)
      triggerSetups++
      return disposer
    }
    await database.writeTransaction(async (tx) => {
      for (const row of unionRows(h, 0))
        await tx.execute(`INSERT INTO rows(id,rank,value) VALUES (?,?,?)`, [
          row.id,
          row.rank,
          row.value,
        ])
    })
    const rawScopes: Array<{
      where: unknown
      limit: number | undefined
      aborted: () => boolean
    }> = []
    const options = powerSyncCollectionOptions({
      id,
      database,
      table: schema.props.rows,
      schema: z.object({ id: z.string(), rank: z.number(), value: z.string() }),
      onDeserializationError: () => {},
      syncMode: `on-demand`,
      onLoadSubset: (load) => {
        rawScopes.push({
          where: load.where,
          limit: load.limit,
          aborted: () => load.signal?.aborted ?? false,
        })
      },
    })
    const collection = createCollection(options)
    const subscriptions = new Map<
      UnionScope,
      ReturnType<typeof collection.subscribeChanges>
    >()
    const active: Array<UnionScope> = []
    const reached: Array<UnionState> = []
    const cuts: UnionObservation['cuts'] = []
    const retirementPublications: UnionObservation['retirementPublications'] =
      []
    let revision = 0
    let observingThirdRetirement = false
    const publicRows = () =>
      Array.from(collection.values(), ({ id: key, rank, value }) => ({
        id: key,
        rank,
        value,
      })).sort((a, b) => a.id.localeCompare(b.id))
    // This observation-only subscription requests no subset. Capture begins
    // before release and ends after the real rebuild and SQLite lock drain.
    const sourceSubscription = collection.subscribeChanges(() => {
      if (observingThirdRetirement)
        retirementPublications.push({ revision, rows: publicRows() })
    })
    const drain = async () => {
      await database.writeTransaction(() => Promise.resolve())
      for (let index = 0; index < 4; index++) await turn()
    }
    const cut = (name: string) => {
      cuts.push({
        name,
        active: [...active],
        revision,
        rows: publicRows(),
      })
    }
    const acquire = async (scope: UnionScope) => {
      const subscription = collection.subscribeChanges(() => {})
      subscriptions.set(scope, subscription)
      const before = rawScopes.length
      let load: true | Promise<void> | undefined
      subscription.requestSnapshot({
        where:
          scope === `all`
            ? undefined
            : scope === `left`
              ? lte(new IR.PropRef([`rank`]), h.pivot)
              : eq(new IR.PropRef([`rank`]), h.pivot + (h.overlap ? 0 : 1)),
        ...(scope === `all` && h.limited ? { limit: 2 } : {}),
        onLoadSubsetResult: (result) => {
          load = result
        },
      })
      if (load === undefined) throw new Error(`No subset result for ${scope}`)
      await load
      if (rawScopes.length !== before + 1)
        throw new Error(`Expected actual native acquisition for ${scope}`)
      active.push(scope)
      if (
        scope === `all` &&
        !rawScopes.some(
          (raw) =>
            raw.where === undefined &&
            raw.limit === (h.limited ? 2 : undefined) &&
            !raw.aborted(),
        )
      )
        throw new Error(
          `Native universal acquisition did not receive its authored predicate and limit`,
        )
      await drain()
      cut(`acquired ${scope}`)
    }
    const retire = async (scope: UnionScope) => {
      const before = triggerSetups
      observingThirdRetirement = scope === `right` && active.includes(`all`)
      subscriptions.get(scope)!.unsubscribe()
      subscriptions.delete(scope)
      active.splice(active.indexOf(scope), 1)
      // A remaining demand causes a real rebuild after physical eviction. Its
      // settled trigger creation and SQLite lock drain establish consumption.
      if (active.length) await untilStartup(() => triggerSetups > before)
      await drain()
      if (observingThirdRetirement) reached.push(`third-retirement-observed`)
      observingThirdRetirement = false
      cut(`retired ${scope}`)
    }
    const update = async () => {
      const before = callbacks
      revision++
      await database.writeTransaction(async (tx) => {
        for (const row of unionRows(h, revision))
          await tx.execute(`UPDATE rows SET value=? WHERE id=?`, [
            row.value,
            row.id,
          ])
      })
      await untilStartup(() => callbacks > before)
      await drain()
      cut(`changed values ${revision}`)
      reached.push(`changed-values`)
    }
    return retainNativeObservation<UnionObservation>(async () => {
      if (h.order === `broad-first`) await acquire(`all`)
      await acquire(`left`)
      if (h.order === `broad-first`) {
        reached.push(`broad-first`)
        await update()
      }
      await acquire(`right`)
      if (h.order === `broad-last`) {
        await acquire(`all`)
        reached.push(`broad-last`)
      }
      if (h.order === `narrow-only`)
        reached.push(h.overlap ? `narrow-only-overlap` : `narrow-only-disjoint`)
      else if (h.limited) reached.push(`limited-broad`)
      await update()
      await retire(`right`)
      if (active.includes(`all`)) reached.push(`third-retired-broad-remains`)
      await update()
      if (active.includes(`all`)) {
        await retire(`all`)
        reached.push(`broad-retired-narrow-remains`)
        await update()
      }
      if (
        rawScopes.filter((scope) => !scope.aborted()).length !== active.length
      )
        throw new Error(
          `Native acquisition cancellation differs from active scopes`,
        )
      return { cuts, retirementPublications, reached }
    }, [
      () => {
        for (const subscription of subscriptions.values())
          subscription.unsubscribe()
      },
      () => sourceSubscription.unsubscribe(),
      () => collection.cleanup(),
    ])
  }, [source.dispose])
}
