import { describe, expectTypeOf, test } from "vitest"
import { createCollection } from "../../src/collection.js"
import { createLiveQueryCollection } from "../../src/query/index.js"
import { mockSyncCollectionOptions } from "../utls.js"
import { add, length, upper } from "../../src/query/builder/functions.js"

// Base type used in bug report
type Message = {
  id: number
  text: string
  user: string
}

const initialMessages: Array<Message> = [
  { id: 1, text: `hello`, user: `sam` },
  { id: 2, text: `world`, user: `kim` },
]

function createMessagesCollection() {
  return createCollection(
    mockSyncCollectionOptions<Message>({
      id: `messages`,
      getKey: (m) => m.id,
      initialData: initialMessages,
    })
  )
}

describe(`Select spread typing`, () => {
  test(`spreading the source alias projects the full row type`, () => {
    const messagesCollection = createMessagesCollection()

    const collection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ message: messagesCollection }).select(({ message }) => ({
          ...message,
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toEqualTypeOf<Array<Message>>()

    // Accessors should also be correctly typed
    const first = collection.get(1)
    expectTypeOf(first).toEqualTypeOf<Message | undefined>()
  })

  test(`spreading and adding computed fields merges types`, () => {
    const messagesCollection = createMessagesCollection()

    const collection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ message: messagesCollection }).select(({ message }) => ({
          ...message,
          idPlusOne: add(message.id, 1),
          upperText: upper(message.text),
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<Message & { idPlusOne: number; upperText: string }>
    >(undefined as any)
  })

  test(`explicit property wins over spread and preserves type`, () => {
    const messagesCollection = createMessagesCollection()

    const collection = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q.from({ message: messagesCollection }).select(({ message }) => ({
          ...message,
          // override user with computed value
          user: length(message.user), // illogical name, but for the test
        })),
    })

    const results = collection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<Omit<Message, `user`> & { user: number }>
    >(undefined as any)
  })

  test(`explicit property wins over spread and preserves type`, () => {
    const messagesCollection = createMessagesCollection()

    const collection = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const r = q.from({ message: messagesCollection }).select(({ message }) => {
          const s = {
              ...message,
            theMessage: {
              ...message,
              spam: message.text,
            }
          }
          return s
        })
        return r
      },
    })

    type Expected = {
      theMessage: Message & { spam: string }
    }

    const results = collection.toArray
    expectTypeOf(results).toEqualTypeOf<
      Array<Expected>
    >(undefined as any)
  })
})
