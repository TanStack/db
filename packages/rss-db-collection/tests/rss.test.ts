import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { atomCollectionOptions, rssCollectionOptions } from "../src/rss"
import type {
  AtomCollectionConfig,
  AtomItem,
  RSSCollectionConfig,
  RSSItem,
} from "../src/rss"

// Mock fetch globally
global.fetch = vi.fn()

// Sample RSS feed XML
const sampleRSSFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <description>A test blog</description>
    <link>https://example.com</link>
    <item>
      <title>First Post</title>
      <description>This is the first post</description>
      <link>https://example.com/post1</link>
      <guid>post-1</guid>
      <pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate>
      <author>John Doe</author>
    </item>
    <item>
      <title>Second Post</title>
      <description>This is the second post</description>
      <link>https://example.com/post2</link>
      <guid>post-2</guid>
      <pubDate>Thu, 02 Jan 2025 12:00:00 GMT</pubDate>
      <author>Jane Smith</author>
    </item>
  </channel>
</rss>`

// Sample Atom feed XML
const sampleAtomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Blog</title>
  <subtitle>A test blog</subtitle>
  <link href="https://example.com"/>
  <id>https://example.com</id>
  <updated>2025-01-02T12:00:00Z</updated>
  <entry>
    <title>First Atom Post</title>
    <id>atom-post-1</id>
    <link href="https://example.com/atom-post1"/>
    <updated>2025-01-01T12:00:00Z</updated>
    <published>2025-01-01T10:00:00Z</published>
    <summary>This is the first atom post</summary>
    <author>
      <name>John Doe</name>
    </author>
  </entry>
  <entry>
    <title>Second Atom Post</title>
    <id>atom-post-2</id>
    <link href="https://example.com/atom-post2"/>
    <updated>2025-01-02T12:00:00Z</updated>
    <published>2025-01-02T10:00:00Z</published>
    <summary>This is the second atom post</summary>
    <author>
      <name>Jane Smith</name>
    </author>
  </entry>
</feed>`

interface TestBlogPost {
  id: string
  title: string
  description: string
  link: string
  publishedAt: Date
  author?: string
}

