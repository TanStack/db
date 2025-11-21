/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import type {
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
  UpdateMutationFnParams,
  UtilsRecord,
} from "@tanstack/db"
import type {
  Firestore,
  CollectionReference,
  DocumentReference,
  DocumentData,
  QuerySnapshot,
  Unsubscribe,
  FirestoreError,
  QueryDocumentSnapshot,
  SnapshotOptions,
  WithFieldValue,
  QueryConstraint,
  Query,
} from "firebase/firestore"
import {
  collection,
  doc,
  onSnapshot,
  writeBatch,
  query,
  limit,
  getDocs,
  startAfter,
  serverTimestamp,
  addDoc,
  waitForPendingWrites,
  onSnapshotsInSync,
  runTransaction,
} from "firebase/firestore"
import {
  ExpectedInsertTypeError,
  ExpectedUpdateTypeError,
  ExpectedDeleteTypeError,
  FirestoreIntegrationError,
} from "./errors"
import type { ShapeOf, FirebaseConversion, FirebaseConversions } from "./types"

const FIRESTORE_BATCH_LIMIT = 500

function convert<
  InputType extends ShapeOf<OutputType> & Record<string, unknown>,
  OutputType extends ShapeOf<InputType>,
>(
  conversions: FirebaseConversions<InputType, OutputType>,
  input: InputType
): OutputType {
  const c = conversions as Record<
    string,
    FirebaseConversion<InputType, OutputType>
  >

  return Object.fromEntries(
    Object.keys(input).map((k: string) => {
      const value = input[k]
      return [k, c[k]?.(value as any) ?? value]
    })
  ) as OutputType
}

function convertPartial<
  InputType extends ShapeOf<OutputType> & Record<string, unknown>,
  OutputType extends ShapeOf<InputType>,
>(
  conversions: FirebaseConversions<InputType, OutputType>,
  input: Partial<InputType>
): Partial<OutputType> {
  const c = conversions as Record<
    string,
    FirebaseConversion<InputType, OutputType>
  >

  return Object.fromEntries(
    Object.keys(input).map((k: string) => {
      const value = input[k]
      return [k, c[k]?.(value as any) ?? value]
    })
  ) as OutputType
}

/**
 * Configuration interface for Firebase Collection
 */
export interface FirebaseCollectionConfig<
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
  TKey extends string = string,
> extends Omit<
    CollectionConfig<TItem, TKey>,
    "sync" | "onInsert" | "onUpdate" | "onDelete"
  > {
  /**
   * Firestore instance
   */
  firestore: Firestore

  /**
   * Collection name in Firestore
   */
  collectionName: string

  /**
   * Page size for initial fetch
   * @default 1000
   */
  pageSize?: number

  /**
   * Parse conversions from Firestore document to TItem
   */
  parse?: FirebaseConversions<TRecord, TItem>

  /**
   * Serialize conversions from TItem to Firestore document
   */
  serialize?: FirebaseConversions<TItem, TRecord>

  /**
   * Custom converter for Firestore documents
   */
  converter?: {
    toFirestore: (data: WithFieldValue<TItem>) => DocumentData
    fromFirestore: (
      snapshot: QueryDocumentSnapshot,
      options: SnapshotOptions
    ) => TRecord
  }

  /**
   * Whether to use auto-generated IDs for new documents
   * @default false
   */
  autoId?: boolean

  /**
   * Initial query constraints (e.g., orderBy, where)
   * These constraints will be applied to both initial fetch and listener
   */
  queryConstraints?: QueryConstraint[]

  /**
   * How updates are applied to rows
   * - 'partial': Only specified fields are updated (default)
   * - 'full': Entire row is replaced
   * @default 'partial'
   */
  rowUpdateMode?: "partial" | "full"

  /**
   * Whether to include metadata changes in the listener
   * @default false
   */
  includeMetadataChanges?: boolean

  /**
   * For large collections, provide a query builder
   * This allows users to sync only a subset of data
   */
  queryBuilder?: (baseQuery: Query) => Query

  /**
   * Whether to use transactions for update operations
   * This provides stronger consistency guarantees
   * @default false
   */
  useTransactions?: boolean
}

export interface FirebaseCollectionUtils extends UtilsRecord {
  /**
   * Cancel the real-time listener
   */
  cancel: () => void

