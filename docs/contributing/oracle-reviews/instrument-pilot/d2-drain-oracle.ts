/**
 * A finalized finite D2 pipeline must deliver all queued messages before run()
 * returns, even when registration order opposes dataflow. The existing
 * d2-work-oracle.test.ts establishes this for a reversed pair. The package
 * README promises processing after run(); graph.test.ts establishes independent
 * delivery to multiple readers. Map and concat preserve the message streams.
 * This witness extends those established promises to one five-operator DAG.
 *
 * Limits: synchronous, total built-in map/concat/output operators, two bounded
 * numeric values, and no graph mutation, exceptions, cycles or callback reentry.
 * We do not prescribe inter-branch callback order, scheduler passes, elapsed
 * time, arbitrary DAGs, or client publication. This is bounded enumeration,
 * not a generated property or a proof of universal termination.
 */
import assert from 'node:assert/strict'
import { D2 } from '../../../../packages/db-ivm/src/d2.ts'
import { DifferenceStreamWriter } from '../../../../packages/db-ivm/src/graph.ts'
import { MapOperator } from '../../../../packages/db-ivm/src/operators/map.ts'
import { ConcatOperator } from '../../../../packages/db-ivm/src/operators/concat.ts'
import { OutputOperator } from '../../../../packages/db-ivm/src/operators/output.ts'

type Message = Array<[number, number]>
type Schedule = 'production' | 'two-pass' | 'topological-once'

// The model directly substitutes two arithmetic expressions for each source
// message. It has no operator queue, readiness classifier, or execution loop.
// Message is a recorder term for MultiSet.getInner(), not a Collection change
// message. Message order is outside this comparison; duplicates remain.
function expectedMessages(messages: Array<Message>): Array<Message> {
  return messages.flatMap((message) => [
    message.map(([value, weight]): [number, number] => [value + 100, weight]),
    message.map(([value, weight]): [number, number] => [value + 11, weight]),
  ])
}
function canonical(messages: Array<Message>): Array<string> {
  return messages.map((message) => JSON.stringify(message)).sort()
}
function compare(
  actual: Array<Message>,
  expected: Array<Message>,
  checkpoint: string,
): void {
  assert.deepEqual(canonical(actual), canonical(expected), checkpoint)
}
function permutations(values: Array<number>): Array<Array<number>> {
  if (values.length === 0) return [[]]
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map(
      (rest) => [value, ...rest],
    ),
  )
}

// Production driver: one source broadcasts into short and long map paths,
// which reconverge at concat and then invoke the real OutputOperator callback.
// Readers exist before sends. Only registration order varies; all 120 orders
// contain each operator once. A missing/duplicate registration is excluded.
function fixture(order: Array<number>) {
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4])
  const graph = new D2()
  const input = graph.newInput<number>()
  const short = new DifferenceStreamWriter<number>()
  const longStart = new DifferenceStreamWriter<number>()
  const longEnd = new DifferenceStreamWriter<number>()
  const merged = new DifferenceStreamWriter<number>()
  const output = new DifferenceStreamWriter<number>()
  const observed: Array<Message> = []
  const operators = [
    new MapOperator(
      graph.getNextOperatorId(),
      input.connectReader(),
      short,
      (value: number) => value + 100,
    ),
    new MapOperator(
      graph.getNextOperatorId(),
      input.connectReader(),
      longStart,
      (value: number) => value + 10,
    ),
    new MapOperator(
      graph.getNextOperatorId(),
      longStart.newReader(),
      longEnd,
      (value: number) => value + 1,
    ),
    new ConcatOperator<number, number>(
      graph.getNextOperatorId(),
      short.newReader(),
      longEnd.newReader(),
      merged,
    ),
    new OutputOperator(
      graph.getNextOperatorId(),
      merged.newReader(),
      output,
      (message) => {
        observed.push(
          message.getInner().map(([value, weight]) => [value, weight]),
        )
      },
    ),
  ]
  for (const index of order) graph.addOperator(operators[index]!)
  graph.finalize()
  return { graph, input, observed, operators, order }
}

function execute(f: ReturnType<typeof fixture>, schedule: Schedule): void {
  if (schedule === 'production') {
    f.graph.run()
    return
  }
  // Calibration only: neither alternative changes production. The wrong
  // two-pass scheduler satisfies the existing reversed-pair example but not
  // all longer paths. The valid topological scheduler tests model freedom.
  const order = schedule === 'two-pass' ? f.order : [0, 1, 2, 3, 4]
  const passes = schedule === 'two-pass' ? 2 : 1
  for (let pass = 0; pass < passes; pass++) {
    for (const index of order) {
      const operator = f.operators[index]!
      if (operator.hasPendingWork()) operator.run()
    }
  }
}

// Every history starts idle, queues two messages, reruns idle, then retracts
// and reinserts a value before a final idle run. Retained source multiplicities
// stay nonnegative. Multiple messages expose omission/duplication; the second
// active run exposes stale input replay. Negative-only initial state is excluded.
const history: Array<Array<Message>> = [
  [],
  [[[2, 1]], [[3, 2]]],
  [],
  [[[2, -1]], [[3, -2]], [[2, 1]]],
  [],
]
let comparisons = 0
function exercise(order: Array<number>, schedule: Schedule): void {
  const f = fixture(order)
  for (const [turn, messages] of history.entries()) {
    f.observed.length = 0
    for (const message of messages)
      f.input.sendData(message.map(([value, weight]) => [value, weight]))
    execute(f, schedule)
    // Check only after the chosen run boundary; callbacks merely record facts.
    // Value comparison precedes pendingWork so a wrong scheduler must reach
    // the promised observable checkpoint, not merely fail an internal check.
    compare(
      f.observed,
      expectedMessages(messages),
      `${schedule}: order=${order}; turn=${turn}`,
    )
    assert.equal(
      f.graph.pendingWork(),
      false,
      `pending work after turn ${turn}`,
    )
    comparisons++
  }
}

const orders = permutations([0, 1, 2, 3, 4])
assert.equal(orders.length, 120)
assert.equal(new Set(orders.map(String)).size, 120)
assert.throws(() => fixture([0, 1, 2, 3, 3]), { code: 'ERR_ASSERTION' })
for (const order of orders) exercise(order, 'production')
console.log(
  `PASS production: ${orders.length} orders x ${history.length} run checkpoints = ${comparisons}`,
)
for (const order of orders) exercise(order, 'topological-once')
console.log(
  'PASS legal alternative: all 120 orders permit one topological pass',
)

assert.throws(
  () => exercise([4, 3, 2, 1, 0], 'two-pass'),
  (error: unknown) => {
    if (!(error instanceof assert.AssertionError)) throw error
    assert.match(error.message, /two-pass: order=4,3,2,1,0; turn=1/)
    console.log(`KILLED two-pass at output comparison: ${error.message}`)
    return true
  },
  'two-pass wrong scheduler must fail the output law',
)
console.log(
  'Production files were not modified; calibration schedulers live only in this scratch driver.',
)
