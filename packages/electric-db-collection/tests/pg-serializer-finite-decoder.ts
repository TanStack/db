/**
 * Independent decoder for the serializer's flat finite-value text dialect. The
 * PostgreSQL serializer oracle (pg-serializer-oracle.property.test.ts) compares
 * production output against inputs through it.
 */
export type FiniteArrayValue = string | number | boolean | null

export function parseFiniteNumber(text: string): number {
  const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.exec(text)
  // Comparing the full match also rejects a final newline before JavaScript's $.
  if (match?.[0] !== text || !Number.isFinite(Number(text))) {
    throw new Error(`invalid finite numeric output: ${JSON.stringify(text)}`)
  }
  return Number(text)
}

/**
 * Decode the existing serializer's flat finite-value dialect, not arbitrary SQL.
 * Quoted text is distinct from unquoted NULL, boolean, and numeric tokens.
 * Grammar authority: PostgreSQL 18, sections 8.15.2 and 8.15.6:
 * https://www.postgresql.org/docs/18/arrays.html#ARRAYS-IO
 * No casts, nested dimensions, server ranges, or provider NULL policy are modeled.
 */
export function parseFiniteArray(text: string): Array<FiniteArrayValue> {
  const values: Array<FiniteArrayValue> = []
  let position = 1
  const invalid = () =>
    new Error(
      `invalid flat array output at ${position}: ${JSON.stringify(text)}`,
    )
  if (text[0] !== `{`) throw invalid()
  if (text === `{}`) return values

  while (position < text.length) {
    if (text[position] === `"`) {
      position++
      let value = ``
      let closed = false
      while (position < text.length) {
        const character = text[position++]!
        if (character === `"`) {
          closed = true
          break
        }
        if (character === `\\`) {
          if (position === text.length) throw invalid()
          value += text[position++]!
        } else {
          value += character
        }
      }
      if (!closed) throw invalid()
      values.push(value)
    } else {
      const start = position
      while (
        position < text.length &&
        text[position] !== `,` &&
        text[position] !== `}`
      )
        position++
      const token = text.slice(start, position)
      if (token === `NULL`) values.push(null)
      else if (token === `true`) values.push(true)
      else if (token === `false`) values.push(false)
      else values.push(parseFiniteNumber(token))
    }

    const separator = text[position++]
    if (separator === `}` && position === text.length) return values
    if (separator !== `,`) throw invalid()
  }
  throw invalid()
}
