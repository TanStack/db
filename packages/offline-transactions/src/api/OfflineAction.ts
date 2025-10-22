import { SpanStatusCode, context, trace } from "@opentelemetry/api"
import { OnMutateMustBeSynchronousError } from "@tanstack/db"
import { OfflineTransaction } from "./OfflineTransaction"
import type { Transaction } from "@tanstack/db"
import type {
  CreateOfflineActionOptions,
  OfflineMutationFn,
  OfflineTransaction as OfflineTransactionType,
} from "../types"

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === `object` || typeof value === `function`) &&
    typeof (value as { then?: unknown }).then === `function`
  )
}

export function createOfflineAction<T>(
  options: CreateOfflineActionOptions<T>,
  mutationFn: OfflineMutationFn,
  persistTransaction: (tx: OfflineTransactionType) => Promise<void>,
  executor: any
): (variables: T) => Transaction {
  const { mutationFnName, onMutate } = options
  console.log(`createOfflineAction 2`, options)

  return (variables: T): Transaction => {
    const offlineTransaction = new OfflineTransaction(
      {
        mutationFnName,
        autoCommit: false,
      },
      mutationFn,
      persistTransaction,
      executor
    )

    const transaction = offlineTransaction.mutate(() => {
      console.log(`mutate`)
      const maybePromise = onMutate(variables) as unknown

      if (isPromiseLike(maybePromise)) {
        throw new OnMutateMustBeSynchronousError()
      }
    })

    // Immediately commit with span instrumentation
    const tracer = trace.getTracer(`@tanstack/offline-transactions`, `0.0.1`)
    const span = tracer.startSpan(`offlineAction.${mutationFnName}`)
    const ctx = trace.setSpan(context.active(), span)
    console.log(`starting offlineAction span`, { tracer, span, ctx })

    // Execute the commit within the span context
    // The key is to return the promise synchronously from context.with() so context binds to it
    const commitPromise = context.with(ctx, () => {
      // Return the promise synchronously - this is critical for context propagation in browsers
      return (async () => {
        try {
          await transaction.commit()
          span.setStatus({ code: SpanStatusCode.OK })
          span.end()
          console.log(`ended offlineAction span - success`)
        } catch (error) {
          span.recordException(error as Error)
          span.setStatus({ code: SpanStatusCode.ERROR })
          span.end()
          console.log(`ended offlineAction span - error`)
        }
      })()
    })

    // Don't await - this is fire-and-forget for optimistic actions
    // But catch to prevent unhandled rejection
    commitPromise.catch(() => {
      // Already handled in try/catch above
    })

    return transaction
  }
}
