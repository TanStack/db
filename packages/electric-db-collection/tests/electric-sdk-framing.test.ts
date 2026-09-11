import { expect, it, vi } from 'vitest'
import { ShapeStream } from '@electric-sql/client'
import type { Message } from '@electric-sql/client'

// Use the real SDK, not the ShapeStream mock in the adapter oracle. Its reset
// framing is the evidence for the oracle's singleton-reset partition rule.
it.each([false, true])(
  `isolates HTTP 409 reset callbacks with stale response rows=%s`,
  async (staleRows) => {
    const controller = new AbortController()
    const old = {
      key: `1`,
      value: { id: `1`, name: `discarded` },
      headers: { operation: `insert` },
    }
    const reset = { headers: { control: `must-refetch` } }
    const ready = {
      headers: { control: `up-to-date`, global_last_seen_lsn: `2` },
    }
    const headers = {
      'electric-handle': `old-shape`,
      'electric-offset': `1_0`,
      'electric-schema': JSON.stringify({
        id: { type: `int4` },
        name: { type: `text` },
      }),
    }
    const responses = [
      new Response(JSON.stringify([old]), { headers }),
      new Response(JSON.stringify(staleRows ? [old, reset, ready] : [reset]), {
        status: 409,
        headers: { 'electric-handle': `new-shape` },
      }),
      new Response(JSON.stringify([ready]), {
        headers: {
          ...headers,
          'electric-handle': `new-shape`,
          'electric-offset': `2_0`,
          'electric-cursor': `1`,
        },
      }),
    ]
    const batches: Array<Array<Message<{ id: number; name: string }>>> = []
    const stream = new ShapeStream<{ id: number; name: string }>({
      // The SDK caches expired handles/up-to-date offsets by shape URL.
      url: `http://test-url/v1/shape-${staleRows}`,
      params: { table: `rows` },
      signal: controller.signal,
      fetchClient: async () => {
        const response = responses.shift()
        if (response) return response
        return new Promise<Response>((_resolve, reject) => {
          if (controller.signal.aborted) reject(controller.signal.reason)
          else
            controller.signal.addEventListener(
              `abort`,
              () => reject(controller.signal.reason),
              { once: true },
            )
        })
      },
    })
    const unsubscribe = stream.subscribe((messages) => {
      batches.push(messages)
    })
    try {
      await vi.waitFor(() => expect(batches).toHaveLength(3))
      expect(batches[0]).toHaveLength(1)
      expect(batches[0]![0]).toMatchObject({
        value: { id: 1, name: `discarded` },
      })
      expect(batches[1]).toEqual([reset])
      expect(batches[2]).toEqual([ready])
    } finally {
      unsubscribe()
      controller.abort()
    }
  },
)
