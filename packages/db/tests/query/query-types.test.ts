import { describe, expect, test } from "vitest"
import type {
  Comparator,
  Condition,
  ConditionOperand,
  FlatCompositeCondition,
  LogicalOperator,
  Query,
  SimpleCondition,
} from "../../src/query/schema.js"

type User = {
  id: number
  name: string
  age: number
  department: string
}

type Context = {
  baseSchema: {
    users: User
  }
  schema: {
    users: User
  }
}

// This test verifies that TypeScript properly accepts/rejects objects that should/shouldn't match Query types
describe(`Query Type System`, () => {
  test(`Query objects conform to the expected schema`, () => {
    // Simple runtime test that confirms our test file is running
    expect(true).toBe(true)

    // The actual type checking happens at compile time
    // If this file compiles, then the types are correctly defined
  })
})

// This portion contains compile-time type assertions
// These won't run at runtime but will cause TypeScript errors if the types don't match

// Valid basic query
const basicQuery = {
  select: [`@id`, `@name`],
  from: `users`,
} satisfies Query<Context>

// Valid query with aliased columns
const aliasedQuery = {
  select: [`@id`, { full_name: `@name` }],
  from: `users`,
} satisfies Query<Context>

// Valid query with simple WHERE condition
const simpleWhereQuery = {
  select: [`@id`, `@name`],
  from: `users`,
  where: [[`@age`, `>`, 18] as SimpleCondition],
} satisfies Query<Context>

// Valid query with flat composite WHERE condition
const compositeWhereQuery = {
  select: [`@id`, `@name`],
  from: `users`,
  where: [
    [
      `@age`,
      `>`,
      18,
      `and` as LogicalOperator,
      `@active`,
      `=`,
      true,
    ] as FlatCompositeCondition,
  ],
} satisfies Query<Context>

// Full query with all optional properties
const fullQuery = {
  select: [`@id`, `@name`, { age_years: `@age` }],
  as: `user_data`,
  from: `users`,
  where: [[`@active`, `=`, true] as SimpleCondition],
  groupBy: [`@department`],
  having: [[`@count`, `>`, 5] as SimpleCondition],
  orderBy: { "@name": `asc` },
  limit: 10,
  offset: 20,
} satisfies Query<Context>

// Condition type checking
const simpleCondition: SimpleCondition = [`@age`, `>`, 18]
const simpleCond: Condition = simpleCondition

// Flat composite condition
const flatCompositeCondition: FlatCompositeCondition = [
  `@age`,
  `>`,
  18,
  `and`,
  `@active`,
  `=`,
  true,
]
const flatCompCond: Condition = flatCompositeCondition

// Nested composite condition
const nestedCompositeCondition = [
  [`@age`, `>`, 18] as SimpleCondition,
  `and` as LogicalOperator,
  [`@active`, `=`, true] as SimpleCondition,
] as [SimpleCondition, LogicalOperator, SimpleCondition]
const nestedCompCond: Condition = nestedCompositeCondition

// The code below demonstrates type compatibility for ConditionOperand
// If TypeScript compiles this file, then these assignments work
const operand1: ConditionOperand<Context> = `string literal`
const operand2: ConditionOperand<Context> = 42
const operand3: ConditionOperand<Context> = true
const operand4: ConditionOperand<Context> = null
const operand5: ConditionOperand<Context> = undefined
const operand6: ConditionOperand<Context> = `@department`
const operand7: ConditionOperand<Context> = { col: `department` }
const operand8: ConditionOperand<Context> = { value: { nested: `object` } }

// The code below demonstrates type compatibility for Comparator
// If TypeScript compiles this file, then these assignments work
const comp1: Comparator = `=`
const comp2: Comparator = `!=`
const comp3: Comparator = `<`
const comp4: Comparator = `<=`
const comp5: Comparator = `>`
const comp6: Comparator = `>=`
const comp7: Comparator = `like`
const comp8: Comparator = `not like`
const comp9: Comparator = `in`
const comp10: Comparator = `not in`
const comp11: Comparator = `is`
const comp12: Comparator = `is not`

// The following lines would fail type checking if uncommented:

/*
// Missing required 'from' property
const invalidQuery1 = {
  select: ['@id', '@name']
} satisfies Query; // This would fail

// Invalid select items
const invalidQuery2 = {
  select: [1, 2, 3], // Should be strings or objects with column aliases
  from: 'users'
} satisfies Query; // This would fail

// Invalid condition structure
const invalidQuery3 = {
  select: ['@id'],
  from: 'users',
  where: ['@age', '>', '18', 'extra'] // Invalid condition structure
} satisfies Query; // This would fail
*/
