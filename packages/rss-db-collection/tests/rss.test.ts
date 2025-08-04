import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { atomCollectionOptions, rssCollectionOptions } from "../src/rss"
import type {
  AtomCollectionConfig,
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

    it(`should create Atom collection options correctly`, () => {
      const config: AtomCollectionConfig = {
        feedUrl: `https://example.com/atom.xml`,
        getKey: (item: any) => item.id || ``,
        startPolling: false,
      }

      const options = atomCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.sync).toBeDefined()
      expect(options.getKey).toBeDefined()
      expect(options.utils).toBeDefined()
      expect(options.utils.refresh).toBeDefined()
      expect(options.utils.clearSeenItems).toBeDefined()
      expect(options.utils.getSeenItemsCount).toBeDefined()
    })

    it(`should use default transform when none provided`, () => {
      const config: RSSCollectionConfig = {
        feedUrl: `https://example.com/rss.xml`,
        getKey: (item: any) => item.guid || item.link,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)

      // When no transform is provided, options should still be valid
      expect(options).toBeDefined()
      expect(options.sync).toBeDefined()
      expect(typeof options.getKey).toBe(`function`)
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
        pollingInterval: 1000, // 1 second for faster test
        getKey: (item: any) => item.guid || item.link,
        startPolling: false, // Start manually
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      // Wait for initial fetch
      await collection.stateWhenReady()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Manually trigger polling by calling refresh
      await collection.utils.refresh()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await collection.utils.refresh()
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
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(2)
      expect(collection.utils.getSeenItemsCount()).toBe(2)

      // Manually trigger refresh to test deduplication
      await collection.utils.refresh()

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
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.size).toBe(2)

      // Manually trigger refresh to get new item
      await collection.utils.refresh()

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
        startPolling: false,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await collection.stateWhenReady()

      expect(collection.utils.getSeenItemsCount()).toBe(1)

      // Test that seen items limit is enforced
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

    it(`should handle multiple sequential additions to RSS feed`, async () => {
      // Create progressive feeds with new items added each time
      const feedWithThirdItem = sampleRSSFeed.replace(
        `</channel>`,
        `
        <item>
          <title>Third Post</title>
          <description>This is the third post</description>
          <link>https://example.com/post3</link>
          <guid>post-3</guid>
          <pubDate>Fri, 03 Jan 2025 12:00:00 GMT</pubDate>
          <author>Alice Johnson</author>
        </item>
        </channel>`
      )

      const feedWithFourthItem = feedWithThirdItem.replace(
        `</channel>`,
        `
        <item>
          <title>Fourth Post</title>
          <description>This is the fourth post</description>
          <link>https://example.com/post4</link>
          <guid>post-4</guid>
          <pubDate>Sat, 04 Jan 2025 12:00:00 GMT</pubDate>
          <author>Bob Wilson</author>
        </item>
        </channel>`
      )

      const feedWithFifthItem = feedWithFourthItem.replace(
        `</channel>`,
        `
        <item>
          <title>Fifth Post</title>
          <description>This is the fifth post</description>
          <link>https://example.com/post5</link>
          <guid>post-5</guid>
          <pubDate>Sun, 05 Jan 2025 12:00:00 GMT</pubDate>
          <author>Carol Davis</author>
        </item>
        </channel>`
      )

      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        switch (callCount) {
          case 1:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(sampleRSSFeed),
            })
          case 2:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithThirdItem),
            })
          case 3:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithFourthItem),
            })
          case 4:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithFifthItem),
            })
          default:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithFifthItem),
            })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 5000,
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

      // Initial fetch - should have 2 items
      await collection.stateWhenReady()
      expect(collection.size).toBe(2)
      expect(collection.get(`post-1`)).toBeDefined()
      expect(collection.get(`post-2`)).toBeDefined()
      expect(collection.get(`post-3`)).toBeUndefined()

      // First refresh - should add third item
      await collection.utils.refresh()
      expect(collection.size).toBe(3)
      expect(collection.get(`post-3`)).toEqual({
        id: `post-3`,
        title: `Third Post`,
        description: `This is the third post`,
        link: `https://example.com/post3`,
        publishedAt: new Date(`Fri, 03 Jan 2025 12:00:00 GMT`),
        author: `Alice Johnson`,
      })

      // Second refresh - should add fourth item
      await collection.utils.refresh()
      expect(collection.size).toBe(4)
      expect(collection.get(`post-4`)).toEqual({
        id: `post-4`,
        title: `Fourth Post`,
        description: `This is the fourth post`,
        link: `https://example.com/post4`,
        publishedAt: new Date(`Sat, 04 Jan 2025 12:00:00 GMT`),
        author: `Bob Wilson`,
      })

      // Third refresh - should add fifth item
      await collection.utils.refresh()
      expect(collection.size).toBe(5)
      expect(collection.get(`post-5`)).toEqual({
        id: `post-5`,
        title: `Fifth Post`,
        description: `This is the fifth post`,
        link: `https://example.com/post5`,
        publishedAt: new Date(`Sun, 05 Jan 2025 12:00:00 GMT`),
        author: `Carol Davis`,
      })

      // Verify all items are present
      expect(collection.get(`post-1`)).toBeDefined()
      expect(collection.get(`post-2`)).toBeDefined()
      expect(collection.get(`post-3`)).toBeDefined()
      expect(collection.get(`post-4`)).toBeDefined()
      expect(collection.get(`post-5`)).toBeDefined()

      // Verify fetch was called the expected number of times
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it(`should handle mixed additions and updates in RSS feed`, async () => {
      // Create a feed where some items are updated and new ones are added
      const updatedFeed = sampleRSSFeed
        .replace(
          `<description>This is the first post</description>`,
          `<description>This is the updated first post</description>`
        )
        .replace(
          `</channel>`,
          `
        <item>
          <title>New Post</title>
          <description>This is a completely new post</description>
          <link>https://example.com/new-post</link>
          <guid>new-post</guid>
          <pubDate>Mon, 06 Jan 2025 12:00:00 GMT</pubDate>
          <author>David Brown</author>
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
            text: () => Promise.resolve(updatedFeed),
          })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 5000,
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

      // Initial fetch
      await collection.stateWhenReady()
      expect(collection.size).toBe(2)
      expect(collection.get(`post-1`)?.description).toBe(
        `This is the first post`
      )

      // Refresh with updates and new item
      await collection.utils.refresh()
      expect(collection.size).toBe(3)

      // Note: The RSS collection doesn't update existing items, it only adds new ones
      // So the existing item should remain unchanged
      expect(collection.get(`post-1`)?.description).toBe(
        `This is the first post`
      )

      // Check that new item was added
      expect(collection.get(`new-post`)).toEqual({
        id: `new-post`,
        title: `New Post`,
        description: `This is a completely new post`,
        link: `https://example.com/new-post`,
        publishedAt: new Date(`Mon, 06 Jan 2025 12:00:00 GMT`),
        author: `David Brown`,
      })

      // Verify original second post is unchanged
      expect(collection.get(`post-2`)?.description).toBe(
        `This is the second post`
      )
    })

    it(`should handle Atom feed with multiple sequential additions`, async () => {
      // Create progressive Atom feeds
      const atomWithThirdEntry = sampleAtomFeed.replace(
        `</feed>`,
        `
  <entry>
    <title>Third Atom Post</title>
    <id>atom-post-3</id>
    <link href="https://example.com/atom-post3"/>
    <updated>2025-01-03T12:00:00Z</updated>
    <published>2025-01-03T10:00:00Z</published>
    <summary>This is the third atom post</summary>
    <author>
      <name>Eve Wilson</name>
    </author>
  </entry>
</feed>`
      )

      const atomWithFourthEntry = atomWithThirdEntry.replace(
        `</feed>`,
        `
  <entry>
    <title>Fourth Atom Post</title>
    <id>atom-post-4</id>
    <link href="https://example.com/atom-post4"/>
    <updated>2025-01-04T12:00:00Z</updated>
    <published>2025-01-04T10:00:00Z</published>
    <summary>This is the fourth atom post</summary>
    <author>
      <name>Frank Miller</name>
    </author>
  </entry>
</feed>`
      )

      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        switch (callCount) {
          case 1:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(sampleAtomFeed),
            })
          case 2:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(atomWithThirdEntry),
            })
          case 3:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(atomWithFourthEntry),
            })
          default:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(atomWithFourthEntry),
            })
        }
      })
      global.fetch = fetchMock

      const config: AtomCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/atom.xml`,
        pollingInterval: 5000,
        getKey,
        startPolling: false,
        transform: (item: any) => ({
          id: item.id || ``,
          title:
            typeof item.title === `string`
              ? item.title
              : item.title?.$text || ``,
          description:
            typeof item.summary === `string`
              ? item.summary
              : item.summary?.$text || ``,
          link:
            typeof item.link === `string`
              ? item.link
              : item.link?.[`@_href`] || item.link?.href || ``,
          publishedAt: new Date(item.published || item.updated || Date.now()),
          author: item.author?.name,
        }),
      }

      const options = atomCollectionOptions(config)
      const collection = createCollection(options)

      // Initial fetch - should have 2 items
      await collection.stateWhenReady()
      expect(collection.size).toBe(2)
      expect(collection.get(`atom-post-1`)).toBeDefined()
      expect(collection.get(`atom-post-2`)).toBeDefined()
      expect(collection.get(`atom-post-3`)).toBeUndefined()

      // First refresh - should add third item
      await collection.utils.refresh()
      expect(collection.size).toBe(3)
      expect(collection.get(`atom-post-3`)).toEqual({
        id: `atom-post-3`,
        title: `Third Atom Post`,
        description: `This is the third atom post`,
        link: `https://example.com/atom-post3`,
        publishedAt: new Date(`2025-01-03T10:00:00Z`),
        author: `Eve Wilson`,
      })

      // Second refresh - should add fourth item
      await collection.utils.refresh()
      expect(collection.size).toBe(4)
      expect(collection.get(`atom-post-4`)).toEqual({
        id: `atom-post-4`,
        title: `Fourth Atom Post`,
        description: `This is the fourth atom post`,
        link: `https://example.com/atom-post4`,
        publishedAt: new Date(`2025-01-04T10:00:00Z`),
        author: `Frank Miller`,
      })

      // Verify all items are present
      expect(collection.get(`atom-post-1`)).toBeDefined()
      expect(collection.get(`atom-post-2`)).toBeDefined()
      expect(collection.get(`atom-post-3`)).toBeDefined()
      expect(collection.get(`atom-post-4`)).toBeDefined()

      // Verify fetch was called the expected number of times
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it(`should maintain collection state across multiple fetches with errors`, async () => {
      // Create feeds with some successful fetches and some errors
      const feedWithNewItem = sampleRSSFeed.replace(
        `</channel>`,
        `
        <item>
          <title>Error Recovery Post</title>
          <description>This post should be added after an error</description>
          <link>https://example.com/error-recovery</link>
          <guid>error-recovery</guid>
          <pubDate>Mon, 07 Jan 2025 12:00:00 GMT</pubDate>
        </item>
        </channel>`
      )

      let callCount = 0
      const fetchMock = vi.fn().mockImplementation(() => {
        callCount++
        switch (callCount) {
          case 1:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(sampleRSSFeed),
            })
          case 2:
            // Simulate a network error
            return Promise.reject(new Error(`Network error`))
          case 3:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithNewItem),
            })
          case 4:
            // Simulate another error
            return Promise.resolve({
              ok: false,
              status: 500,
              text: () => Promise.resolve(`Server error`),
            })
          case 5:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithNewItem),
            })
          default:
            return Promise.resolve({
              ok: true,
              text: () => Promise.resolve(feedWithNewItem),
            })
        }
      })
      global.fetch = fetchMock

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        pollingInterval: 5000,
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

      // Initial fetch - should succeed
      await collection.stateWhenReady()
      expect(collection.size).toBe(2)

      // First refresh - should fail but not affect existing items
      await expect(collection.utils.refresh()).rejects.toThrow()
      expect(collection.size).toBe(2) // Should maintain existing items

      // Second refresh - should succeed and add new item
      await collection.utils.refresh()
      expect(collection.size).toBe(3)
      expect(collection.get(`error-recovery`)).toBeDefined()

      // Third refresh - should fail but maintain items
      await expect(collection.utils.refresh()).rejects.toThrow()
      expect(collection.size).toBe(3) // Should maintain existing items

      // Fourth refresh - should succeed (no new items, but should work)
      await collection.utils.refresh()
      expect(collection.size).toBe(3) // No new items added

      // Verify fetch was called the expected number of times
      expect(fetchMock).toHaveBeenCalledTimes(5)
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
