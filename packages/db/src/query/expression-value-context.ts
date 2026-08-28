export type ExpressionValueContext =
  | `exact-output`
  | `equality-operand`
  | `ordering-operand`
  | `structural-operand`

/** Describe how each function argument contributes to its observable result. */
export function getExpressionArgumentValueContext(
  name: string,
  index: number,
  argumentCount: number,
  resultContext: ExpressionValueContext,
): ExpressionValueContext {
  if (name === `eq` || name === `in`) return `equality-operand`
  if (isOrderingFunction(name)) return `ordering-operand`

  if (
    name === `concat` ||
    name === `length` ||
    name === `add` ||
    name === `subtract` ||
    name === `multiply` ||
    name === `divide` ||
    name === `date` ||
    name === `datetime` ||
    name === `strftime`
  ) {
    return `structural-operand`
  }

  if (name === `coalesce` || name === `upper` || name === `lower`) {
    return resultContext
  }

  if (name === `caseWhen`) {
    const isDefault = argumentCount % 2 === 1 && index === argumentCount - 1
    return isDefault || index % 2 === 1 ? resultContext : `exact-output`
  }

  return `exact-output`
}

function isOrderingFunction(name: string): boolean {
  return name === `gt` || name === `gte` || name === `lt` || name === `lte`
}
