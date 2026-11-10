/**
 * The relative specifiers of a module, shared by the oracle lint hook, its
 * lint cache key, and the run-budget script's reach.
 *
 * Every import, export, and re-export source is a string literal that starts
 * with `.`. This scanner reads the module as tokens: comments, string literals,
 * template literals, and regular expression literals are read whole, so a
 * string's closing quote can never start a match, and code between two strings
 * on one line is still scanned. It returns every string literal that starts with
 * `.`, which is a superset of the relative sources: a `.`-string outside import
 * syntax only adds a module that the exact resolver then ignores or finds
 * unchanged.
 *
 * Limits: a template literal's `${}` expressions are skipped with the template
 * text, so a quote or backtick inside one is not read as code. A `/` after a
 * closing bracket or a value is division; after anything else, it starts a
 * regular expression. An escaped specifier such as `'\x2e/m'` is not a
 * `.`-string in this form, and is not reached.
 */

// Words after which a `/` starts a regular expression, not a division.
const expressionKeywords = new Set([
  `await`,
  `case`,
  `delete`,
  `do`,
  `else`,
  `in`,
  `instanceof`,
  `new`,
  `of`,
  `return`,
  `throw`,
  `typeof`,
  `void`,
  `yield`,
])

/** The index just past the string, template, or regular expression that starts at `start`. */
function skipLiteral(text, start, quote) {
  let index = start + 1
  let inClass = false
  while (index < text.length) {
    const char = text[index]
    if (char === `\\`) {
      index += 2
      continue
    }
    if (quote === `/`) {
      if (char === `[`) inClass = true
      else if (char === `]`) inClass = false
      else if (char === `/` && !inClass) {
        index++
        while (/[a-z]/i.test(text[index] ?? ``)) index++
        return index
      } else if (char === `\n`) return index
    } else if (char === quote) {
      return index + 1
    }
    index++
  }
  return index
}

/** Every string literal of a module that starts with `.`, in source order. */
export function relativeSpecifiers(text) {
  const found = []
  let index = 0
  // Whether a `/` here would start a regular expression: not after a value.
  let expressionStart = true
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (char === `/` && next === `/`) {
      const end = text.indexOf(`\n`, index)
      index = end === -1 ? text.length : end
    } else if (char === `/` && next === `*`) {
      const end = text.indexOf(`*/`, index + 2)
      index = end === -1 ? text.length : end + 2
    } else if (char === `'` || char === `"`) {
      const end = skipLiteral(text, index, char)
      const value = text.slice(index + 1, end - 1)
      if (value.startsWith(`.`)) found.push(value)
      index = end
      expressionStart = false
    } else if (char === `\``) {
      index = skipLiteral(text, index, char)
      expressionStart = false
    } else if (char === `/` && expressionStart) {
      index = skipLiteral(text, index, char)
      expressionStart = false
    } else if (/[\w$]/.test(char)) {
      let end = index
      while (end < text.length && /[\w$]/.test(text[end])) end++
      const word = text.slice(index, end)
      expressionStart = expressionKeywords.has(word)
      index = end
    } else {
      if (!/\s/.test(char))
        expressionStart = !(char === `)` || char === `]` || char === `}`)
      index++
    }
  }
  return found
}
