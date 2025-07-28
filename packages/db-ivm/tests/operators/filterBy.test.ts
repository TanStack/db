import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { filterBy, output } from "../../src/operators/index.js"
import type { KeyValue } from "../../src/types.js"

describe(`Operators`, () => {
  describe(`FilterBy operation`, () => {
    test(`filterBy operator exists`, () => {
      expect(typeof filterBy).toBe(`function`)
    })

    test(`filterBy basic test`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      // Use the filterBy operator
      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the main stream
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], 1],
        ])
      )

      // Send filter keys to the filter stream
      inputB.sendData(new MultiSet<KeyValue<number, boolean>>([[[1, true], 1]]))

      graph.run()

      // Check if we got the filtered result
      expect(messages).toHaveLength(1)
      expect(messages[0].getInner()).toEqual([[[1, `apple`], 1]])
    })

    test(`filterBy with empty filter stream`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the main stream
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], 1],
        ])
      )

      // Send empty filter data
      inputB.sendData(new MultiSet([]))

      graph.run()

      // No data messages should be returned since filter stream is empty
      expect(messages).toHaveLength(0)
    })

    test(`filterBy with multiple filter keys`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the main stream
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], 1],
          [[3, `cherry`], 1],
        ])
      )

      // Send filter keys
      inputB.sendData(
        new MultiSet<KeyValue<number, boolean>>([
          [[2, true], 1],
          [[3, false], 1], // Value doesn't matter, only key presence
        ])
      )

      graph.run()

      // Should get items with keys 2 and 3
      expect(messages).toHaveLength(1)
      const result = messages[0].getInner().sort((a, b) => a[0][0] - b[0][0])
      expect(result).toEqual([
        [[2, `banana`], 1],
        [[3, `cherry`], 1],
      ])
    })

    test(`filterBy with incremental updates`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send initial data
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], 1],
          [[3, `cherry`], 1],
          [[4, `date`], 1],
        ])
      )

      // Send initial filter keys
      inputB.sendData(
        new MultiSet<KeyValue<number, boolean>>([
          [[1, true], 1],
          [[3, true], 1],
        ])
      )

      graph.run()

      // Should get items with keys 1 and 3
      expect(messages).toHaveLength(1)
      let result = messages[0].getInner().sort((a, b) => a[0][0] - b[0][0])
      expect(result).toEqual([
        [[1, `apple`], 1],
        [[3, `cherry`], 1],
      ])

      // Now update the filter stream with new keys
      inputB.sendData(
        new MultiSet<KeyValue<number, boolean>>([
          [[2, true], 1],
          [[4, true], 1],
        ])
      )

      graph.run()

      // Should get new items with keys 2 and 4
      expect(messages).toHaveLength(2)
      result = messages[1].getInner().sort((a, b) => a[0][0] - b[0][0])
      expect(result).toEqual([
        [[2, `banana`], 1],
        [[4, `date`], 1],
      ])
    })

    test(`filterBy with negative multiplicities`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data to the main stream with negative multiplicity
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], -1],
          [[3, `cherry`], 1],
        ])
      )

      // Send filter keys
      inputB.sendData(
        new MultiSet<KeyValue<number, boolean>>([
          [[1, true], 1],
          [[2, true], 1],
          [[3, true], 1],
        ])
      )

      graph.run()

      // Should get filtered results with proper multiplicities
      expect(messages).toHaveLength(1)
      const result = messages[0].getInner().sort((a, b) => a[0][0] - b[0][0])
      expect(result).toEqual([
        [[1, `apple`], 1],
        [[2, `banana`], -1],
        [[3, `cherry`], 1],
      ])
    })

    test(`filterBy with data arriving before filter keys`, () => {
      const graph = new D2()
      const inputA = graph.newInput<KeyValue<number, string>>()
      const inputB = graph.newInput<KeyValue<number, boolean>>()
      const messages: Array<MultiSet<KeyValue<number, string>>> = []

      inputA.pipe(
        filterBy(inputB),
        output((message) => {
          messages.push(message)
        })
      )

      graph.finalize()

      // Send data first
      inputA.sendData(
        new MultiSet<KeyValue<number, string>>([
          [[1, `apple`], 1],
          [[2, `banana`], 1],
          [[3, `cherry`], 1],
        ])
      )

      graph.run()

      // No messages yet because no filter keys
      expect(messages).toHaveLength(0)

      // Now send filter keys
      inputB.sendData(
        new MultiSet<KeyValue<number, boolean>>([
          [[2, true], 1],
          [[3, false], 1],
        ])
      )

      graph.run()

      // Now should get filtered results
      expect(messages).toHaveLength(1)
      const result = messages[0].getInner().sort((a, b) => a[0][0] - b[0][0])
      expect(result).toEqual([
        [[2, `banana`], 1],
        [[3, `cherry`], 1],
      ])
    })
  })
})
