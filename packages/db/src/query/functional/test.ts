/**
 * Type tests for the functional query API
 *
 * This file demonstrates the API and verifies type inference works correctly.
 * It's not meant to be executed, just type-checked.
 */

import { query, from, where, select } from "./index.js"
import { eq } from "../../index.js"
import { CollectionImpl } from "../../collection/index.js"
import type { GetResult } from "./types.js"

// Mock collection types for testing
type User = {
  id: number
  name: string
  email: string
  active: boolean
  age: number
}

type Post = {
  id: number
  userId: number
  title: string
  content: string
}

// Mock collections (these would be real collections in actual code)
declare const usersCollection: CollectionImpl<User, any, any, any, any>
declare const postsCollection: CollectionImpl<Post, any, any, any, any>

// Test 1: Basic query with from only
const q1 = query(from({ users: usersCollection }))

// Verify type: should be User[] (from the users collection)
type Q1Context = NonNullable<(typeof q1)["_context"]>
type Q1Result = GetResult<Q1Context>
const _q1Check: Q1Result = {} as User
// @ts-expect-error - should fail because Q1Result is User, not Post
const _q1Error: Q1Result = {} as Post

// Test 2: Query with from and where
const q2 = query(
  from({ users: usersCollection }),
  where(({ users }) => eq(users.active, true))
  //      ^^^^^^^ Type inference should know about 'users' here
)

// Verify type: should still be User[]
type Q2Context = NonNullable<(typeof q2)["_context"]>
type Q2Result = GetResult<Q2Context>
const _q2Check: Q2Result = {} as User

// Test 3: Query with from, where, and select
const q3 = query(
  from({ users: usersCollection }),
  where(({ users }) => eq(users.active, true)),
  select(({ users }) => ({
    //     ^^^^^^^ Type inference should know about 'users' here too
    name: users.name,
    email: users.email,
  }))
)

// Verify type: should be { name: string, email: string }[]
type Q3Context = NonNullable<(typeof q3)["_context"]>
type Q3Result = GetResult<Q3Context>
const _q3Check: Q3Result = { name: "test", email: "test@example.com" }
// @ts-expect-error - should fail because active is not in the result
const _q3Error: Q3Result = { name: "test", email: "test@example.com", active: true }

// Test 4: Multiple where clauses
const q4 = query(
  from({ users: usersCollection }),
  where(({ users }) => eq(users.active, true)),
  where(({ users }) => eq(users.age, 25))
)

// Test 5: Select with different alias
const q5 = query(
  from({ u: usersCollection }),
  where(({ u }) => eq(u.active, true)),
  //      ^ Should know about 'u', not 'users'
  select(({ u }) => ({ userName: u.name }))
)

type Q5Context = NonNullable<(typeof q5)["_context"]>
type Q5Result = GetResult<Q5Context>
const _q5Check: Q5Result = { userName: "test" }

// Test 6: Verify where callback doesn't accept wrong table name
const q6 = query(
  from({ users: usersCollection }),
  // @ts-expect-error - 'posts' doesn't exist in the context
  where(({ posts }) => eq(posts.userId, 1))
)

// Test 7: Verify select callback doesn't accept wrong table name
const q7 = query(
  from({ users: usersCollection }),
  // @ts-expect-error - 'posts' doesn't exist in the context
  select(({ posts }) => ({ title: posts.title }))
)

console.log("Type tests completed (these are compile-time only)")
