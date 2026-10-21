/**
 * Deterministic Node stand-ins for the Browser seams a coordinator uses.
 * `ControlledBroadcastChannel` performs real structuredClone and queues every
 * delivery until a test delivers it. `controlledLocks` grants Web Locks in
 * request order. They do not earn real-browser, multi-context, or worker
 * credit.
 */
type MessageHandler = (event: { data: unknown }) => void

type DelayedDelivery = {
  channel: string
  source: ControlledBroadcastChannel
  target: ControlledBroadcastChannel
  data: unknown
}

type CloneAttempt = {
  data: unknown
  errorName?: string
}

export class ControlledBroadcastChannel {
  static readonly endpoints = new Map<string, Set<ControlledBroadcastChannel>>()
  static readonly delayed: Array<DelayedDelivery> = []
  static readonly cloneAttempts: Array<CloneAttempt> = []
  static retiredDeliveries = 0

  readonly name: string
  onmessage: MessageHandler | null = null

  constructor(name: string) {
    this.name = name
    const peers = ControlledBroadcastChannel.endpoints.get(name) ?? new Set()
    peers.add(this)
    ControlledBroadcastChannel.endpoints.set(name, peers)
  }

  postMessage(data: unknown): void {
    let copy: unknown
    try {
      copy = structuredClone(data)
      ControlledBroadcastChannel.cloneAttempts.push({ data })
    } catch (error) {
      ControlledBroadcastChannel.cloneAttempts.push({
        data,
        errorName: error instanceof Error ? error.name : String(error),
      })
      throw error
    }

    for (const target of ControlledBroadcastChannel.endpoints.get(this.name) ??
      []) {
      if (target === this || !target.onmessage) continue
      ControlledBroadcastChannel.delayed.push({
        channel: this.name,
        source: this,
        target,
        data: copy,
      })
    }
  }

  close(): void {
    const peers = ControlledBroadcastChannel.endpoints.get(this.name)
    peers?.delete(this)
    if (peers?.size === 0) {
      ControlledBroadcastChannel.endpoints.delete(this.name)
    }
    for (
      let index = ControlledBroadcastChannel.delayed.length - 1;
      index >= 0;
      index--
    ) {
      const delivery = ControlledBroadcastChannel.delayed[index]
      if (delivery?.source === this || delivery?.target === this) {
        ControlledBroadcastChannel.delayed.splice(index, 1)
        ControlledBroadcastChannel.retiredDeliveries++
      }
    }
    this.onmessage = null
  }

  static deliverAt(index: number): boolean {
    const [delivery] = this.delayed.splice(index, 1)
    if (!delivery) return false
    delivery.target.onmessage?.({ data: delivery.data })
    return true
  }

  static deliverWhere(predicate: (data: unknown) => boolean): boolean {
    const index = this.delayed.findIndex((delivery) => predicate(delivery.data))
    return index >= 0 ? this.deliverAt(index) : false
  }

  static reset(): void {
    this.endpoints.clear()
    this.delayed.length = 0
    this.cloneAttempts.length = 0
    this.retiredDeliveries = 0
  }
}

type LockCallback = (lock: { name: string }) => Promise<unknown>
type LockQueueEntry = {
  callback: LockCallback
  signal?: AbortSignal
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export const heldLocks = new Set<string>()
export const queuedLocks = new Map<string, Array<LockQueueEntry>>()

function grantNextLock(name: string): void {
  if (heldLocks.has(name)) return
  const queue = queuedLocks.get(name)
  const next = queue?.shift()
  if (!next) return
  if (queue?.length === 0) queuedLocks.delete(name)
  if (next.signal?.aborted) {
    grantNextLock(name)
    return
  }

  heldLocks.add(name)
  void Promise.resolve(next.callback({ name })).then(
    (value) => {
      heldLocks.delete(name)
      next.resolve(value)
      grantNextLock(name)
    },
    (error) => {
      heldLocks.delete(name)
      next.reject(error)
      grantNextLock(name)
    },
  )
}

export const controlledLocks = {
  request: (
    name: string,
    optionsOrCallback: { signal?: AbortSignal } | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<unknown> => {
    const callback =
      typeof optionsOrCallback === `function`
        ? optionsOrCallback
        : maybeCallback!
    const signal =
      typeof optionsOrCallback === `object`
        ? optionsOrCallback.signal
        : undefined

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException(`Lock request aborted`, `AbortError`))
        return
      }
      const entry = { callback, signal, resolve, reject }
      const queue = queuedLocks.get(name) ?? []
      queue.push(entry)
      queuedLocks.set(name, queue)
      signal?.addEventListener(
        `abort`,
        () => {
          const current = queuedLocks.get(name)
          const index = current?.indexOf(entry) ?? -1
          if (index >= 0) {
            current!.splice(index, 1)
            if (current!.length === 0) queuedLocks.delete(name)
            reject(new DOMException(`Lock request aborted`, `AbortError`))
          }
        },
        { once: true },
      )
      grantNextLock(name)
    })
  },
}

let originalBroadcastChannelDescriptor: PropertyDescriptor | undefined
let originalNavigatorDescriptor: PropertyDescriptor | undefined

export function installControlledBrowserSeams(): void {
  originalBroadcastChannelDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    `BroadcastChannel`,
  )
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    `navigator`,
  )
  Object.defineProperty(globalThis, `BroadcastChannel`, {
    value: ControlledBroadcastChannel,
    writable: true,
    configurable: true,
  })
  Object.defineProperty(globalThis, `navigator`, {
    value: { locks: controlledLocks },
    writable: true,
    configurable: true,
  })
}

export function restoreControlledBrowserSeams(): void {
  if (originalBroadcastChannelDescriptor) {
    Object.defineProperty(
      globalThis,
      `BroadcastChannel`,
      originalBroadcastChannelDescriptor,
    )
  } else {
    Reflect.deleteProperty(globalThis, `BroadcastChannel`)
  }
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, `navigator`, originalNavigatorDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, `navigator`)
  }
  originalBroadcastChannelDescriptor = undefined
  originalNavigatorDescriptor = undefined
}
