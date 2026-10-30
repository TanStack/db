/** Record a finite execution only after its driver enters a law comparison. */
export async function withFiniteComparison(action, record) {
  let compared = false
  let failed = false
  let primary
  try {
    return await action(() => {
      compared = true
    })
  } catch (error) {
    failed = true
    primary = error
    throw error
  } finally {
    if (compared) {
      try {
        record({ failed })
      } catch (witness) {
        throw failed
          ? new AggregateError(
              [primary, witness],
              'Finite comparison and witness failures',
              { cause: primary },
            )
          : witness
      }
    }
  }
}
