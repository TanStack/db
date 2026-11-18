/**
 * Node and browser receiver for the shared on-demand stream family. All rows,
 * errors and ownership changes cross public Collection/query APIs and the real
 * standalone SDK. The controlled HTTP service supplies protocol lines only.
 * SDK method wrappers count forwarded callbacks and wait settlements; they do
 * not decide error policy, release resources, or supply model answers.
 */
import { parseLoadSubsetOptions } from '@tanstack/db'
import {
  PowerSyncClient,
  StreamError,
  powerSyncCollectionOptions,
} from '../src'
import { untilOnDemandStream } from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import {
  authoredStreamIdentity,
  ownerSubscriptions,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import { OnDemandService } from './on-demand-service'
import { createDirectInputLedger } from './direct-input-receiving'
import type {
  OnDemandStreamsAdapter,
  OnDemandStreamsSource,
} from '../../db-adapter-conformance/tests/on-demand-streams-driver'
import type {
  OnDemandStreamsHistory,
  StreamOwner,
  StreamRow,
} from '../../db-adapter-conformance/tests/on-demand-streams-oracle'
import type { HealthReportCounts } from '../../db-adapter-conformance/tests/health-report-handoff'

export function directOnDemandStreamsAdapter({
  wrap,
}: {
  wrap?: (
    options: OnDemandStreamsSource['options'],
    history: OnDemandStreamsHistory,
    id: string,
    input: ReturnType<typeof createDirectInputLedger>,
  ) =>
    | {
        options: OnDemandStreamsSource['options']
        dispose?: () => unknown
        receiveHealthReports?: () => Promise<HealthReportCounts>
        receiveRequestWork?: () => Promise<void>
        emptyMappingCut?: `load-admission`
      }
    | Promise<{
        options: OnDemandStreamsSource['options']
        dispose?: () => unknown
        receiveHealthReports?: () => Promise<HealthReportCounts>
        receiveRequestWork?: () => Promise<void>
        emptyMappingCut?: `load-admission`
      }>
} = {}): OnDemandStreamsAdapter {
  return {
    open: async (h, id, controls) => {
      const service = new OnDemandService()
      const input = createDirectInputLedger()
      const client = new PowerSyncClient({
        endpoint: `http://localhost:8080`,
        getToken: () => `token`,
        fetch: service.fetch,
        retryDelayMs: 1,
      })
      const requested: Array<StreamOwner> = []
      const relation = ownerSubscriptions(h)
      const mapperFailure = new Error(`mapping-${h.coordinate}`)
      let mapperThrown = false
      const leases = new Set<{ streams: Array<string>; release: () => void }>()
      let errors = 0
      const identities = new Set<unknown>()
      let fulfilled = 0
      let acquired = 0
      const acquire = client.acquireStreams.bind(client)
      client.acquireStreams = (streams, options = {}) => {
        acquired++
        const actual = input.lease(
          acquire(streams, {
            ...options,
            onError: (error) => {
              errors++
              identities.add(error)
              options.onError?.(error)
            },
          }),
        )
        const record = {
          streams: streams.map(authoredStreamIdentity),
          release: () => actual.release(),
        }
        leases.add(record)
        return {
          release: () => {
            leases.delete(record)
            actual.release()
          },
          waitForSync: (signal) => {
            const wait = actual.waitForSync(signal)
            void wait.then(
              () => {
                fulfilled++
              },
              () => {},
            )
            return wait
          },
        }
      }
      const options = powerSyncCollectionOptions<StreamRow>({
        id,
        client,
        table: `rows`,
        parse: (row) => row as StreamRow,
        getSubscriptions: (request) => {
          const { filters } = parseLoadSubsetOptions(request)
          const owner = filters.find(
            (filter) =>
              filter.field[0] === `left` || filter.field[0] === `right`,
          )?.field[0]
          if (owner !== `left` && owner !== `right`)
            throw new Error(`Receiver expected a left or right equality demand`)
          requested.push(owner)
          controls.onSubscriptions(request)
          if (
            h.kind === `mapper` &&
            h.operation === `throw` &&
            owner === `right` &&
            !mapperThrown
          ) {
            mapperThrown = true
            throw mapperFailure
          }
          return relation[owner]
        },
      })
      let receiveAppliedWork = async () => {
        await input.drain(`applied`)
      }
      const deliver = async (
        rows: ReadonlyArray<StreamRow>,
        failed: ReadonlyArray<string>,
        version: number,
      ) => {
        const before = errors
        const notifications = [...leases].filter((lease) =>
          lease.streams.some((stream) => failed.includes(stream)),
        ).length
        // These two histories deliberately hold application behind a local
        // optimistic transaction. Their provider cut records pending receipts
        // rather than waiting away the state the shared model must inspect.
        const holdsApplication =
          (h.kind === `settlement` && h.timing === `before-application`) ||
          (h.kind === `mapper` && h.operation === `empty` && version === 1)
        const delivery = {
          requestRevision: () => service.requestRevision,
          requestOpen: () => service.live,
          deliver: () => service.checkpoint(rows, failed, version),
          additionalRevision: () => requested.length,
        }
        let received = await input.receive({
          ...delivery,
          cut: holdsApplication ? `provider` : `applied`,
        })
        // Retain the exact last authored input, including a failed checkpoint.
        // Application can replay an acquisition after the provider cut returns.
        // Continuing answers only a genuinely newer request, with no duplicate
        // checkpoint for the transport that already consumed this input.
        receiveAppliedWork = async () => {
          received = await input.continue({
            ...delivery,
            deliveredRequest: received.deliveredRequest!,
          })
        }
        if (notifications)
          await untilOnDemandStream(
            () => errors >= before + notifications,
            `SDK delivered every active failed-lease callback`,
          )
        // The forwarded wait's consumers run in subsequent microtasks. No later
        // provider event is supplied to repair their health or readiness result.
        await Promise.resolve()
        await Promise.resolve()
      }
      const upstream = options.sync
      const receivingOptions = {
        ...options,
        sync: {
          ...upstream,
          sync: (params: Parameters<typeof upstream.sync>[0]) =>
            upstream.sync({
              ...params,
              commit: (signal) => input.receipt(params.commit(signal)),
            }),
        },
      }
      const wrapped = await wrap?.(receivingOptions, h, id, input)
      return {
        options: wrapped?.options ?? receivingOptions,
        deliver,
        receiveAppliedWork: () => receiveAppliedWork(),
        recover: async (rows) => {
          await untilOnDemandStream(
            () => service.live,
            `remaining owner has an open provider request`,
          )
          const before = service.requests.length
          service.close()
          await untilOnDemandStream(
            () => service.requests.length > before && service.live,
            `SDK reconnects before recovery checkpoint`,
          )
          await deliver(rows, [], 3)
        },
        requestedOwners: () => requested,
        deliveredErrors: () => errors,
        distinctErrorIdentities: () => identities.size,
        fulfilledProviderWaits: () => fulfilled,
        errorStream: (cause) =>
          cause instanceof StreamError
            ? authoredStreamIdentity(cause.stream)
            : `connection`,
        providerState: () => client.status.state,
        activeStreams: () => [...leases].flatMap((lease) => lease.streams),
        acquiredLeases: () => acquired,
        emptyMappingCut: wrapped?.emptyMappingCut ?? `provider-wait`,
        forwardedSubscriptions: () =>
          service.subscriptions.map((stream) => ({
            name: stream.stream,
            ...(Object.keys(stream.parameters).length
              ? { parameters: stream.parameters }
              : {}),
            ...(stream.override_priority !== null
              ? { priority: stream.override_priority }
              : {}),
          })),
        describeFailure: (cause) =>
          cause instanceof StreamError
            ? {
                kind: `stream`,
                stream: authoredStreamIdentity(cause.stream),
                messages: [...cause.messages],
              }
            : cause === mapperFailure
              ? { kind: `mapper`, message: mapperFailure.message }
              : { kind: `other` },
        ...(wrapped?.receiveHealthReports
          ? { receiveHealthReports: wrapped.receiveHealthReports }
          : {}),
        ...(wrapped?.receiveRequestWork
          ? { receiveRequestWork: wrapped.receiveRequestWork }
          : {}),
        dispose: async () => {
          // Completed public cuts already expose a leaked provider session.
          // Release any remaining real leases only during fixture teardown.
          for (const lease of leases) lease.release()
          await untilOnDemandStream(
            () => client.status.state === `idle`,
            `Collection cleanup released SDK resources`,
          )
          await wrapped?.dispose?.()
        },
      }
    },
  }
}
