import { describe, expect, it } from "vitest"

describe(`Value Selection in Merging`, () => {
  it(`should use the NEW value when merging unchecking scenario`, () => {
    // When unchecking a todo, we should end up with completed: false
    // But the test shows we might be getting completed: true (the old value)

    const messages = [
      // New version (unchecked) - this is what we want
      {
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      // Old version deleted
      {
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      // Duplicate new version - this confirms what the new value should be
      {
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      // More old version deletes
      {
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
    ]

    // The issue: we need to identify which value is the "new" one
    // In differential dataflow, all inserts (+1) should have the NEW value
    // All deletes (-1) should have the OLD value

    const inserts = messages.filter((msg) => msg.mz_diff === `1`)
    const deletes = messages.filter((msg) => msg.mz_diff === `-1`)

    console.log(
      `Inserts:`,
      inserts.map((m) => m.row)
    )
    console.log(
      `Deletes:`,
      deletes.map((m) => m.row)
    )

    // All inserts should have the same data (the new value)
    const allInsertsMatch = inserts.every(
      (insert) => JSON.stringify(insert.row) === JSON.stringify(inserts[0].row)
    )

    // All deletes should have the same data (the old value)
    const allDeletesMatch = deletes.every(
      (del) => JSON.stringify(del.row) === JSON.stringify(deletes[0].row)
    )

    expect(allInsertsMatch).toBe(true)
    expect(allDeletesMatch).toBe(true)

    // The new value should be from any insert
    const newValue = inserts[0].row
    expect(newValue.completed).toBe(false) // This is what we want!

    // The old value should be from any delete
    const oldValue = deletes[0].row
    expect(oldValue.completed).toBe(true)
  })

  it(`should handle edge case where inserts have different values`, () => {
    // This shouldn't happen in normal differential dataflow, but let's be defensive
    const messages = [
      { row: { id: 1, completed: false, version: 1 }, mz_diff: `1` },
      { row: { id: 1, completed: true, version: 0 }, mz_diff: `-1` },
      { row: { id: 1, completed: false, version: 2 }, mz_diff: `1` }, // Different insert!
    ]

    const inserts = messages.filter((msg) => msg.mz_diff === `1`)

    // If inserts differ, we should use the latest one by some criteria
    // Options: highest timestamp, highest version, or just the last one in order

    // For now, let's use the last one (most recent)
    const finalValue = inserts[inserts.length - 1].row
    expect(finalValue.version).toBe(2)
  })

  it(`should demonstrate the current problem`, () => {
    // This simulates what might be happening now
    const messages = [
      { row: { id: 1, completed: false }, mz_diff: `1`, order: 1 },
      { row: { id: 1, completed: true }, mz_diff: `-1`, order: 2 },
      { row: { id: 1, completed: false }, mz_diff: `1`, order: 3 },
      { row: { id: 1, completed: true }, mz_diff: `-1`, order: 4 },
    ]

    const inserts = messages.filter((msg) => msg.mz_diff === `1`)
    // const deletes = messages.filter((msg) => msg.mz_diff === `-1`)

    // Current logic: use last insert
    const currentLogicValue = inserts[inserts.length - 1].row
    console.log(`Current logic would use:`, currentLogicValue)

    // This should be completed: false, but let's verify our test data
    expect(currentLogicValue.completed).toBe(false)

    // The problem might be in how we're identifying which row is which
    // Or there might be timing issues with the messages
  })

  it(`should handle the case where message order matters`, () => {
    // What if the problem is that we're getting messages in a different order?
    const messagesScenario1 = [
      { row: { id: 1, completed: false }, mz_diff: `1`, timestamp: 1000.1 },
      { row: { id: 1, completed: true }, mz_diff: `-1`, timestamp: 1000.2 },
    ]

    const messagesScenario2 = [
      { row: { id: 1, completed: true }, mz_diff: `-1`, timestamp: 1000.1 },
      { row: { id: 1, completed: false }, mz_diff: `1`, timestamp: 1000.2 },
    ]

    // In both scenarios, we want completed: false (the insert value)
    // But we need to handle the case where timestamps are different

    for (const messages of [messagesScenario1, messagesScenario2]) {
      const inserts = messages.filter((msg) => msg.mz_diff === `1`)
      const result = inserts[0].row // Any insert should have the new value
      expect(result.completed).toBe(false)
    }
  })
})
