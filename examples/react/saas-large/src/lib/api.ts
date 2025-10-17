import { createServerFn } from "@tanstack/react-start"
import { faker } from "@faker-js/faker"

type WhereClause =
  | {
      name: string
      args: Array<{ path?: Array<string>; type: string; value?: any }>
      type: `func`
    }
  | undefined

type OrderByClause =
  | Array<{
      expression: { path: Array<string>; type: string }
      compareOptions: {
        direction: `asc` | `desc`
        nulls?: `first` | `last`
        stringSort?: `locale` | `binary`
      }
    }>
  | undefined

function getValueAtPath(obj: any, path: Array<string>): any {
  return path.reduce((current, key) => current?.[key], obj)
}

function evaluateWhereClause(item: any, where: WhereClause): boolean {
  if (!where) return true

  const { name, args } = where
  const leftArg = args[0]
  const rightArg = args[1]

  const leftValue =
    leftArg.type === `ref` && leftArg.path
      ? getValueAtPath(item, leftArg.path)
      : leftArg.value

  const rightValue =
    rightArg.type === `ref` && rightArg.path
      ? getValueAtPath(item, rightArg.path)
      : rightArg.value

  switch (name) {
    case `lt`:
      return leftValue < rightValue
    case `lte`:
      return leftValue <= rightValue
    case `gt`:
      return leftValue > rightValue
    case `gte`:
      return leftValue >= rightValue
    case `eq`:
      return leftValue === rightValue
    case `ne`:
      return leftValue !== rightValue
    default:
      return true
  }
}

function compareValues(
  a: any,
  b: any,
  direction: `asc` | `desc`,
  stringSort?: `locale` | `binary`
): number {
  const nullComparison = (aIsNull: boolean, bIsNull: boolean) => {
    if (aIsNull && bIsNull) return 0
    if (aIsNull) return -1
    if (bIsNull) return 1
    return null
  }

  const aIsNull = a === null || a === undefined
  const bIsNull = b === null || b === undefined
  const nullCheck = nullComparison(aIsNull, bIsNull)
  if (nullCheck !== null) return nullCheck

  let comparison = 0
  if (typeof a === `string` && typeof b === `string`) {
    comparison =
      stringSort === `locale` ? a.localeCompare(b) : a < b ? -1 : a > b ? 1 : 0
  } else {
    comparison = a < b ? -1 : a > b ? 1 : 0
  }

  return direction === `desc` ? -comparison : comparison
}

export const getProducts = createServerFn({ method: `GET` })
  .inputValidator(
    (input: {
      page: number
      limit: number
      orderBy?: string
      where?: string
    }) => input
  )
  .handler(({ data }) => {
    const { page, limit, orderBy: orderByString, where: whereString } = data

    const orderBy: OrderByClause = orderByString
      ? JSON.parse(orderByString)
      : undefined
    const where: WhereClause = whereString ? JSON.parse(whereString) : undefined

    const categories = [
      `Electronics`,
      `Clothing`,
      `Home`,
      `Books`,
      `Toys`,
      `Sports`,
    ] as const

    const totalProducts = 1000
    const allProducts = []

    for (let i = 0; i < totalProducts; i++) {
      faker.seed(i)

      allProducts.push({
        id: `product-${i}`,
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        category: faker.helpers.arrayElement(categories),
        price: parseFloat(faker.commerce.price({ min: 10, max: 1000 })),
        rating: faker.number.int({ min: 1, max: 5 }),
        inStock: faker.datatype.boolean(),
        brand: faker.company.name(),
        tags: faker.helpers.arrayElements(
          [`New`, `Sale`, `Popular`, `Limited`, `Featured`, `Bestseller`],
          { min: 0, max: 3 }
        ),
      })
    }

    const filteredProducts = where
      ? allProducts.filter((product) => evaluateWhereClause(product, where))
      : allProducts

    if (orderBy && orderBy.length > 0) {
      filteredProducts.sort((a, b) => {
        for (const order of orderBy) {
          const { expression, compareOptions } = order
          const aValue = getValueAtPath(a, expression.path)
          const bValue = getValueAtPath(b, expression.path)

          const comparison = compareValues(
            aValue,
            bValue,
            compareOptions.direction,
            compareOptions.stringSort
          )

          if (comparison !== 0) return comparison
        }
        return 0
      })
    }

    const startIndex = page * limit
    const endIndex = startIndex + limit
    const paginatedProducts = filteredProducts.slice(startIndex, endIndex)

    return paginatedProducts
  })
