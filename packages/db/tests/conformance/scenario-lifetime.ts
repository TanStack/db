type Cleanup = () => void | Promise<void>

/** Scenario-owned resources, not a runtime retry or source-lifetime policy. */
export class ScenarioLifetime {
  private readonly cleanups: Array<Cleanup> = []
  private readonly failures: Array<unknown> = []

  defer(cleanup: Cleanup): Cleanup {
    let attempted = false
    let completion: void | Promise<void>
    const once = () => {
      if (attempted) return completion
      attempted = true
      try {
        const result = cleanup()
        if (result instanceof Promise) {
          completion = result.catch((error: unknown) => {
            this.failures.push(error)
            throw error
          })
          // Observe now, even if a scenario fails before awaiting this resource.
          void completion.catch(() => undefined)
        }
        return completion
      } catch (error) {
        this.failures.push(error)
        throw error
      }
    }
    this.cleanups.push(once)
    return once
  }

  async run(body: () => void | Promise<void>): Promise<void> {
    const primary: Array<unknown> = []
    try {
      await body()
    } catch (error) {
      primary.push(error)
    }
    for (const cleanup of this.cleanups) {
      try {
        await cleanup()
      } catch {
        // defer records each failed attempt, including ones caught by the body.
      }
    }
    // Body and cleanup are separate observations. Equal payloads do not prove
    // they came from the same throw; keep both roles even for manual propagation.
    const errors = [...primary, ...this.failures]
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, `Scenario and cleanup failed`, {
        cause: errors[0],
      })
    }
  }
}
