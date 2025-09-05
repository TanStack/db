import { describe, expect, test } from "vitest"
import { D2 } from "../../src/d2.js"
import { MultiSet } from "../../src/multiset.js"
import { distinct } from "../../src/operators/distinct.js"
import { output } from "../../src/operators/output.js"
import { filter } from "../../src/operators/filter.js"
import { map } from "../../src/operators/map.js"
import { groupBy, sum } from "../../src/operators/groupBy.js"
import { MessageTracker, assertResults } from "../test-utils.js"

describe(`Operators`, () => {
  describe(`Efficient distinct operation`, () => {
    testDistinct()
  })

  describe(`Distinct with other operators`, () => {
    testDistinctWithOtherOperators()
  })
})

function testDistinct() {
  test(`basic distinct operation`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const messages: Array<MultiSet<[number, string]>> = []

    input.pipe(
      distinct(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, `a`], 2],
        [[2, `b`], 1],
        [[2, `c`], 2],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [[1, `a`], 1],
        [[2, `b`], 1],
        [[2, `c`], 1],
      ],
    ])
  })

  test(`distinct by certain property`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, { name: string; country: string }]>()
    const messages: Array<
      MultiSet<[number, { name: string; country: string }]>
    > = []

    input.pipe(
      distinct(([_, value]) => value.country),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[1, { name: `Valter`, country: `Portugal` }], 1],
        [[2, { name: `Sam`, country: `UK` }], 1],
        [[2, { name: `Kevin`, country: `Belgium` }], 1],
        [[3, { name: `Garry`, country: `UK` }], 1],
        [[4, { name: `Kyle`, country: `USA` }], 1],
      ])
    )

    graph.run()

    const data = messages.map((m) => m.getInner())[0]
    const countries = data
      .map(([[_, value], multiplicity]) => [value.country, multiplicity])
      .sort()

    expect(countries).toEqual(
      [
        [`Belgium`, 1],
        [`Portugal`, 1],
        [`UK`, 1],
        [`USA`, 1],
      ].sort()
    )
  })

  test(`distinct with updates`, () => {
    const graph = new D2()
    const input = graph.newInput<[number, string]>()
    const tracker = new MessageTracker<[number, string]>()

    input.pipe(
      distinct(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    // Initial batch
    input.sendData(
      new MultiSet([
        [[1, `a`], 1],
        [[1, `b`], 1],
        [[1, `a`], 1], // Duplicate, should only result in 1
      ])
    )
    graph.run()

    const initialResult = tracker.getResult()
    assertResults(
      `distinct with updates - initial`,
      initialResult,
      [
        [1, `a`],
        [1, `b`],
      ], // Should have both distinct values
      4 // Max expected messages
    )

    tracker.reset()

    // Second batch - remove some, add new
    input.sendData(
      new MultiSet([
        [[1, `b`], -1], // Remove 'b'
        [[1, `c`], 2], // Add 'c' (multiplicity should be capped at 1)
        [[1, `a`], -1], // Remove 'a'
      ])
    )
    graph.run()

    const secondResult = tracker.getResult()
    assertResults(
      `distinct with updates - second batch`,
      secondResult,
      [[1, `c`]], // Should only have 'c' remaining
      4 // Max expected messages
    )

    tracker.reset()

    // Third batch - remove remaining
    input.sendData(new MultiSet([[[1, `c`], -2]]))
    graph.run()

    const thirdResult = tracker.getResult()
    assertResults(
      `distinct with updates - third batch`,
      thirdResult,
      [], // Should have no remaining distinct values
      2 // Max expected messages
    )
  })

  test(`distinct with multiple batches of same key`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, number]>()
    const messages: Array<MultiSet<[string, number]>> = []

    input.pipe(
      distinct(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[`key1`, 1], 2],
        [[`key1`, 2], 3],
        [[`key2`, 1], 1],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    expect(data).toEqual([
      [
        [[`key1`, 1], 1],
        [[`key1`, 2], 1],
        [[`key2`, 1], 1],
      ],
    ])
  })

  test(`distinct with multiple batches of same key that cancel out`, () => {
    const graph = new D2()
    const input = graph.newInput<[string, number]>()
    const tracker = new MessageTracker<[string, number]>()

    input.pipe(
      distinct(),
      output((message) => {
        tracker.addMessage(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [[`key1`, 1], 2], // Add ['key1', 1] with multiplicity 2 -> should become 1 (distinct)
        [[`key1`, 2], 2], // Add ['key1', 2] with multiplicity 2 -> should become 1 (distinct)
        [[`key1`, 2], 1], // Add more ['key1', 2] with multiplicity 1 -> total 3, still 1 in distinct
        [[`key2`, 1], 1], // Add ['key2', 1] with multiplicity 1 -> should become 1 (distinct)
        [[`key1`, 2], -3], // Remove all ['key1', 2] (total was 3) -> should be removed from distinct
        [[`key2`, 1], 1], // Add more ['key2', 1] -> still 1 in distinct
      ])
    )
    graph.run()

    const result = tracker.getResult()
    assertResults(
      `distinct with multiple batches that cancel out`,
      result,
      [
        [`key1`, 1], // Should remain (multiplicity 2 -> 1 in distinct)
        [`key2`, 1], // Should remain (multiplicity 2 -> 1 in distinct)
      ],
      6 // Max expected messages (generous upper bound)
    )
  })
}

function testDistinctWithOtherOperators() {
  test(`distinct with filter - should apply distinct after filtering`, () => {
    const graph = new D2()
    const input = graph.newInput<{
      id: number
      category: string
      value: number
    }>()
    const messages: Array<
      MultiSet<{ id: number; category: string; value: number }>
    > = []

    input.pipe(
      filter((item) => item.value > 10),
      distinct((item) => item.category),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [{ id: 1, category: `A`, value: 5 }, 1], // Should be filtered out
        [{ id: 2, category: `A`, value: 15 }, 1], // Should pass through
        [{ id: 3, category: `B`, value: 20 }, 1], // Should pass through
        [{ id: 4, category: `A`, value: 25 }, 1], // Should be filtered by distinct (category A already seen)
        [{ id: 5, category: `C`, value: 8 }, 1], // Should be filtered out by value
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())
    // Since distinct keeps the last seen item for each category, we expect id: 4 for category A
    expect(data).toEqual([
      [
        [{ id: 4, category: `A`, value: 25 }, 1],
        [{ id: 3, category: `B`, value: 20 }, 1],
      ],
    ])
  })

  test(`distinct with map - should apply distinct after mapping`, () => {
    const graph = new D2()
    const input = graph.newInput<{ id: number; name: string }>()
    const messages: Array<MultiSet<string>> = []

    input.pipe(
      map((item) => item.name.toLowerCase()),
      distinct(),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [{ id: 1, name: `Alice` }, 1],
        [{ id: 2, name: `ALICE` }, 1], // Should be distinct after mapping to lowercase
        [{ id: 3, name: `Bob` }, 1],
        [{ id: 4, name: `alice` }, 1], // Should be filtered by distinct
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())
    expect(data).toEqual([
      [
        [`alice`, 1],
        [`bob`, 1],
      ],
    ])
  })

  test(`distinct with groupBy - should work with aggregated data`, () => {
    const graph = new D2()
    const input = graph.newInput<{ category: string; amount: number }>()
    const messages: Array<
      MultiSet<[string, { category: string; total: number }]>
    > = []

    input.pipe(
      groupBy((data) => ({ category: data.category }), {
        total: sum((data) => data.amount),
      }),
      distinct(([_, value]) => Math.floor(value.total / 100)), // Distinct by total rounded to hundreds
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [{ category: `A`, amount: 100 }, 1],
        [{ category: `A`, amount: 50 }, 1], // Total for A = 150
        [{ category: `B`, amount: 180 }, 1], // Total for B = 180, same hundred as A
        [{ category: `C`, amount: 250 }, 1], // Total for C = 250, different hundred
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    // Should have 2 distinct items: one for 100s range and one for 200s range
    expect(data[0]).toHaveLength(2)

    const totals = data[0].map(([key, _multiplicity]) => {
      // Key is [jsonString, aggregatedObject], we want the aggregatedObject
      const [_jsonKey, aggregatedValue] = key
      return Math.floor(aggregatedValue.total / 100)
    })
    expect(totals).toContain(1) // 100s range
    expect(totals).toContain(2) // 200s range
  })

  test(`distinct with orderBy - simpler test case`, () => {
    const graph = new D2()
    const input = graph.newInput<{
      id: number
      category: string
      priority: number
    }>()
    const messages: Array<
      MultiSet<{ id: number; category: string; priority: number }>
    > = []

    input.pipe(
      distinct((item) => item.category),
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [{ id: 1, category: `A`, priority: 1 }, 1],
        [{ id: 2, category: `B`, priority: 3 }, 1],
        [{ id: 3, category: `A`, priority: 2 }, 1], // Should be filtered by distinct
        [{ id: 4, category: `C`, priority: 2 }, 1],
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    // Should have 3 distinct categories
    expect(data[0]).toHaveLength(3)

    const categories = data[0].map(([item]) => item.category).sort()
    expect(categories).toEqual([`A`, `B`, `C`])
  })

  test(`complex pipeline: filter -> map -> distinct`, () => {
    const graph = new D2()
    const input = graph.newInput<{ id: number; name: string; score: number }>()
    const messages: Array<
      MultiSet<{ id: number; name: string; score: number; grade: string }>
    > = []

    input.pipe(
      filter((item) => item.score >= 60), // Only passing scores
      map((item) => ({
        ...item,
        grade: item.score >= 90 ? `A` : item.score >= 80 ? `B` : `C`,
      })),
      distinct((item) => `${item.name}-${item.grade}`), // Distinct by name-grade combination
      output((message) => {
        messages.push(message)
      })
    )

    graph.finalize()

    input.sendData(
      new MultiSet([
        [{ id: 1, name: `Alice`, score: 95 }, 1], // A grade
        [{ id: 2, name: `Alice`, score: 95 }, 1], // Should be distinct filtered (same name-grade)
        [{ id: 3, name: `Bob`, score: 85 }, 1], // B grade
        [{ id: 4, name: `Charlie`, score: 75 }, 1], // C grade
        [{ id: 5, name: `David`, score: 50 }, 1], // Should be filtered out by score
        [{ id: 6, name: `Eve`, score: 65 }, 1], // C grade
      ])
    )
    graph.run()

    const data = messages.map((m) => m.getInner())

    // Should have 4 distinct items: Alice-A, Bob-B, Charlie-C, Eve-C
    expect(data[0]).toHaveLength(4)

    const nameGradeCombos = data[0]
      .map(([item]) => `${item.name}-${item.grade}`)
      .sort()
    expect(nameGradeCombos).toEqual([`Alice-A`, `Bob-B`, `Charlie-C`, `Eve-C`])
  })
}
