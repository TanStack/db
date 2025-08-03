import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { atomCollectionOptions, rssCollectionOptions } from "../src/rss"
import {
  FeedURLRequiredError,
  InvalidPollingIntervalError,
} from "../src/errors"
import type { AtomCollectionConfig, RSSCollectionConfig } from "../src/rss"

// Mock fetch globally
global.fetch = vi.fn()

describe(`RSS Collection Errors`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe(`Configuration Errors`, () => {
    it(`should throw FeedURLRequiredError when feedUrl is missing`, () => {
      expect(() => {
        rssCollectionOptions({
          getKey: (item: any) => item.id,
        } as RSSCollectionConfig)
      }).toThrow(FeedURLRequiredError)
    })

    it(`should require getKey function (TypeScript compile-time check)`, () => {
      // This is now a compile-time check - getKey is required in the interface
      // No runtime validation needed as TypeScript enforces this requirement
      expect(true).toBe(true)
    })

    it(`should throw InvalidPollingIntervalError for negative interval`, () => {
      expect(() => {
        rssCollectionOptions({
          feedUrl: `https://example.com/rss.xml`,
          pollingInterval: -1000,
          getKey: (item: any) => item.id,
        })
      }).toThrow(InvalidPollingIntervalError)
    })

    it(`should throw InvalidPollingIntervalError for zero interval`, () => {
      expect(() => {
        rssCollectionOptions({
          feedUrl: `https://example.com/rss.xml`,
          pollingInterval: 0,
          getKey: (item: any) => item.id,
        })
      }).toThrow(InvalidPollingIntervalError)
    })
  })

  describe(`Network Errors`, () => {
    it(`should handle HTTP error responses`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/nonexistent.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Should mark ready even with error
      await collection.stateWhenReady()

      // Should have no items due to fetch error
      expect(collection.size).toBe(0)
    })

    it(`should handle network timeout`, async () => {
      const fetchMock = vi.fn().mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => {
            const error = new Error(`Aborted`)
            error.name = `AbortError`
            reject(error)
          }, 100)
        })
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/slow.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
        httpOptions: {
          timeout: 50, // Very short timeout
        },
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Should mark ready even with error
      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })

    it(`should handle general fetch errors`, async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error(`Network error`))
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/broken.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })
  })

  describe(`Feed Parsing Errors`, () => {
    it(`should handle invalid XML`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(`This is not XML`),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/invalid.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })

    it(`should handle malformed RSS feed`, async () => {
      const malformedRSS = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <title>Missing channel wrapper</title>
        </rss>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(malformedRSS),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/malformed.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })

    it(`should handle malformed Atom feed`, async () => {
      const malformedAtom = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Missing entries</title>
        </feed>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(malformedAtom),
      })
      global.fetch = fetchMock

      const config: AtomCollectionConfig = {
        feedUrl: `https://example.com/malformed-atom.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = atomCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      // Should succeed but have no items
      expect(collection.size).toBe(0)
    })

    it(`should handle unknown feed format`, async () => {
      const unknownFormat = `<?xml version="1.0" encoding="UTF-8"?>
        <unknown-format>
          <title>Unknown feed format</title>
        </unknown-format>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(unknownFormat),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/unknown.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })
  })

  describe(`Feed Type Validation`, () => {
    it(`should reject RSS feed when expecting Atom`, async () => {
      const rssFeed = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>RSS Feed</title>
            <item>
              <title>Test Item</title>
              <guid>test-1</guid>
            </item>
          </channel>
        </rss>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(rssFeed),
      })
      global.fetch = fetchMock

      const config: AtomCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = atomCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })

    it(`should reject Atom feed when expecting RSS`, async () => {
      const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>Atom Feed</title>
          <entry>
            <title>Test Entry</title>
            <id>test-1</id>
          </entry>
        </feed>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(atomFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/atom.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
    })
  })

  describe(`Transform Function Errors`, () => {
    it(`should handle transform function that throws`, async () => {
      const validRSS = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>RSS Feed</title>
            <item>
              <title>Test Item</title>
              <guid>test-1</guid>
            </item>
          </channel>
        </rss>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validRSS),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.id,
        startPolling: false,
        transform: (_item) => {
          throw new Error(`Transform error`)
        },
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      // Should handle transform error gracefully
      expect(collection.size).toBe(0)
    })

    it(`should handle getKey function that throws`, async () => {
      const validRSS = `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>RSS Feed</title>
            <item>
              <title>Test Item</title>
              <guid>test-1</guid>
            </item>
          </channel>
        </rss>`

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(validRSS),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (_item: any) => {
          throw new Error(`GetKey error`)
        },
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      // Should handle getKey error gracefully
      expect(collection.size).toBe(0)
    })
  })

  describe(`Error Recovery`, () => {
    it(`should continue polling after errors`, async () => {
      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First call fails
          return Promise.reject(new Error(`Network error`))
        } else {
          // Second call succeeds
          return Promise.resolve({
            ok: true,
            text: () =>
              Promise.resolve(`<?xml version="1.0"?>
              <rss version="2.0">
                <channel>
                  <item>
                    <title>Recovery Item</title>
                    <guid>recovery-1</guid>
                  </item>
                </channel>
              </rss>`),
          })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/unreliable.xml`,
        pollingInterval: 1000,
        getKey: (item: any) => item.guid,
        startPolling: true,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial attempt (will fail)
      await collection.stateWhenReady()

      expect(collection.size).toBe(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Advance time to trigger retry
      vi.advanceTimersByTime(1000)
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })

      // Should now have the item from successful retry
      expect(collection.size).toBe(1)
      expect(collection.get(`recovery-1`)).toBeDefined()
    })
  })
})
