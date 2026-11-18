/**
 * The real ShapeStream parses field values. HTTP supplies full shape-log or
 * requestSnapshot response bodies; no subscriber or receipt is replaced.
 * The existing SDK owner's adapter loadSubset entry supplies acquisitions.
 */
import { IR, createCollection } from '@tanstack/db'
import { ShapeStream } from '@electric-sql/client'
import { electricCollectionOptions } from '../src/electric'
import {
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { electricApplicationRows } from './cross-adapter-rows'
import { CrossAdapterElectricHTTP, untilElectric } from './cross-adapter-http'
import type {
  DecoderHistory,
  DecoderObservation,
  DecoderRow,
} from './sdk-decoder-oracle'

export type DecoderFault =
  | `cleanup-only`
  | `mismatch-and-cleanup`
  | `wrong-parser-value`
  | `missing-ready`

export async function observeDecoder(
  h: DecoderHistory,
  id: string,
  fault?: DecoderFault,
): Promise<DecoderObservation> {
  let deliveries = 0
  const subscribe = ShapeStream.prototype.subscribe
  // Count completion of the real SDK subscriber invocation while forwarding
  // every message and callback result. Wrong rows and absent readiness must
  // reach the comparison instead of becoming an expected-value polling timeout.
  ShapeStream.prototype.subscribe = function (callback, onError) {
    return subscribe.call(
      this,
      (messages) => {
        const complete = messages.some(
          (message) => message.headers.control === `up-to-date`,
        )
        const result = callback(messages)
        void Promise.resolve(result).then(
          () => {
            if (complete) deliveries++
          },
          () => {
            if (complete) deliveries++
          },
        )
        return result
      },
      onError,
    )
  }
  return withOracleCleanup(
    () => recordDecoder(h, id, () => deliveries, fault),
    [
      () => {
        ShapeStream.prototype.subscribe = subscribe
      },
    ],
  )
}

async function recordDecoder(
  h: DecoderHistory,
  id: string,
  deliveries: () => number,
  fault?: DecoderFault,
): Promise<DecoderObservation> {
  const http = new CrossAdapterElectricHTTP()
  const failure = new Error(`field refused ${h.coordinate}-${h.refusalIndex}`)
  let refusing = false,
    refusalParsed = false,
    prefixParsed = false,
    transformedKeyParsed = false,
    terminal: unknown,
    runs = 0,
    snapshot = 0
  const options = electricCollectionOptions<DecoderRow>({
    id,
    getKey: (row) => row.id,
    syncMode: h.mode,
    shapeOptions: {
      url: `http://electric/decoder-${id}`,
      params: { table: `rows` },
      fetchClient: http.fetchClient,
      parser: {
        text: (value) => {
          transformedKeyParsed = true
          return value.replace(`source:`, `app:`)
        },
        int4: (value) => {
          if (value === `refuse`) {
            refusalParsed = true
            throw failure
          }
          if (refusing) prefixParsed = true
          return Number(value) + (fault === `wrong-parser-value` ? 1 : 0)
        },
      },
      onError: (error) => {
        terminal = error
        return undefined
      },
    },
  })
  const sync = options.sync.sync
  options.sync.sync = (params) => {
    runs++
    return sync({
      ...params,
      markReady: () => {
        if (fault !== `missing-ready`) params.markReady()
      },
    })
  }
  const collection = createCollection(options)
  const rows = () => electricApplicationRows(collection.values())
  const input = (next: boolean, bad: boolean) =>
    Array.from({ length: h.count }, (_, i) => ({
      id: `source:${h.coordinate}-${i}`,
      value:
        bad && i === h.refusalIndex
          ? `refuse`
          : String(h.coordinate + i + (next ? 10 : 0)),
    }))
  const publications: Array<Array<DecoderRow>> = []
  let recording = false
  const subscription = collection.subscribeChanges(() => {
    if (recording) publications.push(rows())
  })
  const load = async (next: boolean, bad: boolean) => {
    refusing = bad
    if (h.mode === `eager`) {
      const beforeDelivery = deliveries()
      http.stage(input(next, bad))
      if (bad) {
        await untilElectric(
          () => terminal !== undefined,
          `shape-log parser error given up`,
        )
        await http.settle()
        return { outcome: `rejected`, error: terminal }
      }
      await untilElectric(
        () => deliveries() > beforeDelivery,
        `actual ShapeStream subscriber delivery completed`,
      )
      await http.settle()
      return { outcome: `fulfilled`, error: undefined }
    }
    const pending = Promise.resolve(
      collection._sync.loadSubset({
        where: new IR.Func(`gte`, [
          new IR.PropRef([`value`]),
          new IR.Value(snapshot++),
        ]),
      }),
    ).then(
      () => ({ outcome: `fulfilled`, error: undefined }),
      (error: unknown) => ({ outcome: `rejected`, error }),
    )
    const request = await http.take(true)
    request.respond(
      new Response(
        JSON.stringify({
          metadata: {
            xmin: `10`,
            xmax: `20`,
            xip_list: [],
            database_lsn: `10`,
            snapshot_mark: snapshot,
          },
          data: input(next, bad).map((row) => ({
            key: row.id,
            value: row,
            headers: { operation: `insert` },
          })),
        }),
        {
          headers: {
            'electric-handle': http.handle,
            'electric-offset': `${snapshot}_0`,
            'electric-schema': JSON.stringify(http.schema),
          },
        },
      ),
    )
    const result = await pending
    await http.settle()
    return result
  }
  const result =
    await retainOracleCleanupObservation<DecoderObservation>(async () => {
      const preload = collection.preload()
      void preload.catch(() => {})
      if (h.phase === `live`) await load(false, false)
      const before = rows()
      recording = true
      const attempt = await load(true, h.outcome === `throw`)
      recording = false
      const afterAttempt = rows(),
        status = collection.status,
        sourceErrors = collection.health.hasErrors,
        sourceError = collection.health.error !== null,
        sourceFailureReason = collection.health.failureReason !== null,
        sourceCauseMatches = collection.health.error?.cause === failure
      const attemptedPublications = structuredClone(publications)
      if (h.outcome === `throw`) {
        refusing = false
        if (h.mode === `eager`) {
          const reloaded = collection.reload()
          await load(true, false)
          await reloaded
        } else await load(true, false)
      }
      return {
        before,
        afterAttempt:
          fault === `mismatch-and-cleanup`
            ? [{ id: `incorrect`, value: -1 }]
            : afterAttempt,
        publications: attemptedPublications,
        attempt: attempt.outcome,
        errorMatches: attempt.error === failure,
        status,
        sourceErrors,
        sourceError,
        sourceFailureReason,
        sourceCauseMatches,
        nextRows: rows(),
        nextStatus: collection.status,
        nextSourceErrors: collection.health.hasErrors,
        runs,
        refusalParsed,
        prefixParsed,
        transformedKeyParsed,
        providerReleased: false,
      }
    }, [
      () => subscription.unsubscribe(),
      async () => {
        await collection.cleanup()
        if (fault === `cleanup-only` || fault === `mismatch-and-cleanup`)
          throw new Error(`injected decoder cleanup failure`)
      },
      () => http.settle(),
    ])
  return { ...result, providerReleased: http.pending.length === 0 }
}
