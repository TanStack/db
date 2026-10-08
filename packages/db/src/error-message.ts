// Production error messages. Not part of the public API: `index.ts`
// re-exports `errors.ts`, so these helpers live in their own module.

// Bundlers inline `process.env.NODE_ENV`. The pure probe supports unbundled
// browsers; the literal comparison beside each use lets a production bundler
// erase the full message text.
/* @__NO_SIDE_EFFECTS__ */
export function devBuild(): boolean {
  try {
    return process.env.NODE_ENV !== `production`
  } catch {
    return false
  }
}

/**
 * One value as it appears in a production message, or `undefined` when it is
 * not shown. Only primitives reach `JSON.stringify`, so no `toJSON()` runs: a
 * plain object, at any depth, never contributes its contents.
 */
function show(value: unknown, inArray: boolean): string | undefined {
  if (Array.isArray(value))
    return `[${value.map((item) => show(item, true) ?? `"[object]"`).join(`,`)}]`
  if (value instanceof Error)
    return inArray ? undefined : JSON.stringify(value.message)
  if (
    typeof value === `symbol` ||
    typeof value === `bigint` ||
    (inArray &&
      (value === undefined ||
        (typeof value === `number` && !Number.isFinite(value))))
  )
    return JSON.stringify(String(value))
  if (
    value === undefined ||
    (typeof value === `number` && !Number.isFinite(value))
  )
    return String(value)
  return value === null || typeof value !== `object`
    ? JSON.stringify(value)
    : undefined
}

/**
 * A production message: the code, the inputs it can show as JSON, and its docs
 * anchor. Symbols and bigints show as strings; `undefined`, `NaN`, and the
 * infinities show as themselves. Objects other than arrays and errors are not
 * shown.
 */
export function codedMessage(
  code: number,
  values: Record<string, unknown> = {},
): string {
  const shown = Object.entries(values).flatMap(([name, value]) => {
    try {
      const text = show(value, false)
      return text === undefined ? [] : [`${name}=${text}`]
    } catch {
      return []
    }
  })
  // JSON leaves U+2028 and U+2029 unescaped; both end a line.
  const pairs = shown
    .join(`, `)
    .replace(
      /[\u2028\u2029]/g,
      (separator) => `\\u${separator.charCodeAt(0).toString(16)}`,
    )
  return `TanStack DB error ${code}${pairs && ` (${pairs})`}: https://tanstack.com/db/latest/docs/errors#error-${code}`
}