  /**
   * Get the Firestore collection reference
   */
  getCollectionRef: () => CollectionReference<DocumentData>

  /**
   * Wait for all pending writes to be acknowledged by the server
   */
  waitForSync: () => Promise<void>
}

interface BufferedEvent {
  type: "added" | "modified" | "removed"
  data: any
  doc: QueryDocumentSnapshot
}

async function executeBatchedWrites(
  firestore: Firestore,
  operations: Array<{
    type: "set" | "update" | "delete"
    ref: DocumentReference
    data?: any
  }>
): Promise<void> {
  // Split into chunks of FIRESTORE_BATCH_LIMIT
  for (let i = 0; i < operations.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = operations.slice(i, i + FIRESTORE_BATCH_LIMIT)
    const batch = writeBatch(firestore)

    for (const op of chunk) {
      switch (op.type) {
        case "set":
          batch.set(op.ref, op.data)
          break
        case "update":
          batch.update(op.ref, op.data)
          break
        case "delete":
          batch.delete(op.ref)
          break
      }
    }

    await batch.commit()
  }
}

function handleFirestoreError(error: unknown, context: string): never {
  if ((error as FirestoreError).code) {
    const firestoreError = error as FirestoreError
    switch (firestoreError.code) {
      case "permission-denied":
        throw new FirestoreIntegrationError(`Permission denied: ${context}`)
      case "not-found":
        throw new FirestoreIntegrationError(`Document not found: ${context}`)
      case "already-exists":
        throw new FirestoreIntegrationError(
          `Document already exists: ${context}`
        )
      case "resource-exhausted":
        throw new FirestoreIntegrationError(`Quota exceeded: ${context}`)
      case "unavailable":
        throw new FirestoreIntegrationError(
          `Service temporarily unavailable: ${context}`
        )
      case "failed-precondition":
        throw new FirestoreIntegrationError(
          `Operation failed precondition: ${context}`
        )
      case "unimplemented":
        throw new FirestoreIntegrationError(
          `Operation not supported: ${context}`
        )
      default:
        throw new FirestoreIntegrationError(
          `Firestore error (${firestoreError.code}): ${firestoreError.message}`
        )
    }
  }
  throw error
}

class ExponentialBackoff {
  private attempt = 0
  private readonly maxAttempts = 5
  private readonly baseDelay = 1000

