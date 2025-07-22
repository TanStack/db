import { describe, expect, it } from "vitest"

describe(`Row-Level Counting Logic`, () => {
  it(`should determine final state based on row content counts`, () => {
    // When unchecking: completed:false should have net positive count
    const messages = [
      { row: { id: 1, text: `Todo`, completed: false }, mz_diff: `1` },
      { row: { id: 1, text: `Todo`, completed: true }, mz_diff: `-1` },
      { row: { id: 1, text: `Todo`, completed: false }, mz_diff: `1` },
      { row: { id: 1, text: `Todo`, completed: true }, mz_diff: `-1` },
      { row: { id: 1, text: `Todo`, completed: true }, mz_diff: `-1` },
      { row: { id: 1, text: `Todo`, completed: true }, mz_diff: `-1` },
    ]

    // Count by actual row content
    const rowCounts = new Map<string, { row: any; count: number }>()

    messages.forEach((msg) => {
      const rowKey = JSON.stringify(msg.row)
      const diff = parseInt(msg.mz_diff || `0`, 10)

      if (!rowCounts.has(rowKey)) {
        rowCounts.set(rowKey, { row: msg.row, count: 0 })
      }
      rowCounts.get(rowKey)!.count += diff
    })

    console.log(`Row counts:`)
    for (const [rowKey, data] of rowCounts.entries()) {
      console.log(`  ${rowKey}: count = ${data.count}`)
    }

    // Find the row with positive count
    let finalRow: any = null
    for (const [_rowKey, data] of rowCounts.entries()) {
      if (data.count > 0) {
        finalRow = data.row
        break
      }
    }

    expect(finalRow).not.toBeNull()
    expect(finalRow.completed).toBe(false) // This should be the final state!
  })

  it(`should handle the case where both rows cancel out`, () => {
    const messages = [
      { row: { id: 1, completed: false }, mz_diff: `1` },
      { row: { id: 1, completed: true }, mz_diff: `-1` },
      { row: { id: 1, completed: false }, mz_diff: `-1` }, // This cancels the first
      { row: { id: 1, completed: true }, mz_diff: `1` }, // This cancels the second
    ]

    const rowCounts = new Map<string, { row: any; count: number }>()

    messages.forEach((msg) => {
      const rowKey = JSON.stringify(msg.row)
      const diff = parseInt(msg.mz_diff || `0`, 10)

      if (!rowCounts.has(rowKey)) {
        rowCounts.set(rowKey, { row: msg.row, count: 0 })
      }
      rowCounts.get(rowKey)!.count += diff
    })

    // Both rows should have count 0
    let positiveCountRows = 0
    for (const [_rowKey, data] of rowCounts.entries()) {
      if (data.count > 0) {
        positiveCountRows++
      }
      expect(data.count).toBe(0)
    }

    expect(positiveCountRows).toBe(0)
  })

  it(`should verify the timing issue with longer waits`, async () => {
    // Simulate the timing issue
    console.log(`Testing with different wait times...`)

    const shortWait = async (ms: number) => {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    // In the real app, we might need to wait longer for messages to arrive
    const waitTimes = [50, 100, 200, 500, 1000]

    for (const waitTime of waitTimes) {
      console.log(`  Waiting ${waitTime}ms...`)
      await shortWait(waitTime)
    }

    console.log(
      `  All waits completed - this simulates waiting for Materialize messages`
    )
    expect(true).toBe(true)
  })

  it(`should show what happens with immediate vs delayed processing`, () => {
    const messages = [
      { row: { id: 1, completed: false }, mz_diff: `1`, timestamp: 1000 },
      { row: { id: 1, completed: true }, mz_diff: `-1`, timestamp: 1000 },
    ]

    // Immediate processing (current buffering logic)
    console.log(`Immediate processing: Messages arrive within 50ms window`)
    const allSameTimestamp = messages.every(
      (m) => m.timestamp === messages[0]?.timestamp
    )
    expect(allSameTimestamp).toBe(true)

    // Delayed processing (might happen in real app)
    console.log(`Delayed processing: Messages arrive with different timestamps`)
    const delayedMessages = [
      { row: { id: 1, completed: false }, mz_diff: `1`, timestamp: 1000 },
      { row: { id: 1, completed: true }, mz_diff: `-1`, timestamp: 1050 }, // 50ms later
    ]

    const differentTimestamps =
      delayedMessages[0]?.timestamp !== delayedMessages[1]?.timestamp
    expect(differentTimestamps).toBe(true)

    console.log(`If messages have different timestamps, they won't be batched!`)
  })
})
