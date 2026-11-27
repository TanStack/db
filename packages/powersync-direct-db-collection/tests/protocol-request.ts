/**
 * The service resolves subscription arguments once per HTTP request. Fixtures
 * must author a new request/configuration before changing that result. This
 * guard validates provider premises; it computes no expected Collection state.
 * Authority: powersync-service BucketParameterState and its first checkpoint's
 * stream descriptions (b12e7776fd842c58cc774f3af97eb05ffbdb47c5).
 */
export type RequestedStreams = {
  include_defaults?: boolean
  subscriptions: ReadonlyArray<{
    stream: string
    parameters?: Record<string, unknown>
  }>
}
export type ResolvedStream = {
  name: string
  is_default: boolean
  errors: Array<{ subscription: number | `default`; message: string }>
}

/** One description per stream name, with request indices for its subscriptions. */
export function resolveStreams(
  request: RequestedStreams,
  reject: (
    subscription: RequestedStreams['subscriptions'][number],
  ) => string | undefined = () => undefined,
): Array<ResolvedStream> {
  const descriptions = new Map<string, ResolvedStream>()
  request.subscriptions.forEach((subscription, index) => {
    let description = descriptions.get(subscription.stream)
    if (!description) {
      description = { name: subscription.stream, is_default: false, errors: [] }
      descriptions.set(subscription.stream, description)
    }
    const message = reject(subscription)
    if (message !== undefined)
      description.errors.push({ subscription: index, message })
  })
  return [...descriptions.values()]
}

export class RequestResolution {
  private first: string | undefined
  constructor(private readonly request: RequestedStreams) {}

  hasResolvedSubscription(streams: ReadonlyArray<ResolvedStream>): boolean {
    return streams.some(
      (description) =>
        (this.request.include_defaults !== false &&
          description.is_default &&
          !description.errors.some(
            (error) => error.subscription === `default`,
          )) ||
        this.request.subscriptions.some(
          (subscription, index) =>
            subscription.stream === description.name &&
            !description.errors.some((error) => error.subscription === index),
        ),
    )
  }

  validate(
    streams: ReadonlyArray<ResolvedStream>,
    buckets: ReadonlyArray<string>,
  ): void {
    const signature = JSON.stringify(
      streams
        .map((stream) => ({
          name: stream.name,
          is_default: stream.is_default,
          errors: stream.errors
            .map((error) => [error.subscription, error.message])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    if (this.first !== undefined && this.first !== signature)
      throw new Error(
        `PowerSync fixture changed subscription resolution within one request`,
      )
    if (buckets.length && !this.hasResolvedSubscription(streams))
      throw new Error(
        `PowerSync fixture supplied a bucket with every subscription rejected`,
      )
    this.first = signature
  }
}
