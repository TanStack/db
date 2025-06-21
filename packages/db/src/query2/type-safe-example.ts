// Example demonstrating type-safe expression functions
import { CollectionImpl } from "../collection.js"
import { BaseQueryBuilder } from "./query-builder/index.js"
import { avg, count, eq, gt, length, upper } from "./query-builder/functions.js"

// Typed collection
interface User {
  id: number
  name: string
  email: string
  age: number
  isActive: boolean
}

const usersCollection = new CollectionImpl<User>({
  id: `users`,
  getKey: (user) => user.id,
  sync: { sync: () => {} },
})

// Examples showing type safety working
function typeSafeExamples() {
  const builder = new BaseQueryBuilder()

  // ✅ These work and provide proper type hints
  builder
    .from({ user: usersCollection })
    .where(({ user }) => eq(user.age, 25)) // number compared to number ✅
    .where(({ user }) => eq(user.name, `John`)) // string compared to string ✅
    .where(({ user }) => eq(user.isActive, true)) // boolean compared to boolean ✅
    .where(({ user }) => gt(user.age, 18)) // number compared to number ✅
    .where(({ user }) => eq(upper(user.name), `JOHN`)) // string function result ✅
    .select(({ user }) => ({
      id: user.id, // RefProxy<number>
      nameLength: length(user.name), // string function on RefProxy<string>
      isAdult: gt(user.age, 18), // numeric comparison
      upperName: upper(user.name), // string function
    }))

  // Aggregation with type hints
  builder
    .from({ user: usersCollection })
    .groupBy(({ user }) => user.isActive)
    .select(({ user }) => ({
      isActive: user.isActive,
      count: count(user.id), // count can take any type
      avgAge: avg(user.age), // avg prefers numbers but accepts any
    }))

  return builder._getQuery()
}

// Demonstrates type checking in IDE
function typeHintDemo() {
  const builder = new BaseQueryBuilder()

  return builder
    .from({ user: usersCollection })
    .where(({ user }) => {
      // IDE will show user.age as RefProxy<number>
      // IDE will show user.name as RefProxy<string>
      // IDE will show user.isActive as RefProxy<boolean>

      return eq(user.age, 25) // Proper type hints while remaining flexible
    })
    .select(({ user }) => ({
      // IDE shows proper types for each property
      id: user.id, // RefProxy<number>
      name: user.name, // RefProxy<string>
      age: user.age, // RefProxy<number>
    }))
}

export { typeSafeExamples, typeHintDemo }
