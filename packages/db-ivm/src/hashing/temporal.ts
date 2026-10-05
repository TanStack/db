const temporalTypes = new Set([
  `Temporal.Duration`,
  `Temporal.Instant`,
  `Temporal.PlainDate`,
  `Temporal.PlainDateTime`,
  `Temporal.PlainMonthDay`,
  `Temporal.PlainTime`,
  `Temporal.PlainYearMonth`,
  `Temporal.ZonedDateTime`,
])

export interface TemporalLike {
  [Symbol.toStringTag]: string
  toString: () => string
}

export function isTemporal(input: object): input is TemporalLike {
  const tag = (input as Record<symbol, unknown>)[Symbol.toStringTag]
  // An own tag on a plain object does not make it a Temporal value.
  return (
    typeof tag === `string` &&
    temporalTypes.has(tag) &&
    Object.getPrototypeOf(input)?.[Symbol.toStringTag] === tag
  )
}
