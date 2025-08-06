import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rssCollectionOptions } from "../src/rss"
import type { RSSCollectionConfig } from "../src/rss"

interface TestBlogPost {
  id: string
  title: string
  description: string
  link: string
  publishedAt: Date
}

const getKey = (item: TestBlogPost) => item.id

describe(`RSS Collection Mutations`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe(`Insert Mutations`, () => {
    it(`should create collection with onInsert handler`, () => {
      const onInsertMock = vi.fn().mockResolvedValue(undefined)

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onInsert: onInsertMock,
      }

      const options = rssCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.onInsert).toBeDefined()
      expect(typeof options.onInsert).toBe(`function`)
    })

    it(`should accept onInsert handler that throws errors`, () => {
      const onInsertMock = vi.fn().mockRejectedValue(new Error(`Insert failed`))

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onInsert: onInsertMock,
      }

      const options = rssCollectionOptions(config)

      expect(options.onInsert).toBeDefined()
      expect(typeof options.onInsert).toBe(`function`)
    })
  })

  describe(`Update Mutations`, () => {
    it(`should create collection with onUpdate handler`, () => {
      const onUpdateMock = vi.fn().mockResolvedValue(undefined)

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onUpdate: onUpdateMock,
      }

      const options = rssCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(typeof options.onUpdate).toBe(`function`)
    })

    it(`should accept onUpdate handler that throws errors`, () => {
      const onUpdateMock = vi.fn().mockRejectedValue(new Error(`Update failed`))

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onUpdate: onUpdateMock,
      }

      const options = rssCollectionOptions(config)

      expect(options.onUpdate).toBeDefined()
      expect(typeof options.onUpdate).toBe(`function`)
    })
  })

  describe(`Delete Mutations`, () => {
    it(`should create collection with onDelete handler`, () => {
      const onDeleteMock = vi.fn().mockResolvedValue(undefined)

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.onDelete).toBeDefined()
      expect(typeof options.onDelete).toBe(`function`)
    })

    it(`should accept onDelete handler that throws errors`, () => {
      const onDeleteMock = vi.fn().mockRejectedValue(new Error(`Delete failed`))

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)

      expect(options.onDelete).toBeDefined()
      expect(typeof options.onDelete).toBe(`function`)
    })
  })

  describe(`Combined Mutation Scenarios`, () => {
    it(`should create collection with multiple mutation handlers`, () => {
      const onInsertMock = vi.fn().mockResolvedValue(undefined)
      const onUpdateMock = vi.fn().mockResolvedValue(undefined)
      const onDeleteMock = vi.fn().mockResolvedValue(undefined)

      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
        onInsert: onInsertMock,
        onUpdate: onUpdateMock,
        onDelete: onDeleteMock,
      }

      const options = rssCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.onInsert).toBeDefined()
      expect(options.onUpdate).toBeDefined()
      expect(options.onDelete).toBeDefined()
    })

    it(`should provide access to collection utils in options`, () => {
      const config: RSSCollectionConfig<TestBlogPost> = {
        feedUrl: `https://example.com/rss.xml`,
        getKey,
        startPolling: false,
      }

      const options = rssCollectionOptions(config)

      expect(options).toBeDefined()
      expect(options.utils).toBeDefined()
      expect(options.utils.refresh).toBeDefined()
      expect(options.utils.clearSeenItems).toBeDefined()
      expect(options.utils.getSeenItemsCount).toBeDefined()
    })
  })
})
