import { describe, expect, it } from "vitest"
import { Scheduler } from "../src/scheduler"

describe(`Scheduler - unresolved dependencies fix (issue #813)`, () => {
  it(`should ignore dependencies that are not scheduled jobs in the context`, () => {
    const scheduler = new Scheduler()

    const job1 = Symbol(`job1`)
    const job2 = Symbol(`job2`) // This dependency won't be scheduled

    const contextId = `test-context`

    // Schedule job1 with a dependency on job2, but job2 is never scheduled
    let job1Executed = false
    scheduler.schedule({
      contextId,
      jobId: job1,
      dependencies: [job2], // job2 is not scheduled as a job
      run: () => {
        job1Executed = true
      },
    })

    // Before the fix, this would throw "Scheduler detected unresolved dependencies"
    // After the fix, job1 should execute because job2 isn't in the context
    expect(() => scheduler.flush(contextId)).not.toThrow()
    expect(job1Executed).toBe(true)
  })

  it(`should handle multiple jobs with unscheduled dependencies`, () => {
    const scheduler = new Scheduler()

    const job1 = Symbol(`job1`)
    const job2 = Symbol(`job2`)
    const job3 = Symbol(`job3`) // Unscheduled dependency

    const contextId = `test-context-2`

    let job1Executed = false
    let job2Executed = false

    scheduler.schedule({
      contextId,
      jobId: job1,
      dependencies: [job3], // Unscheduled dependency
      run: () => {
        job1Executed = true
      },
    })

    scheduler.schedule({
      contextId,
      jobId: job2,
      dependencies: [job1], // Depends on job1
      run: () => {
        job2Executed = true
      },
    })

    // Should execute both jobs: job1 first (ignoring unscheduled job3), then job2
    expect(() => scheduler.flush(contextId)).not.toThrow()
    expect(job1Executed).toBe(true)
    expect(job2Executed).toBe(true)
  })

  it(`should still detect actual circular dependencies`, () => {
    const scheduler = new Scheduler()

    const job1 = Symbol(`job1`)
    const job2 = Symbol(`job2`)

    const contextId = `test-context-3`

    scheduler.schedule({
      contextId,
      jobId: job1,
      dependencies: [job2], // job1 depends on job2
      run: () => {},
    })

    scheduler.schedule({
      contextId,
      jobId: job2,
      dependencies: [job1], // job2 depends on job1 (circular!)
      run: () => {},
    })

    // Should still detect circular dependency
    expect(() => scheduler.flush(contextId)).toThrow(
      `Scheduler detected unresolved dependencies`
    )
  })

  it(`should handle self-dependencies gracefully`, () => {
    const scheduler = new Scheduler()

    const job1 = Symbol(`job1`)
    const contextId = `test-context-4`

    let executed = false
    scheduler.schedule({
      contextId,
      jobId: job1,
      dependencies: [job1], // Self-dependency
      run: () => {
        executed = true
      },
    })

    // Self-dependencies should be ignored
    expect(() => scheduler.flush(contextId)).not.toThrow()
    expect(executed).toBe(true)
  })
})
