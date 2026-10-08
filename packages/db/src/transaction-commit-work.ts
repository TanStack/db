/** Work registered while a mutation function runs must settle before that
 * transaction reports completion. The returned Promise remains the caller's
 * error channel; observing its rejection here also protects callers that use
 * the older un-awaited manual acceptance pattern. */
const commitWork = new WeakMap<object, Array<Promise<unknown>>>()

export function registerTransactionCommitWork(
  transaction: object,
  work: Promise<unknown>,
): void {
  if (!('state' in transaction) || transaction.state !== `persisting`) return
  const registered = commitWork.get(transaction) ?? []
  registered.push(work)
  commitWork.set(transaction, registered)
  void work.catch(() => undefined)
}

export function takeTransactionCommitWork(
  transaction: object,
): Promise<void> | undefined {
  const registered = commitWork.get(transaction)
  if (!registered) return
  commitWork.delete(transaction)
  return Promise.allSettled(registered).then((results) => {
    const failure = results.find((result) => result.status === `rejected`)
    if (failure?.status === `rejected`) throw failure.reason
  })
}
