import { describe, expect, it } from 'vitest'
import { FakeService } from './fake-service'
import { OnDemandService } from './on-demand-service'

const healthy = { name: `rows`, is_default: false, errors: [] }
const rejected = (message = `bad arguments`) => ({
  ...healthy,
  errors: [{ subscription: 0, message }],
})

async function open(
  service: FakeService,
  subscriptions = [{ stream: `rows` }],
) {
  return service.fetch(`http://localhost/sync/stream`, {
    signal: new AbortController().signal,
    body: JSON.stringify({
      streams: { include_defaults: false, subscriptions },
      buckets: [],
    }),
  })
}

describe(`controlled service request resolution`, () => {
  it(`rejects a bucket when the request has no subscription or default`, async () => {
    const service = new FakeService()
    await open(service, [])
    expect(() => service.checkpoint([`rows`])).toThrow(/bucket.*rejected/)
  })

  it.each([
    { streams: [], failed: [], data: false },
    { streams: [`alpha`], failed: [`alpha`], data: false },
    { streams: [`alpha`, `beta`], failed: [`alpha`], data: true },
  ])(
    `sends row data only with authored successful support: $streams / $failed`,
    async ({ streams, failed, data }) => {
      const service = new OnDemandService()
      const response = await service.fetch(`http://localhost/sync/stream`, {
        signal: new AbortController().signal,
        body: JSON.stringify({
          streams: {
            include_defaults: false,
            subscriptions: streams.map((stream) => ({
              stream,
              parameters: {},
              override_priority: null,
            })),
          },
        }),
      })
      const reader = response.body!.getReader()
      const delivery = service.checkpoint(
        [{ id: `one`, left: 1, right: 1, value: 1 }],
        failed,
        0,
      )
      const lines: Array<Record<string, unknown>> = []
      while (!lines.at(-1)?.checkpoint_complete) {
        const { value } = await reader.read()
        lines.push(JSON.parse(new TextDecoder().decode(value)))
      }
      await delivery
      expect(lines.filter((line) => line.data)).toHaveLength(data ? 1 : 0)
      expect(
        (lines[0]!.checkpoint as { buckets: Array<unknown> }).buckets,
      ).toHaveLength(data ? 1 : 0)
      expect(lines.at(-1)!.checkpoint_complete).toEqual({
        last_op_id: (lines[0]!.checkpoint as { last_op_id: string }).last_op_id,
      })
      service.close()
      await reader.cancel()
    },
  )
  it.each([
    [healthy, rejected()],
    [rejected(), healthy],
    [rejected(), rejected(`different arguments`)],
  ])(
    `rejects changing a subscription outcome in the same response`,
    async (first, next) => {
      const service = new FakeService()
      await open(service)
      service.checkpoint([], { streams: [first] })
      expect(() => service.checkpoint([], { streams: [next] })).toThrow(
        /subscription resolution.*request/,
      )
    },
  )

  it(`allows an identical resolution and a different successor request`, async () => {
    const service = new FakeService()
    await open(service)
    service.checkpoint([], { streams: [rejected()] })
    service.checkpoint([], { streams: [rejected()] })
    service.close()
    await open(service)
    expect(() =>
      service.checkpoint([`rows`], { streams: [healthy] }),
    ).not.toThrow()
  })

  it(`rejects a bucket when every requested subscription failed`, async () => {
    const service = new FakeService()
    await open(service)
    expect(() =>
      service.checkpoint([`rows`], { streams: [rejected()] }),
    ).toThrow(/bucket.*rejected/)
  })

  it(`allows a bucket supported by an independent healthy subscription`, async () => {
    const service = new FakeService()
    await open(service, [{ stream: `rows` }, { stream: `peer` }])
    expect(() =>
      service.checkpoint([`rows`], {
        streams: [rejected(), { ...healthy, name: `peer` }],
      }),
    ).not.toThrow()
  })
})
