import DebugModule from "debug"
import type { FeedItem, ParsedFeedData } from "./types"

const debug = DebugModule.debug(`ts/db:rss:utils`)

/**
 * Calculate a simple hash of item content for change detection using djb2 algorithm
 */
export function getContentHash(item: FeedItem): string {
  const content = JSON.stringify({
    title: item.title,
    description: item.description,
    summary: item.summary,
    content: item.content,
    link: item.link,
    author: item.author,
    category: item.category,
    enclosure: item.enclosure,
  })

  let hash = 5381
  for (let i = 0; i < content.length; i++) {
    hash = (hash << 5) + hash + content.charCodeAt(i)
  }
  return hash.toString(36) // Convert to base36 for shorter string
}

/**
 * Detect smart polling interval based on feed metadata
 */
export function detectSmartPollingInterval(feedData: ParsedFeedData): number {
  // Check for RSS <sy:updatePeriod> and <sy:updateFrequency>
  const syndication =
    feedData.rss?.channel?.[`sy:updatePeriod`] ||
    feedData.feed?.[`sy:updatePeriod`]
  const frequency =
    feedData.rss?.channel?.[`sy:updateFrequency`] ||
    feedData.feed?.[`sy:updateFrequency`]

  if (syndication && frequency) {
    const periodMap: Record<string, number> = {
      hourly: 60 * 60 * 1000,
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
      yearly: 365 * 24 * 60 * 60 * 1000,
    }

    const baseInterval = periodMap[syndication.toLowerCase()]
    const frequencyNum =
      typeof frequency === `string` ? parseInt(frequency, 10) : frequency
    if (baseInterval && frequencyNum > 0) {
      const smartInterval = Math.max(baseInterval / frequencyNum, 60 * 1000) // Minimum 1 minute
      debug(
        `Detected smart polling interval: ${smartInterval}ms (${syndication} / ${frequencyNum})`
      )
      return smartInterval
    }
  }

  debug(`Using default 5-minute polling interval`)
  return 300000 // 5 minutes default
}

/**
 * Parse date strings according to RFC 2822 and RFC 3339 standards
 * Handles RSS pubDate (RFC 2822) and Atom published/updated (RFC 3339)
 */
export function parseFeedDate(
  dateString: string | Date | undefined
): Date | undefined {
  if (!dateString) return undefined
  if (dateString instanceof Date) return dateString

  const str = String(dateString).trim()
  if (!str) return undefined

  // Try RFC 3339 format first (Atom feeds)
  // Examples: 2023-12-25T10:30:00Z, 2023-12-25T10:30:00+01:00
  const rfc3339Regex =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/
  const rfc3339Match = str.match(rfc3339Regex)

  if (rfc3339Match) {
    const [, year, month, day, hour, minute, second, millisecond, timezone] =
      rfc3339Match
    if (!year || !month || !day || !hour || !minute || !second) {
      debug(`Invalid RFC 3339 date format: ${str}`)
      return undefined
    }

    const date = new Date()
    date.setUTCFullYear(parseInt(year, 10))
    date.setUTCMonth(parseInt(month, 10) - 1)
    date.setUTCDate(parseInt(day, 10))
    date.setUTCHours(parseInt(hour, 10))
    date.setUTCMinutes(parseInt(minute, 10))
    date.setUTCSeconds(parseInt(second, 10))
    if (millisecond) {
      date.setUTCMilliseconds(parseInt(millisecond, 10))
    }

    // Handle timezone offset
    if (timezone && timezone !== `Z`) {
      const offsetMatch = timezone.match(/^([+-])(\d{2}):(\d{2})$/)
      if (offsetMatch) {
        const [, sign, offsetHours, offsetMinutes] = offsetMatch
        if (offsetHours && offsetMinutes) {
          const offsetMs =
            (parseInt(offsetHours, 10) * 60 + parseInt(offsetMinutes, 10)) *
            60 *
            1000
          if (sign === `+`) {
            date.setTime(date.getTime() - offsetMs)
          } else {
            date.setTime(date.getTime() + offsetMs)
          }
        }
      }
    }

    return date
  }

  // Try RFC 2822 format (RSS feeds)
  // Examples: Mon, 25 Dec 2023 10:30:00 GMT, Mon, 25 Dec 2023 10:30:00 +0100
  const rfc2822Regex =
    /^(\w{3}),\s+(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|[+-]\d{4})$/
  const rfc2822Match = str.match(rfc2822Regex)

  if (rfc2822Match) {
    const [, , day, monthName, year, hour, minute, second, timezone] =
      rfc2822Match

    if (!day || !monthName || !year || !hour || !minute || !second) {
      debug(`Invalid RFC 2822 date format: ${str}`)
      return undefined
    }

    const monthMap: Record<string, number> = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    }

    const month = monthMap[monthName]
    if (month === undefined) {
      debug(`Invalid month name in RFC 2822 date: ${monthName}`)
      return undefined
    }

    const date = new Date()
    date.setUTCFullYear(parseInt(year, 10))
    date.setUTCMonth(month)
    date.setUTCDate(parseInt(day, 10))
    date.setUTCHours(parseInt(hour, 10))
    date.setUTCMinutes(parseInt(minute, 10))
    date.setUTCSeconds(parseInt(second, 10))
    date.setUTCMilliseconds(0)

    // Handle timezone offset
    if (timezone && timezone !== `GMT`) {
      const offsetMatch = timezone.match(/^([+-])(\d{2})(\d{2})$/)
      if (offsetMatch) {
        const [, sign, offsetHours, offsetMinutes] = offsetMatch
        if (offsetHours && offsetMinutes) {
          const offsetMs =
            (parseInt(offsetHours, 10) * 60 + parseInt(offsetMinutes, 10)) *
            60 *
            1000
          if (sign === `+`) {
            date.setTime(date.getTime() - offsetMs)
          } else {
            date.setTime(date.getTime() + offsetMs)
          }
        }
      }
    }

    return date
  }

  // Fallback to native Date parsing (less reliable)
  const fallbackDate = new Date(str)
  if (isNaN(fallbackDate.getTime())) {
    debug(`Failed to parse date: ${str}`)
    return undefined
  }

  return fallbackDate
}
