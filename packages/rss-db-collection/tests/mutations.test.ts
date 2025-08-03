import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCollection } from "@tanstack/db"
import { rssCollectionOptions } from "../src/rss"
import type { RSSCollectionConfig, RSSItem } from "../src/rss"

// Mock fetch globally
global.fetch = vi.fn()

const sampleRSSFeed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Blog</title>
    <item>
      <title>First Post</title>
      <description>This is the first post</description>
      <link>https://example.com/post1</link>
      <guid>post-1</guid>
      <pubDate>Wed, 01 Jan 2025 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

interface TestBlogPost {
  id: string
  title: string
  description: string
  link: string
  publishedAt: Date
}

const getKey = (item: TestBlogPost) => item.id

// Helper to advance timers and allow microtasks to flush
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`RSS Collection Mutations`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe(`Insert Mutations`, () => {
    it(`should call onInsert handler when items are inserted`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onInsertMock = vi.fn().mockResolvedValue(undefined)

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
        }),
        onInsert: onInsertMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      expect(collection.size).toBe(1)
      expect(onInsertMock).toHaveBeenCalledTimes(1)

      const insertCall = onInsertMock.mock.calls[0]?.[0]
      expect(insertCall?.transaction.mutations).toHaveLength(1)
      expect(insertCall?.transaction.mutations[0]?.type).toBe(`insert`)
      expect(insertCall?.transaction.mutations[0]?.modified.id).toBe(`post-1`)
    })

    it(`should handle onInsert errors gracefully`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onInsertMock = vi.fn().mockRejectedValue(new Error(`Insert failed`))

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
        }),
        onInsert: onInsertMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      // Should handle the error gracefully and still process items
      expect(onInsertMock).toHaveBeenCalled()
    })
  })

  describe(`Update Mutations`, () => {
    it(`should call onUpdate handler when manually updating items`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onUpdateMock = vi.fn().mockResolvedValue(undefined)

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
        }),
        onUpdate: onUpdateMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      // Manually update an item
      collection.update(`post-1`, (draft: TestBlogPost) => {
        draft.title = `Updated Title`
      })

      expect(onUpdateMock).toHaveBeenCalledTimes(1)

      const updateCall = onUpdateMock.mock.calls[0]?.[0]
      expect(updateCall?.transaction.mutations).toHaveLength(1)
      expect(updateCall?.transaction.mutations[0]?.type).toBe(`update`)
      expect(updateCall?.transaction.mutations[0]?.changes.title).toBe(
        `Updated Title`
      )
    })

    it(`should handle onUpdate errors gracefully`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onUpdateMock = vi.fn().mockRejectedValue(new Error(`Update failed`))

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
        }),
        onUpdate: onUpdateMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      // Try to update an item - should handle error gracefully
      try {
        collection.update(`post-1`, (draft: TestBlogPost) => {
          draft.title = `Updated Title`
        })
      } catch {
        // Update may throw due to onUpdate handler error
      }

      expect(onUpdateMock).toHaveBeenCalled()
    })
  })

  describe(`Delete Mutations`, () => {
    it(`should call onDelete handler when manually deleting items`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onDeleteMock = vi.fn().mockResolvedValue(undefined)

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
        }),
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      // Manually delete an item
      collection.delete(`post-1`)

      expect(onDeleteMock).toHaveBeenCalledTimes(1)

      const deleteCall = onDeleteMock.mock.calls[0]?.[0]
      expect(deleteCall?.transaction.mutations).toHaveLength(1)
      expect(deleteCall?.transaction.mutations[0]?.type).toBe(`delete`)
      expect(deleteCall?.transaction.mutations[0]?.key).toBe(`post-1`)
    })

    it(`should handle onDelete errors gracefully`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onDeleteMock = vi.fn().mockRejectedValue(new Error(`Delete failed`))

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
        }),
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      // Try to delete an item - should handle error gracefully
      try {
        collection.delete(`post-1`)
      } catch {
        // Delete may throw due to onDelete handler error
      }

      expect(onDeleteMock).toHaveBeenCalled()
    })
  })

  describe(`Combined Mutation Scenarios`, () => {
    it(`should handle multiple mutation types with handlers`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onInsertMock = vi.fn().mockResolvedValue(undefined)
      const onUpdateMock = vi.fn().mockResolvedValue(undefined)
      const onDeleteMock = vi.fn().mockResolvedValue(undefined)

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
        }),
        onInsert: onInsertMock,
        onUpdate: onUpdateMock,
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      // Should have called onInsert for feed items
      expect(onInsertMock).toHaveBeenCalledTimes(1)

      // Manual operations
      collection.update(`post-1`, (draft: TestBlogPost) => {
        draft.title = `Updated Title`
      })
      expect(onUpdateMock).toHaveBeenCalledTimes(1)

      collection.delete(`post-1`)
      expect(onDeleteMock).toHaveBeenCalledTimes(1)

      // Insert a new item manually
      collection.insert({
        id: `manual-post`,
        title: `Manual Post`,
        description: `Manually added`,
        link: `https://example.com/manual`,
        publishedAt: new Date(),
      })
      expect(onInsertMock).toHaveBeenCalledTimes(2)
    })

    it(`should provide access to collection utils in mutation handlers`, async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(sampleRSSFeed),
      })
      global.fetch = fetchMock

      const onInsertMock = vi.fn().mockImplementation(({ collection }) => {
        // Test that utils are available
        expect(collection.utils.isPolling).toBeDefined()
        expect(collection.utils.getSeenItemsCount).toBeDefined()
        expect(collection.utils.clearSeenItems).toBeDefined()
        return Promise.resolve()
      })

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
        }),
        onInsert: onInsertMock,
      }

      const options = rssCollectionOptions(config)
      const collection = createCollection(options)

      await vi.waitFor(() => {
        expect(collection.status).toBe(`ready`)
      })

      await flushPromises()

      expect(onInsertMock).toHaveBeenCalled()
    })
  })
})
