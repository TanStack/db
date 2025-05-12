import { describe, expect, test } from "vitest"
import {
  Antichain,
  D2,
  MessageType,
  MultiSet,
  output,
  v,
} from "@electric-sql/d2ts"
import { compileQueryPipeline } from "../../src/query/pipeline-compiler.js"
import type { Query } from "../../src/query/schema.js"
import type { Keyed, Message } from "@electric-sql/d2ts"

// Sample user type for tests
type User = {
  id: number
  name: string
  age: number
  email: string
  active: boolean
  metadata: {
    createdAt: string
    tags: Array<string>
  }
}

type Context = {
  baseSchema: {
    users: User
  }
  schema: {
    users: User
  }
}

// Sample data for tests
const sampleUsers: Array<User> = [
  {
    id: 1,
    name: `Alice`,
    age: 25,
    email: `alice@example.com`,
    active: true,
    metadata: {
      createdAt: `2023-01-01`,
      tags: [`admin`, `user`],
    },
  },
  {
    id: 2,
    name: `Bob`,
    age: 19,
    email: `bob@example.com`,
    active: true,
    metadata: {
      createdAt: `2023-02-15`,
      tags: [`user`],
    },
  },
  {
    id: 3,
    name: `Charlie`,
    age: 30,
    email: `charlie@example.com`,
    active: false,
    metadata: {
      createdAt: `2023-03-20`,
      tags: [`user`, `tester`],
    },
  },
  {
    id: 4,
    name: `Dave`,
    age: 22,
    email: `dave@example.com`,
    active: true,
    metadata: {
      createdAt: `2023-04-10`,
      tags: [`user`],
    },
  },
]

describe(`Query keyBy`, () => {
  test(`keyBy with a single string column`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@age`, `@email`],
      from: `users`,
      keyBy: `@id`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Check that we have the correct number of messages
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    expect(dataMessages).toHaveLength(1)

    // Get the keyed data from the message
    const keyedData = dataMessages[0]!.data.collection.getInner()
    expect(keyedData).toHaveLength(4)

    // Check that the data is keyed by id
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<number, Record<string, unknown>>

      // The key should be a number (the id)
      expect(typeof key).toBe(`number`)

      // The value should have the id, name, age, and email properties
      expect(value).toHaveProperty(`id`, key)
      expect(value).toHaveProperty(`name`)
      expect(value).toHaveProperty(`age`)
      expect(value).toHaveProperty(`email`)

      // Verify that the key matches the id in the value
      expect(key).toBe(value.id)
    })
  })

  test(`keyBy with a single numeric column`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@age`, `@email`],
      from: `users`,
      keyBy: `@age`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Get the keyed data from the message
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const keyedData = dataMessages[0]!.data.collection.getInner()

    // Check that the data is keyed by age
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<number, Record<string, unknown>>

      // The key should be a number (the age)
      expect(typeof key).toBe(`number`)

      // Verify that the key matches the age in the value
      expect(key).toBe(value.age)
    })
  })

  test(`keyBy with a complex object column (JSON serialized)`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@metadata`],
      from: `users`,
      keyBy: `@metadata`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Get the keyed data from the message
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const keyedData = dataMessages[0]!.data.collection.getInner()

    // Check that the data is keyed by metadata (serialized)
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<string, Record<string, unknown>>

      // The key should be a string (serialized metadata)
      expect(typeof key).toBe(`string`)

      // We should be able to parse it back to an object
      const parsedKey = JSON.parse(key)
      expect(parsedKey).toHaveProperty(`createdAt`)
      expect(parsedKey).toHaveProperty(`tags`)

      // The parsed key should match the metadata in the value
      expect(parsedKey).toEqual(value.metadata)
    })
  })

  test(`keyBy with multiple columns`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@age`, `@active`],
      from: `users`,
      keyBy: [`@name`, `@age`],
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Get the keyed data from the message
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const keyedData = dataMessages[0]!.data.collection.getInner()

    // Check that the data is keyed by name and age
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<string, Record<string, unknown>>

      // The key should be a string (serialized object with name and age)
      expect(typeof key).toBe(`string`)

      // We should be able to parse it back to an object
      const parsedKey = JSON.parse(key)
      expect(parsedKey).toHaveProperty(`name`)
      expect(parsedKey).toHaveProperty(`age`)

      // The parsed key should match the name and age in the value
      expect(parsedKey.name).toBe(value.name)
      expect(parsedKey.age).toBe(value.age)
    })
  })

  test(`keyBy with wildcard select`, () => {
    const query: Query<Context> = {
      select: [`@*`],
      from: `users`,
      keyBy: `@id`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Get the keyed data from the message
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const keyedData = dataMessages[0]!.data.collection.getInner()

    // Check that the data is keyed by id
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<number, Record<string, unknown>>

      // The key should be a number (the id)
      expect(typeof key).toBe(`number`)

      // The value should have all properties
      expect(value).toHaveProperty(`id`, key)
      expect(value).toHaveProperty(`name`)
      expect(value).toHaveProperty(`age`)
      expect(value).toHaveProperty(`email`)
      expect(value).toHaveProperty(`active`)
      expect(value).toHaveProperty(`metadata`)
    })
  })

  test(`keyBy with column not in select throws error`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`],
      from: `users`,
      keyBy: `@age`, // age is not in select
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()

    // This should throw an error
    expect(() => {
      const pipeline = compileQueryPipeline(query, { [query.from]: input })

      pipeline.pipe(output(() => {}))

      graph.finalize()

      input.sendData(
        v([1, 0]),
        new MultiSet(sampleUsers.map((user) => [user, 1]))
      )
      input.sendFrontier(new Antichain([v([1, 0])]))

      graph.run()
    }).toThrow(/Key column "age" not found in result set/)
  })

  test(`keyBy with filtered data`, () => {
    const query: Query<Context> = {
      select: [`@id`, `@name`, `@age`, `@active`],
      from: `users`,
      where: [`@age`, `>`, 20],
      keyBy: `@id`,
    }

    const graph = new D2({ initialFrontier: v([0, 0]) })
    const input = graph.newInput<User>()
    const pipeline = compileQueryPipeline(query, { [query.from]: input })

    const messages: Array<Message<any>> = []
    pipeline.pipe(
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      v([1, 0]),
      new MultiSet(sampleUsers.map((user) => [user, 1]))
    )
    input.sendFrontier(new Antichain([v([1, 0])]))

    graph.run()

    // Get the keyed data from the message
    const dataMessages = messages.filter((m) => m.type === MessageType.DATA)
    const keyedData = dataMessages[0]!.data.collection.getInner()

    // Should only have users with age > 20
    expect(keyedData).toHaveLength(3) // Alice, Charlie, Dave

    // Check that the data is keyed by id and filtered correctly
    keyedData.forEach(([keyedItem]) => {
      const [key, value] = keyedItem as Keyed<number, Record<string, unknown>>

      // The key should be a number (the id)
      expect(typeof key).toBe(`number`)

      // The value should have age > 20
      expect(Number(value.age)).toBeGreaterThan(20)

      // Verify that the key matches the id in the value
      expect(key).toBe(value.id)
    })

    // Check that specific users are included
    const includedIds = keyedData
      .map(([keyedItem]) => {
        const [key] = keyedItem as Keyed<number, Record<string, unknown>>
        return key
      })
      .sort()

    expect(includedIds).toEqual([1, 3, 4]) // Alice, Charlie, Dave
  })
})