  async execute<T>(operation: () => Promise<T>, context: string): Promise<T> {
    while (this.attempt < this.maxAttempts) {
      try {
        const result = await operation()
        this.reset()
        return result
      } catch (error) {
        this.attempt++

        if (this.attempt >= this.maxAttempts) {
          throw new FirestoreIntegrationError(
            `${context} failed after ${this.maxAttempts} attempts: ${error}`
          )
        }

        const delay = this.baseDelay * Math.pow(2, this.attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    throw new FirestoreIntegrationError("Unreachable")
  }

  reset() {
    this.attempt = 0
  }
}

export function firebaseCollectionOptions<
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
  TKey extends string = string,
>(
  config: FirebaseCollectionConfig<TItem, TRecord, TKey>
): CollectionConfig<TItem, TKey> & { utils: FirebaseCollectionUtils } {
  const {
    firestore,
    collectionName,
    pageSize = 1000,
    parse: parseConversions = {} as FirebaseConversions<TRecord, TItem>,
    serialize: serializeConversions = {} as FirebaseConversions<TItem, TRecord>,
    converter,
    autoId = false,
    queryConstraints = [],
    rowUpdateMode = "partial",
    includeMetadataChanges = false,
    queryBuilder,
    useTransactions = false,
    ...restConfig
  } = config

  const getKey = config.getKey || ((item: TItem) => (item as any).id as TKey)

  const parse = (record: TRecord) =>
    convert<TRecord, TItem>(parseConversions, record)
  const serialUpd = (item: Partial<TItem>) =>
    convertPartial<TItem, TRecord>(serializeConversions, item)
  const serialIns = (item: TItem) =>
    convert<TItem, TRecord>(serializeConversions, item)

  const collectionRef = collection(firestore, collectionName)
  const backoff = new ExponentialBackoff()

  let unsubscribeSnapshot: Unsubscribe | undefined
  const cancelSnapshot = () => {
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot()
      unsubscribeSnapshot = undefined
    }
  }

  const waitForSync = (): Promise<void> => {
    return new Promise((resolve) => {
      const unsubscribe = onSnapshotsInSync(firestore, () => {
        unsubscribe()
        resolve()
      })
    })
  }

  type SyncParams = Parameters<SyncConfig<TItem, TKey>["sync"]>[0]
  const sync: SyncConfig<TItem, TKey> = {
    sync: (params: SyncParams) => {
      const { begin, write, commit, markReady } = params

      const eventBuffer: BufferedEvent[] = []
      let isInitialFetchComplete = false
      const fetchedIds = new Set<string>()
      let initialFetchEndTime: Date

      // Build the query with constraints
      let baseQuery: Query = collectionRef
      if (queryConstraints.length > 0) {
        baseQuery = query(collectionRef, ...queryConstraints)
      }

      // Apply custom query builder if provided
      const finalQuery = queryBuilder ? queryBuilder(baseQuery) : baseQuery

      // STEP 1: Start listener immediately (before initial fetch)
      function setupListener() {
        unsubscribeSnapshot = onSnapshot(
          finalQuery,
          { includeMetadataChanges },
          (snapshot: QuerySnapshot) => {
            const events: BufferedEvent[] = snapshot
              .docChanges()
              .map((change) => ({
                type: change.type,
                data: converter
                  ? converter.fromFirestore(
                      change.doc as QueryDocumentSnapshot,
                      {}
                    )
                  : ({
                      id: change.doc.id,
                      ...change.doc.data(),
                    } as unknown as TRecord),
                doc: change.doc as QueryDocumentSnapshot,
              }))

            if (!isInitialFetchComplete) {
              // Buffer events during initial fetch
              eventBuffer.push(...events)
            } else {
              // Process events immediately after initial fetch
              processEvents(events)
            }
          },
          (error) => {
            if (error.code === "aborted") {
              console.warn("Firestore listener aborted", error)
              return
            }
            console.error("Firestore listener error:", error)
            handleFirestoreError(error, "real-time sync")
          }
        )
      }

      function processEvent(event: BufferedEvent) {
        const value = parse(event.data)

        write({
          type:
            event.type === "added"
              ? "insert"
              : event.type === "modified"
                ? "update"
                : "delete",
          value,
        })
      }

      function processEvents(events: BufferedEvent[]) {
        if (events.length === 0) return

        begin()
        events.forEach(processEvent)
        commit()
      }

      // STEP 2: Perform initial fetch
      async function initialFetch() {
        let lastDoc: QueryDocumentSnapshot | null = null
        let hasMore = true

        begin()

        while (hasMore) {
          try {
            const constraints: QueryConstraint[] = [
              ...queryConstraints,
              limit(pageSize),
              ...(lastDoc ? [startAfter(lastDoc)] : []),
            ]

            const q = query(collectionRef, ...constraints)
            const snapshot = await getDocs(q)

            if (snapshot.empty) {
              hasMore = false
              break
            }

            snapshot.forEach((docSnap: QueryDocumentSnapshot) => {
              const id = docSnap.id
              fetchedIds.add(id)

              const data = converter
                ? converter.fromFirestore(docSnap as QueryDocumentSnapshot, {})
                : ({ id, ...docSnap.data() } as unknown as TRecord)

              write({
                type: "insert",
                value: parse(data),
              })
            })

            lastDoc = snapshot.docs[snapshot.docs.length - 1] || null
            hasMore = snapshot.docs.length === pageSize
          } catch (error) {
            handleFirestoreError(error, "initial fetch")
          }
        }

        initialFetchEndTime = new Date()
        commit()
      }

      // STEP 3: Process buffered events
      function processBufferedEvents() {
        if (eventBuffer.length === 0) return

        begin()

        for (const event of eventBuffer) {
          // Skip if we already fetched this document
          if (event.type === "added" && fetchedIds.has(event.data.id)) {
            // Only process if it's newer than our fetch
            const docTime = event.doc.metadata.hasPendingWrites
              ? new Date()
              : event.doc.metadata.fromCache
                ? undefined
                : event.doc.data()?.updatedAt?.toDate?.()

            if (!docTime || docTime <= initialFetchEndTime) {
              continue
            }
          }

          processEvent(event)
        }

        commit()
        eventBuffer.length = 0 // Clear buffer
      }

      // STEP 4: Execute in correct order
      async function start() {
        try {
          setupListener() // First! Prevents race condition
          await backoff.execute(() => initialFetch(), "initial fetch")
          isInitialFetchComplete = true
          processBufferedEvents()
        } catch (error) {
          console.error("Sync failed:", error)
          cancelSnapshot()
          throw error
        } finally {
          markReady() // Always call this
        }
      }

      start()

      // CRITICAL: Return cleanup function
      return () => {
        cancelSnapshot()
      }
    },
    rowUpdateMode,
    getSyncMetadata: undefined,
  }

  return {
    ...restConfig,
    sync,
    getKey,
    onInsert: async (
      params: InsertMutationFnParams<TItem, TKey>
    ): Promise<Array<TKey>> => {
      if (autoId) {
        // Can't batch with auto-generated IDs
        const ids = await Promise.all(
          params.transaction.mutations.map(async (mutation) => {
            const { type, modified } = mutation
            if (type !== "insert") {
              throw new ExpectedInsertTypeError(type)
            }

            const docRef = await backoff.execute(
              () =>
                addDoc(collectionRef, {
                  ...serialIns(modified),
                  createdAt: serverTimestamp(),
                }),
              "insert document"
            )

            return docRef.id as TKey
          })
        )

        await waitForPendingWrites(firestore)
        return ids
      } else {
        // Use batched approach
        const operations = params.transaction.mutations.map((mutation) => {
          const { type, modified } = mutation
          if (type !== "insert") {
            throw new ExpectedInsertTypeError(type)
          }

          const id = String(getKey(modified))
          return {
            type: "set" as const,
            ref: doc(collectionRef, id),
            data: {
              ...serialIns(modified),
              createdAt: serverTimestamp(),
            },
          }
        })

        await backoff.execute(
          () => executeBatchedWrites(firestore, operations),
          "batch insert"
        )

        await waitForPendingWrites(firestore)
        return params.transaction.mutations.map((m) => getKey(m.modified))
      }
    },
    onUpdate: async (params: UpdateMutationFnParams<TItem, TKey>) => {
      if (useTransactions) {
        // Use transactions for stronger consistency
        await Promise.all(
          params.transaction.mutations.map(async (mutation) => {
            const { type, changes, key } = mutation
            if (type !== "update") {
              throw new ExpectedUpdateTypeError(type)
            }

            const docRef = doc(collectionRef, String(key))

            await runTransaction(firestore, async (transaction) => {
              const docSnap = await transaction.get(docRef)
              if (!docSnap.exists()) {
                throw new FirestoreIntegrationError(`Document ${key} not found`)
              }

              transaction.update(docRef, {
                ...serialUpd(changes),
                updatedAt: serverTimestamp(),
              })
            })
          })
        )
      } else {
        // Use batched writes
        const operations = params.transaction.mutations.map((mutation) => {
          const { type, changes, key } = mutation
          if (type !== "update") {
            throw new ExpectedUpdateTypeError(type)
          }

          return {
            type: "update" as const,
            ref: doc(collectionRef, String(key)),
            data: {
              ...serialUpd(changes),
              updatedAt: serverTimestamp(),
            },
          }
        })

        await backoff.execute(
          () => executeBatchedWrites(firestore, operations),
          "batch update"
        )
      }

      await waitForPendingWrites(firestore)
    },
    onDelete: async (params: DeleteMutationFnParams<TItem, TKey>) => {
      const operations = params.transaction.mutations.map((mutation) => {
        const { type, key } = mutation
        if (type !== "delete") {
          throw new ExpectedDeleteTypeError(type)
        }

        return {
          type: "delete" as const,
          ref: doc(collectionRef, String(key)),
        }
      })

      await backoff.execute(
        () => executeBatchedWrites(firestore, operations),
        "batch delete"
      )

      await waitForPendingWrites(firestore)
    },
    utils: {
      cancel: cancelSnapshot,
      getCollectionRef: () => collectionRef,
      waitForSync,
    },
  }
}
