import { describe, expect, it } from "vitest"
import {
  detectSmartPollingInterval,
  getContentHash,
  parseFeedDate,
} from "../src/utils"
import type { ParsedFeedData, RSSItem } from "../src/types"

describe(`Utils`, () => {
  describe(`getContentHash`, () => {
    it(`should generate consistent hashes for identical content`, () => {
      const item1: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
        link: `https://example.com/test`,
        author: `John Doe`,
      }

      const item2: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
        link: `https://example.com/test`,
        author: `John Doe`,
      }

      const hash1 = getContentHash(item1)
      const hash2 = getContentHash(item2)

      expect(hash1).toBe(hash2)
      expect(typeof hash1).toBe(`string`)
      expect(hash1.length).toBeGreaterThan(0)
    })

    it(`should generate different hashes for different content`, () => {
      const item1: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
        link: `https://example.com/test`,
        author: `John Doe`,
      }

      const item2: RSSItem = {
        title: `Test Post Updated`,
        description: `Test description`,
        link: `https://example.com/test`,
        author: `John Doe`,
      }

      const hash1 = getContentHash(item1)
      const hash2 = getContentHash(item2)

      expect(hash1).not.toBe(hash2)
    })

    it(`should handle missing properties gracefully`, () => {
      const item1: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
      }

      const item2: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
        link: undefined,
        author: null as any,
      }

      const hash1 = getContentHash(item1)
      const hash2 = getContentHash(item2)

      // JSON.stringify omits undefined properties but includes null
      // So these will have different hashes, which is correct behavior
      expect(hash1).not.toBe(hash2)
    })

    it(`should be case sensitive`, () => {
      const item1: RSSItem = {
        title: `Test Post`,
        description: `Test description`,
      }

      const item2: RSSItem = {
        title: `test post`,
        description: `Test description`,
      }

      const hash1 = getContentHash(item1)
      const hash2 = getContentHash(item2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe(`detectSmartPollingInterval`, () => {
    it(`should detect hourly syndication`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `hourly`,
            "sy:updateFrequency": `2`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(30 * 60 * 1000) // 30 minutes (hourly / 2)
    })

    it(`should detect daily syndication`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `daily`,
            "sy:updateFrequency": `1`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(24 * 60 * 60 * 1000) // 24 hours
    })

    it(`should detect weekly syndication`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `weekly`,
            "sy:updateFrequency": `3`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe((7 * 24 * 60 * 60 * 1000) / 3) // weekly / 3
    })

    it(`should handle Atom feeds`, () => {
      const feedData: ParsedFeedData = {
        feed: {
          "sy:updatePeriod": `daily`,
          "sy:updateFrequency": `2`,
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(12 * 60 * 60 * 1000) // 12 hours (daily / 2)
    })

    it(`should enforce minimum 1-minute interval`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `hourly`,
            "sy:updateFrequency": `120`, // Would result in 30 seconds
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(60 * 1000) // 1 minute minimum
    })

    it(`should default to 5 minutes when no syndication data`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            title: `Test Feed`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(300000) // 5 minutes
    })

    it(`should default to 5 minutes when syndication data is invalid`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `invalid`,
            "sy:updateFrequency": `1`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(300000) // 5 minutes
    })

    it(`should default to 5 minutes when frequency is 0`, () => {
      const feedData: ParsedFeedData = {
        rss: {
          channel: {
            "sy:updatePeriod": `daily`,
            "sy:updateFrequency": `0`,
          },
        },
      }

      const interval = detectSmartPollingInterval(feedData)
      expect(interval).toBe(300000) // 5 minutes
    })
  })

  describe(`parseFeedDate`, () => {
    it(`should parse RFC 3339 dates`, () => {
      const date1 = parseFeedDate(`2023-12-25T10:30:00Z`)
      const date2 = parseFeedDate(`2023-12-25T10:30:00+01:00`)
      const date3 = parseFeedDate(`2023-12-25T10:30:00.123Z`)

      expect(date1).toBeInstanceOf(Date)
      expect(date2).toBeInstanceOf(Date)
      expect(date3).toBeInstanceOf(Date)

      expect(date1?.getUTCFullYear()).toBe(2023)
      expect(date1?.getUTCMonth()).toBe(11) // December is 11 (0-indexed)
      expect(date1?.getUTCDate()).toBe(25)
      expect(date1?.getUTCHours()).toBe(10)
      expect(date1?.getUTCMinutes()).toBe(30)
      expect(date1?.getUTCSeconds()).toBe(0)
    })

    it(`should parse RFC 2822 dates`, () => {
      const date1 = parseFeedDate(`Mon, 25 Dec 2023 10:30:00 GMT`)
      const date2 = parseFeedDate(`Mon, 25 Dec 2023 10:30:00 +0100`)

      expect(date1).toBeInstanceOf(Date)
      expect(date2).toBeInstanceOf(Date)

      expect(date1?.getUTCFullYear()).toBe(2023)
      expect(date1?.getUTCMonth()).toBe(11) // December is 11 (0-indexed)
      expect(date1?.getUTCDate()).toBe(25)
      expect(date1?.getUTCHours()).toBe(10)
      expect(date1?.getUTCMinutes()).toBe(30)
      expect(date1?.getUTCSeconds()).toBe(0)
    })

    it(`should handle timezone offsets correctly`, () => {
      // RFC 3339 with +01:00 offset
      const date1 = parseFeedDate(`2023-12-25T10:30:00+01:00`)
      // RFC 2822 with +0100 offset
      const date2 = parseFeedDate(`Mon, 25 Dec 2023 10:30:00 +0100`)

      // Both should represent the same moment in time (UTC)
      // The +01:00 offset means both represent 09:30:00 UTC
      expect(date1?.getUTCHours()).toBe(9)
      expect(date1?.getUTCMinutes()).toBe(30)
      expect(date2?.getUTCHours()).toBe(9)
      expect(date2?.getUTCMinutes()).toBe(30)
    })

    it(`should return undefined for invalid dates`, () => {
      expect(parseFeedDate(`invalid date`)).toBeUndefined()
      expect(parseFeedDate(``)).toBeUndefined()
      expect(parseFeedDate(`   `)).toBeUndefined()
      expect(parseFeedDate(undefined)).toBeUndefined()
      expect(parseFeedDate(null as any)).toBeUndefined()
    })

    it(`should handle already parsed Date objects`, () => {
      const originalDate = new Date(`2023-12-25T10:30:00Z`)
      const parsedDate = parseFeedDate(originalDate)

      expect(parsedDate).toBe(originalDate)
    })

    it(`should fallback to native Date parsing for unrecognized formats`, () => {
      const date = parseFeedDate(`2023-12-25 10:30:00`)

      expect(date).toBeInstanceOf(Date)
      expect(date?.getFullYear()).toBe(2023)
      expect(date?.getMonth()).toBe(11) // December is 11 (0-indexed)
    })

    it(`should handle invalid RFC 3339 formats`, () => {
      // These should fail the regex but might pass fallback parsing
      expect(parseFeedDate(`2023-12-25T10:30:00`)).toBeInstanceOf(Date) // Missing timezone, falls back
      expect(parseFeedDate(`invalid-date`)).toBeUndefined() // Completely invalid
    })

    it(`should handle invalid RFC 2822 formats`, () => {
      expect(parseFeedDate(`Invalid, 25 Dec 2023 10:30:00 GMT`)).toBeInstanceOf(
        Date
      ) // Invalid day name, falls back
      expect(parseFeedDate(`Mon, 25 Invalid 2023 10:30:00 GMT`)).toBeUndefined() // Invalid month name, should fail
      expect(parseFeedDate(`completely-invalid`)).toBeUndefined() // Completely invalid
    })
  })
})