const getKey = (item: TestBlogPost) => item.id

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`RSS Collection`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe(`Basic RSS Functionality`, () => {
    it(`should fetch and parse RSS feed correctly`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        transform: (item: RSSItem) => ({
          id: item.guid || item.link || ``,
          title: item.title || ``,
          description: item.description || ``,
          link: item.link || ``,
          publishedAt: new Date(item.pubDate || Date.now()),
          author: item.author,
        }),
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial sync
      await collection.stateWhenReady()

      expect(fetchMock).toHaveBeenCalledWith(
        `https://example.com/rss.xml`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": `TanStack RSS Collection/1.0`,
            Accept: `application/rss+xml, application/atom+xml, application/xml, text/xml`,
          }),
        })
      )

      expect(collection.size).toBe(2)
      expect(collection.get(`post-1`)).toEqual({
        id: `post-1`,
        title: `First Post`,
        description: `This is the first post`,
        link: `https://example.com/post1`,
        publishedAt: new Date(`Wed, 01 Jan 2025 12:00:00 GMT`),
        author: `John Doe`,
      })
    })

    it(`should fetch and parse Atom feed correctly`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleAtomFeed),
      })
      global.fetch = fetchMock

      const config: AtomCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/atom.xml`,
        getKey,
        startPolling: false,
        transform: (item: AtomItem) => ({
          id: item.id || ``,
          title: typeof item.title === `string` ? item.title : ``,
          description: typeof item.summary === `string` ? item.summary : ``,
          link:
            typeof item.link === `object` && !Array.isArray(item.link)
              ? item.link.href || ``
              : ``,
          publishedAt: new Date(item.published || item.updated || Date.now()),
          author:
            typeof item.author === `object` && `name` in item.author
              ? item.author.name
              : undefined,
        }),
      }

      const options = atomCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      await flushPromises()

      expect(collection.size).toBe(2)
      expect(collection.get(`atom-post-1`)).toEqual({
        id: `atom-post-1`,
        title: `First Atom Post`,
        description: `This is the first atom post`,
        link: `https://example.com/atom-post1`,
        publishedAt: new Date(`2025-01-01T10:00:00Z`),
        author: `John Doe`,
      })
    })

    it(`should use default transform when none provided`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      await flushPromises()

      expect(collection.size).toBe(2)
      const firstItem = collection.get(`post-1`)
      expect(firstItem).toBeDefined()
      expect(firstItem?.title).toBe(`First Post`)
      expect(firstItem?.pubDate).toBeInstanceOf(Date)
    })
  })

  describe(`Polling Functionality`, () => {
    it(`should poll at specified interval`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 10000, // 10 seconds
        getKey: (item: any) => item.guid || item.link,
        startPolling: true,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial fetch
      await collection.stateWhenReady()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Advance time by polling interval
      vi.advanceTimersByTime(10000)
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(2)

      // Advance time again
      vi.advanceTimersByTime(10000)
      await flushPromises()

      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it(`should allow manual refresh`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 10000,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false, // Don't start automatically
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(fetchMock).toHaveBeenCalledTimes(1) // Initial fetch only

      // Manually refresh the feed
      await collection.utils.refresh()

      expect(fetchMock).toHaveBeenCalledTimes(2)

      // Refresh again
      await collection.utils.refresh()

      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it(`should allow refresh to be called before sync`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 10000,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Should not throw when refresh is called before sync
      await expect(collection.utils.refresh()).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe(`Deduplication`, () => {
    it(`should deduplicate items based on feed item IDs`, async () => {
      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // First call - return original feed
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(sampleRSSFeed),
          })
        } else {
          // Second call - return same feed (should deduplicate)
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(sampleRSSFeed),
          })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 5000,
        getKey: (item: any) => item.guid || item.link,
        startPolling: true,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(2)
      expect(collection.utils.getSeenItemsCount()).toBe(2)

      // Advance time to trigger another fetch
      vi.advanceTimersByTime(5000)
      await flushPromises()

      // Should still have the same items (deduplicated)
      expect(collection.size).toBe(2)
      expect(collection.utils.getSeenItemsCount()).toBe(2)
    })

    it(`should add new items when they appear`, async () => {
      const feedWithNewItem = sampleRSSFeed.replace(
        `</channel>`,
        `
        <item>
          <title>Third Post</title>
          <description>This is the third post</description>
          <link>https://example.com/post3</link>
          <guid>post-3</guid>
          <pubDate>Fri, 03 Jan 2025 12:00:00 GMT</pubDate>
        </item>
        </channel>`
      )

      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(sampleRSSFeed),
          })
        } else {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(feedWithNewItem),
          })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 5000,
        getKey: (item: any) => item.guid || item.link,
        startPolling: true,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(2)

      // Advance time to trigger fetch with new item
      vi.advanceTimersByTime(5000)
      await flushPromises()

      expect(collection.size).toBe(3)
      expect(collection.get(`post-3`)).toBeDefined()
    })

    it(`should clean up old seen items`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 1000, // 1 second for faster test
        maxSeenItems: 1, // Very low limit to test cleanup
        getKey: (item: any) => item.guid || item.link,
        startPolling: true,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.utils.getSeenItemsCount()).toBe(2)

      // Simulate time passing for cleanup (10 polling cycles)
      vi.advanceTimersByTime(11000)
      await flushPromises()

      // Should have cleaned up old items
      expect(collection.utils.getSeenItemsCount()).toBeLessThanOrEqual(1)
    })

    it(`should allow clearing seen items manually`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.utils.getSeenItemsCount()).toBe(2)

      collection.utils.clearSeenItems()
      expect(collection.utils.getSeenItemsCount()).toBe(0)
    })
  })

  describe(`Custom Configuration`, () => {
    it(`should respect custom HTTP options`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false,
        httpOptions: {
          timeout: 15000,
          userAgent: `Custom User Agent`,
          headers: {
            Authorization: `Bearer token123`,
          },
        },
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(fetchMock).toHaveBeenCalledWith(
        `https://example.com/rss.xml`,
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": `Custom User Agent`,
            Authorization: `Bearer token123`,
          }),
        })
      )
    })

    it(`should reject RSS feed when expecting Atom`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      // Use atomCollectionOptions with RSS feed URL - should fail
      const config: AtomCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.id || item.link,
        startPolling: false,
      }

      const options = atomCollectionOptions(config)
      const collection = createCollection(options)

      // Should mark ready even on error
      await collection.stateWhenReady()

      // Should have no items due to format mismatch error
      expect(collection.size).toBe(0)
    })

    it(`should reject Atom feed when expecting RSS`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleAtomFeed),
      })
      global.fetch = fetchMock

      // Use rssCollectionOptions with Atom feed URL - should fail
      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/atom.xml`,
        getKey: (item: any) => item.id || item.link,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Should mark ready even on error
      await collection.stateWhenReady()

      // Should have no items due to format mismatch error
      expect(collection.size).toBe(0)
    })
  })
})
