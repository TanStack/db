/**
 * IndexedDB storage for persisting OpenTelemetry spans when offline
 */
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base"

export interface SerializedSpan {
  name: string
  spanContext: {
    traceId: string
    spanId: string
    traceFlags: number
  }
  parentSpanId?: string
  startTime: [number, number]
  endTime: [number, number]
  status: { code: number; message?: string }
  attributes: Record<string, any>
  events: Array<any>
  links: Array<any>
  kind: number
  resource: Record<string, any>
  instrumentationLibrary: { name: string; version?: string }
}

interface StoredSpan {
  id: string
  span: SerializedSpan
  timestamp: number
  retryCount: number
}

export class OTelSpanStorage {
  private dbName = `otel-spans`
  private storeName = `failed-spans`
  private db: IDBDatabase | null = null
  private maxRetries = 5

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: `id` })
          store.createIndex(`timestamp`, `timestamp`, { unique: false })
          store.createIndex(`retryCount`, `retryCount`, { unique: false })
        }
      }
    })
  }

  async store(spanData: SerializedSpan): Promise<void> {
    if (!this.db) await this.init()

    const storedSpan: StoredSpan = {
      id: crypto.randomUUID(),
      span: spanData,
      timestamp: Date.now(),
      retryCount: 0,
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readwrite`)
      const store = transaction.objectStore(this.storeName)
      const request = store.add(storedSpan)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getAll(): Promise<Array<StoredSpan>> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readonly`)
      const store = transaction.objectStore(this.storeName)
      const request = store.getAll()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async remove(id: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readwrite`)
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(id)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async incrementRetryCount(id: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readwrite`)
      const store = transaction.objectStore(this.storeName)
      const getRequest = store.get(id)

      getRequest.onsuccess = () => {
        const storedSpan = getRequest.result as StoredSpan

        storedSpan.retryCount++

        // Remove if max retries exceeded
        if (storedSpan.retryCount > this.maxRetries) {
          console.warn(`Max retries exceeded for span ${id}, removing`)
          this.remove(id).then(resolve).catch(reject)
          return
        }

        const putRequest = store.put(storedSpan)
        putRequest.onsuccess = () => resolve()
        putRequest.onerror = () => reject(putRequest.error)
      }

      getRequest.onerror = () => reject(getRequest.error)
    })
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readwrite`)
      const store = transaction.objectStore(this.storeName)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getCount(): Promise<number> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], `readonly`)
      const store = transaction.objectStore(this.storeName)
      const request = store.count()

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
}

/**
 * Serialize a ReadableSpan to a plain object that can be stored in IndexedDB
 */
export function serializeSpan(span: ReadableSpan): SerializedSpan {
  return {
    name: span.name,
    spanContext: {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      traceFlags: span.spanContext().traceFlags,
    },
    parentSpanId: span.parentSpanId,
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    attributes: span.attributes,
    events: span.events,
    links: span.links,
    kind: span.kind,
    resource: span.resource.attributes,
    instrumentationLibrary: span.instrumentationLibrary,
  }
}

/**
 * Deserialize a stored span back into a format the exporter can use
 */
export function deserializeSpan(serialized: SerializedSpan): any {
  return {
    name: serialized.name,
    spanContext: () => serialized.spanContext,
    parentSpanId: serialized.parentSpanId,
    startTime: serialized.startTime,
    endTime: serialized.endTime,
    status: serialized.status,
    attributes: serialized.attributes,
    events: serialized.events,
    links: serialized.links,
    kind: serialized.kind,
    resource: {
      attributes: serialized.resource,
    },
    instrumentationLibrary: serialized.instrumentationLibrary,
    duration: serialized.endTime,
    ended: true,
  }
}
