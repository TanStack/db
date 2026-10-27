// Promise gates and a macrotask turn for the offline settlement tests. The
// settlement oracle in transaction-settlement-oracle.property.test.ts and the
// hand-written cases in transaction-settlement.test.ts both use them.

export function gate() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
