import { describe, expectTypeOf, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import { add, length, upper } from '../../src/query/builder/functions.js'
import type { WithVirtualProps } from '../../src/virtual-props.js'

// Base type used in bug report
type Message = {
  id: number
  text: string
  user: string
}

type OutputWithVirtual<
  T,
  TKey extends string | number = string,
> = WithVirtualProps<T, TKey>
type MessageWithVirtual = OutputWithVirtual<Message>

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
    }),
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
    expectTypeOf(results).toEqualTypeOf<
      Array<OutputWithVirtual<MessageWithVirtual>>
    >()

    // Accessors should also be correctly typed
    const first = collection.get(1)
    expectTypeOf(first).toEqualTypeOf<
      OutputWithVirtual<MessageWithVirtual> | undefined
    >()
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
      Array<
        OutputWithVirtual<
          MessageWithVirtual & { idPlusOne: number; upperText: string }
        >
      >
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
      Array<
        OutputWithVirtual<Omit<MessageWithVirtual, `user`> & { user: number }>
      >
    >(undefined as any)
  })

  test(`explicit property wins over spread and preserves type`, () => {
    const messagesCollection = createMessagesCollection()

    const collection = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const r = q
          .from({ message: messagesCollection })
          .select(({ message }) => {
            const s = {
              ...message,
              theMessage: {
                ...message,
                spam: message.text,
              },
            }
            return s
          })
        return r
      },
    })

    type Expected = MessageWithVirtual & {
      theMessage: MessageWithVirtual & {
        spam: string
      }
    }

    const results = collection.toArray
    expectTypeOf(results).toEqualTypeOf<Array<OutputWithVirtual<Expected>>>(
      undefined as any,
    )
  })
})
