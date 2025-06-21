// Simple test for the new query builder
import { CollectionImpl } from "../collection.js"
import { BaseQueryBuilder, buildQuery } from "./query-builder/index.js"
import { count, eq } from "./query-builder/functions.js"

interface Test {
  id: number
  name: string
  active: boolean
  category: string
}

// Simple test collection
const testCollection = new CollectionImpl<Test>({
  id: `test`,
  getKey: (item: any) => item.id,
  sync: {
    sync: () => {}, // Mock sync
  },
})

// Test 1: Basic from clause
function testFrom() {
  const builder = new BaseQueryBuilder()
  const query = builder.from({ test: testCollection })
  console.log(`From test:`, query._getQuery())
}

// Test 2: Simple where clause
function testWhere() {
  const builder = new BaseQueryBuilder()
  const query = builder
    .from({ test: testCollection })
    .where(({ test }) => eq(test.id, 1)) // ✅ Fixed: number with number

  console.log(`Where test:`, query._getQuery())
}

// Test 3: Simple select
function testSelect() {
  const builder = new BaseQueryBuilder()
  const query = builder.from({ test: testCollection }).select(({ test }) => ({
    id: test.id,
    name: test.name,
  }))

  console.log(`Select test:`, query._getQuery())
}

// Test 4: Group by and aggregation
function testGroupBy() {
  const builder = new BaseQueryBuilder()
  const query = builder
    .from({ test: testCollection })
    .groupBy(({ test }) => test.category)
    .select(({ test }) => ({
      category: test.category,
      count: count(test.id),
    }))

  console.log(`Group by test:`, query._getQuery())
}

// Test using buildQuery helper
function testBuildQuery() {
  const query = buildQuery((q) =>
    q
      .from({ test: testCollection })
      .where(({ test }) => eq(test.active, true))
      .select(({ test }) => ({ id: test.id }))
  )

  console.log(`Build query test:`, query)
}

// Export tests
export { testFrom, testWhere, testSelect, testGroupBy, testBuildQuery }
