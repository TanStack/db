import { describe, expect, test } from "vitest"
import { D2, MultiSet, output } from "@electric-sql/d2mini"
import { compileQuery } from "../../../src/query2/compiler/index.js"
import { CollectionRef, Func, Ref, Value } from "../../../src/query2/ir.js"
import type { Query } from "../../../src/query2/ir.js"
import type { CollectionImpl } from "../../../src/collection.js"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
}

type Department = {
  id: number
  name: string
  budget: number
}

// Sample data for tests
const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, age: 25, email: `alice@example.com`, active: true },
  { id: 2, name: `Bob`, age: 19, email: `bob@example.com`, active: true },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
  },
  { id: 4, name: `Dave`, age: 22, email: `dave@example.com`, active: true },
]

const sampleDepartments: Array<Department> = [
  { id: 1, name: `Engineering`, budget: 100000 },
  { id: 2, name: `Marketing`, budget: 50000 },
  { id: 3, name: `Sales`, budget: 75000 },
]

// Use the variable to avoid TypeScript error
void sampleDepartments

describe(`Query2 Pipeline`, () => {
  describe(`Expression Evaluation`, () => {
    test(`evaluates string functions`, () => {
      const usersCollection = { id: `users` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          upperName: new Func(`upper`, [new Ref([`users`, `name`])]),
          lowerEmail: new Func(`lower`, [new Ref([`users`, `email`])]),
          nameLength: new Func(`length`, [new Ref([`users`, `name`])]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Check Alice's transformed data
      const aliceResult = results.find(([_key, result]) => result.id === 1)?.[1]
      expect(aliceResult).toEqual({
        id: 1,
        upperName: `ALICE`,
        lowerEmail: `alice@example.com`,
        nameLength: 5,
      })

      // Check Bob's transformed data
      const bobResult = results.find(([_key, result]) => result.id === 2)?.[1]
      expect(bobResult).toEqual({
        id: 2,
        upperName: `BOB`,
        lowerEmail: `bob@example.com`,
        nameLength: 3,
      })
    })

    test(`evaluates comparison functions`, () => {
      const usersCollection = { id: `users` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          isAdult: new Func(`gte`, [new Ref([`users`, `age`]), new Value(18)]),
          isSenior: new Func(`gte`, [new Ref([`users`, `age`]), new Value(65)]),
          isYoung: new Func(`lt`, [new Ref([`users`, `age`]), new Value(25)]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Check Alice (age 25)
      const aliceResult = results.find(([_key, result]) => result.id === 1)?.[1]
      expect(aliceResult).toEqual({
        id: 1,
        name: `Alice`,
        isAdult: true, // 25 >= 18
        isSenior: false, // 25 < 65
        isYoung: false, // 25 >= 25
      })

      // Check Bob (age 19)
      const bobResult = results.find(([_key, result]) => result.id === 2)?.[1]
      expect(bobResult).toEqual({
        id: 2,
        name: `Bob`,
        isAdult: true, // 19 >= 18
        isSenior: false, // 19 < 65
        isYoung: true, // 19 < 25
      })
    })

    test(`evaluates boolean logic functions`, () => {
      const usersCollection = { id: `users` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          isActiveAdult: new Func(`and`, [
            new Ref([`users`, `active`]),
            new Func(`gte`, [new Ref([`users`, `age`]), new Value(18)]),
          ]),
          isInactiveOrYoung: new Func(`or`, [
            new Func(`not`, [new Ref([`users`, `active`])]),
            new Func(`lt`, [new Ref([`users`, `age`]), new Value(21)]),
          ]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Check Charlie (age 30, inactive)
      const charlieResult = results.find(
        ([_key, result]) => result.id === 3
      )?.[1]
      expect(charlieResult).toEqual({
        id: 3,
        name: `Charlie`,
        isActiveAdult: false, // active=false AND age>=18 = false
        isInactiveOrYoung: true, // !active OR age<21 = true OR false = true
      })

      // Check Bob (age 19, active)
      const bobResult = results.find(([_key, result]) => result.id === 2)?.[1]
      expect(bobResult).toEqual({
        id: 2,
        name: `Bob`,
        isActiveAdult: true, // active=true AND age>=18 = true
        isInactiveOrYoung: true, // !active OR age<21 = false OR true = true
      })
    })

    test(`evaluates LIKE patterns`, () => {
      const usersCollection = { id: `users` } as CollectionImpl

      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          hasGmailEmail: new Func(`like`, [
            new Ref([`users`, `email`]),
            new Value(`%@example.com`),
          ]),
          nameStartsWithA: new Func(`like`, [
            new Ref([`users`, `name`]),
            new Value(`A%`),
          ]),
        },
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Check Alice
      const aliceResult = results.find(([_key, result]) => result.id === 1)?.[1]
      expect(aliceResult).toEqual({
        id: 1,
        name: `Alice`,
        hasGmailEmail: true, // alice@example.com matches %@example.com
        nameStartsWithA: true, // Alice matches A%
      })

      // Check Bob
      const bobResult = results.find(([_key, result]) => result.id === 2)?.[1]
      expect(bobResult).toEqual({
        id: 2,
        name: `Bob`,
        hasGmailEmail: true, // bob@example.com matches %@example.com
        nameStartsWithA: false, // Bob doesn't match A%
      })
    })
  })

  describe(`Complex Filtering`, () => {
    test(`filters with nested conditions`, () => {
      const usersCollection = { id: `users` } as CollectionImpl

      // Find active users who are either young (< 25) OR have a name starting with 'A'
      const query: Query = {
        from: new CollectionRef(usersCollection, `users`),
        select: {
          id: new Ref([`users`, `id`]),
          name: new Ref([`users`, `name`]),
          age: new Ref([`users`, `age`]),
        },
        where: new Func(`and`, [
          new Func(`eq`, [new Ref([`users`, `active`]), new Value(true)]),
          new Func(`or`, [
            new Func(`lt`, [new Ref([`users`, `age`]), new Value(25)]),
            new Func(`like`, [new Ref([`users`, `name`]), new Value(`A%`)]),
          ]),
        ]),
      }

      const graph = new D2()
      const input = graph.newInput<[number, User]>()
      const pipeline = compileQuery(query, { users: input })

      const messages: Array<MultiSet<any>> = []
      pipeline.pipe(
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      input.sendData(
        new MultiSet(sampleUsers.map((user) => [[user.id, user], 1]))
      )

      graph.run()

      const results = messages[0]!.getInner().map(([data]) => data)

      // Should include:
      // - Alice (active=true, name starts with A)
      // - Bob (active=true, age=19 < 25)
      // - Dave (active=true, age=22 < 25)
      // Should exclude:
      // - Charlie (active=false)

      expect(results).toHaveLength(3)

      const includedIds = results.map(([_key, r]) => r.id).sort()
      expect(includedIds).toEqual([1, 2, 4]) // Alice, Bob, Dave
    })
  })
})
