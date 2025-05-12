import { describe, expectTypeOf, it } from "vitest"
import type {
  Context,
  Input,
  InputReference,
  PropertyReference,
  Schema,
  TypeFromPropertyReference,
  WildcardReference,
} from "../../src/query/types.js"

// Define a test schema
interface TestSchema extends Schema {
  users: {
    id: number
    name: string
    email: string
  }
  posts: {
    id: number
    title: string
    content: string
    authorId: number
    views: number
  }
  comments: {
    id: number
    postId: number
    userId: number
    content: string
  }
}

// Test context with users as default
interface UsersContext extends Context<TestSchema> {
  baseSchema: TestSchema
  schema: TestSchema
  default: `users`
}

describe(`Query types`, () => {
  describe(`Input type`, () => {
    it(`should handle basic input objects`, () => {
      expectTypeOf<Input>().toBeObject()
      expectTypeOf<TestSchema[`users`]>().toMatchTypeOf<Input>()
    })
  })

  describe(`Schema type`, () => {
    it(`should be a collection of inputs`, () => {
      expectTypeOf<Schema>().toBeObject()
      expectTypeOf<TestSchema>().toMatchTypeOf<Schema>()
      expectTypeOf<TestSchema>().toHaveProperty(`users`)
      expectTypeOf<TestSchema>().toHaveProperty(`posts`)
      expectTypeOf<TestSchema>().toHaveProperty(`comments`)
    })
  })

  describe(`Context type`, () => {
    it(`should have schema and default properties`, () => {
      expectTypeOf<Context<TestSchema>>().toBeObject()
      expectTypeOf<Context<TestSchema>>().toHaveProperty(`schema`)
      expectTypeOf<Context<TestSchema>>().toHaveProperty(`default`)
      expectTypeOf<UsersContext[`default`]>().toEqualTypeOf<`users`>()
    })
  })

  describe(`PropertyReference type`, () => {
    it(`should accept qualified references with string format`, () => {
      expectTypeOf<`@users.id`>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
      expectTypeOf<`@posts.authorId`>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
    })

    it(`should accept qualified references with object format`, () => {
      expectTypeOf<{ col: `users.id` }>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
      expectTypeOf<{ col: `posts.authorId` }>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
    })

    it(`should accept default references with string format`, () => {
      expectTypeOf<`@id`>().toMatchTypeOf<PropertyReference<UsersContext>>()
      expectTypeOf<`@name`>().toMatchTypeOf<PropertyReference<UsersContext>>()
    })

    it(`should accept default references with object format`, () => {
      expectTypeOf<{ col: `id` }>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
      expectTypeOf<{ col: `name` }>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
    })

    it(`should accept unique references with string format`, () => {
      // 'views' only exists in posts
      expectTypeOf<`@views`>().toMatchTypeOf<PropertyReference<UsersContext>>()
      // 'content' exists in both posts and comments, so not a unique reference
      // This should fail type checking if uncommented:
      // expectTypeOf<'@content'>().toMatchTypeOf<PropertyReference<UsersContext>>();
    })

    it(`should accept unique references with object format`, () => {
      // 'views' only exists in posts
      expectTypeOf<{ col: `views` }>().toMatchTypeOf<
        PropertyReference<UsersContext>
      >()
      // 'content' exists in both posts and comments, so not a unique reference
      // This should fail type checking if uncommented:
      // expectTypeOf<{ col: 'content' }>().toMatchTypeOf<PropertyReference<UsersContext>>();
    })
  })

  describe(`WildcardReference type`, () => {
    it(`should accept input wildcards with string format`, () => {
      expectTypeOf<`@users.*`>().toMatchTypeOf<
        WildcardReference<UsersContext>
      >()
      expectTypeOf<`@posts.*`>().toMatchTypeOf<
        WildcardReference<UsersContext>
      >()
    })

    it(`should accept input wildcards with object format`, () => {
      expectTypeOf<{ col: `users.*` }>().toMatchTypeOf<
        WildcardReference<UsersContext>
      >()
      expectTypeOf<{ col: `posts.*` }>().toMatchTypeOf<
        WildcardReference<UsersContext>
      >()
    })

    it(`should accept global wildcard with string format`, () => {
      expectTypeOf<`@*`>().toMatchTypeOf<WildcardReference<UsersContext>>()
    })

    it(`should accept global wildcard with object format`, () => {
      expectTypeOf<{ col: `*` }>().toMatchTypeOf<
        WildcardReference<UsersContext>
      >()
    })
  })

  describe(`TypeFromPropertyReference type`, () => {
    it(`should resolve qualified references with string format`, () => {
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@users.id`>
      >().toEqualTypeOf<number>()

      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@posts.title`>
      >().toEqualTypeOf<string>()
    })

    it(`should resolve qualified references with object format`, () => {
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `users.id` }>
      >().toEqualTypeOf<number>()

      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `posts.title` }>
      >().toEqualTypeOf<string>()
    })

    it(`should resolve default references with string format`, () => {
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@id`>
      >().toEqualTypeOf<number>()

      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@name`>
      >().toEqualTypeOf<string>()
    })

    it(`should resolve default references with object format`, () => {
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `id` }>
      >().toEqualTypeOf<number>()

      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `name` }>
      >().toEqualTypeOf<string>()
    })

    it(`should resolve unique references with string format`, () => {
      // 'views' only exists in posts
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@views`>
      >().toEqualTypeOf<number>()

      // 'authorId' only exists in posts
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, `@authorId`>
      >().toEqualTypeOf<number>()
    })

    it(`should resolve unique references with object format`, () => {
      // 'views' only exists in posts
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `views` }>
      >().toEqualTypeOf<number>()

      // 'authorId' only exists in posts
      expectTypeOf<
        TypeFromPropertyReference<UsersContext, { col: `authorId` }>
      >().toEqualTypeOf<number>()
    })
  })

  describe(`InputReference type`, () => {
    it(`should extract input names from the context schema`, () => {
      // Should be a union of all input names
      expectTypeOf<InputReference<UsersContext>>().toEqualTypeOf<
        `users` | `posts` | `comments`
      >()

      // Test with a context containing only one input
      type SingleInputSchema = {
        singleInput: { id: number }
      }
      type SingleInputContext = {
        baseSchema: SingleInputSchema
        schema: SingleInputSchema
        default: `singleInput`
      }
      expectTypeOf<
        InputReference<SingleInputContext>
      >().toEqualTypeOf<`singleInput`>()
    })
  })
})
