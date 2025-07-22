import { describe, expect, it } from "vitest"

describe(`Differential Merging Unit Tests`, () => {
  it(`should correctly handle the unchecking scenario`, () => {
    // Simulate the exact messages we get when unchecking a todo
    const messages = [
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      // Duplicate operations
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: false },
        mz_timestamp: 3000,
        mz_diff: `1`,
      },
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
      {
        type: `data` as const,
        row: { id: 1, text: `Todo`, completed: true },
        mz_timestamp: 3000,
        mz_diff: `-1`,
      },
    ]

    // Mock the merging logic
    const writtenOperations: Array<any> = []
    const collection = new Map([[1, { id: 1, text: `Todo`, completed: true }]])

    // Process messages like our merging logic does
    const messagesByKey = new Map<any, Array<any>>()
    const getKey = (item: any) => item.id

    messages.forEach((msg) => {
      // eslint-disable-next-line
      if (msg.type === `data` && msg.row) {
        const key = getKey(msg.row)
        if (!messagesByKey.has(key)) {
          messagesByKey.set(key, [])
        }
        messagesByKey.get(key)!.push(msg)
      }
    })

    messagesByKey.forEach((keyMessages, key) => {
      // Sum all mz_diff values
      const totalDiff = keyMessages.reduce((sum, msg) => {
        return sum + parseInt(msg.mz_diff || `0`, 10)
      }, 0)

      // Separate inserts and deletes
      const inserts = keyMessages.filter(
        (msg) => parseInt(msg.mz_diff || `0`, 10) > 0
      )
      const deletes = keyMessages.filter(
        (msg) => parseInt(msg.mz_diff || `0`, 10) < 0
      )

      const hasInserts = inserts.length > 0
      const hasDeletes = deletes.length > 0
      const isUpdate = hasInserts && hasDeletes

      console.log({
        key,
        totalDiff,
        inserts: inserts.length,
        deletes: deletes.length,
        isUpdate,
      })

      if (isUpdate) {
        // This is an update - use the insert value
        const latestInsert = inserts[inserts.length - 1]
        writtenOperations.push({
          type: `update`,
          value: latestInsert.row,
        })
      } else if (totalDiff > 0) {
        // Net positive - insert
        const latestInsert = inserts[inserts.length - 1]
        writtenOperations.push({
          type: collection.has(key) ? `update` : `insert`,
          value: latestInsert.row,
        })
      } else if (totalDiff < 0) {
        // Net negative - delete
        const messageForDelete = deletes[0]
        writtenOperations.push({
          type: `delete`,
          value: messageForDelete.row,
        })
      }
    })

    // Verify the result
    expect(writtenOperations).toHaveLength(1)
    expect(writtenOperations[0]).toEqual({
      type: `update`,
      value: { id: 1, text: `Todo`, completed: false },
    })
  })

  it(`should handle simple insert without merging`, () => {
    const messages = [
      {
        type: `data` as const,
        row: { id: 1, text: `New Todo`, completed: false },
        mz_timestamp: 1000,
        mz_diff: `1`,
      },
    ]

    const writtenOperations: Array<any> = []

    // Process single message
    const totalDiff = 1
    const isUpdate = false

    // eslint-disable-next-line
    if (!isUpdate && totalDiff > 0) {
      writtenOperations.push({
        type: `insert`,
        value: messages[0]?.row,
      })
    }

    expect(writtenOperations).toHaveLength(1)
    expect(writtenOperations[0]).toEqual({
      type: `insert`,
      value: { id: 1, text: `New Todo`, completed: false },
    })
  })

  it(`should show why without merging the todo gets deleted`, () => {
    // Without merging, messages are processed one by one
    const messages = [
      { id: 1, completed: false, diff: 1 }, // Insert new
      { id: 1, completed: true, diff: -1 }, // Delete old
      { id: 1, completed: false, diff: 1 }, // Insert new again
      { id: 1, completed: true, diff: -1 }, // Delete old again
      { id: 1, completed: true, diff: -1 }, // Delete old again
      { id: 1, completed: true, diff: -1 }, // Delete old again (LAST!)
    ]

    let item: any = { id: 1, completed: true }

    console.log(`Processing without merging:`)
    messages.forEach((msg, i) => {
      console.log(
        `  Message ${i}: ${msg.diff > 0 ? `INSERT` : `DELETE`} completed=${msg.completed}`
      )

      if (msg.diff > 0) {
        item = { id: msg.id, completed: msg.completed }
      } else if (msg.diff < 0) {
        // In a naive implementation, this might delete the item
        // But we're comparing by key only, so any delete removes the item
        item = null
      }

      console.log(
        `    Result: item = ${item ? JSON.stringify(item) : `DELETED`}`
      )
    })

    // The last operation is a delete, so the item is gone!
    expect(item).toBeNull()
  })
})
