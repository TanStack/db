import { fc } from '@fast-check/vitest'
import { D2 } from '../src/d2.js'
import { MultiSet } from '../src/multiset.js'
import { output } from '../src/operators/output.js'
import type { IStreamBuilder } from '../src/types.js'
import type { Arbitrary } from 'fast-check'

/**
 * # How does the checker judge an incremental operator?
 *
 * A relation is a set of values with signed integer weights. A positive weight
 * adds copies. A negative weight removes copies. For a query `Q`, a change from
 * state `x` to state `y` must emit the weighted difference `Q(y) - Q(x)`.
 *
 * The caller supplies two independent parts:
 *
 * 1. `build` constructs the production D2 graph.
 * 2. `evaluate` computes the complete expected relation from plain data.
 *
 * The checker applies each logical batch in two ways. The atomic run delivers
 * the batch in one graph step. The split run delivers the same change as legal
 * one-row steps. After each logical batch, both runs must satisfy three laws:
 *
 * 1. The emitted delta equals the difference between full recomputations.
 * 2. The retained output equals the new full recomputation.
 * 3. Atomic and split delivery end with the same retained output.
 *
 * Split delivery does not invent invalid intermediate input states. It orders
 * unit changes so weights stay nonnegative. A caller can also declare a unique
 * row key so a replacement retracts the occupied row before it inserts a new
 * row with the same key.
 */

export type Weighted<T> = Array<[T, number]>

type StateEntry<T> = { value: T; weight: number }
type State<T> = Map<string, StateEntry<T>>

export interface LawValuePolicy<T> {
  identity: (value: T) => string
  clone: (value: T) => T
}

/**
 * Policy for JSON-shaped law values whose JSON encoding is the contract's
 * relation identity. Callers with NaN, infinities, undefined, symbols, or an
 * identity that ignores object-property order must provide a different policy.
 */
export function jsonLawValuePolicy<T>(): LawValuePolicy<T> {
  return {
    identity: (value) => `${typeof value}:${JSON.stringify(value)}`,
    clone: (value) => structuredClone(value),
  }
}

export interface SplitDeliveryDomain<T> {
  /**
   * Identifies a slot that may contain at most one distinct relation value.
   * Omit this for ordinary Z-set inputs where several values may share a key.
   */
  uniqueKey?: (value: T) => string
}

export interface IncrementalizationReach {
  atomicCheckpoints: number
  atomicDeliveries: number
  splitCheckpoints: number
  splitDeliveries: number
}

export function weightedStateArbitrary<T>(
  value: Arbitrary<T>,
  options: { maxLength?: number; maxWeight?: number } = {},
): Arbitrary<Weighted<T>> {
  return fc.array(
    fc.tuple(value, fc.integer({ min: 1, max: options.maxWeight ?? 2 })),
    { maxLength: options.maxLength ?? 8 },
  )
}

export interface UnaryIncrementalizationLaw<Input, Output> {
  name: string
  initial: Weighted<Input>
  batches: Array<Weighted<Input>>
  inputPolicy: LawValuePolicy<Input>
  outputPolicy: LawValuePolicy<Output>
  splitDomain?: SplitDeliveryDomain<Input>
  build: (input: IStreamBuilder<Input>) => IStreamBuilder<Output>
  evaluate: (input: Weighted<Input>) => Weighted<Output>
}

export interface BinaryIncrementalizationLaw<Left, Right, Output> {
  name: string
  initialLeft: Weighted<Left>
  initialRight: Weighted<Right>
  batches: Array<{ left: Weighted<Left>; right: Weighted<Right> }>
  leftPolicy: LawValuePolicy<Left>
  rightPolicy: LawValuePolicy<Right>
  outputPolicy: LawValuePolicy<Output>
  leftSplitDomain?: SplitDeliveryDomain<Left>
  rightSplitDomain?: SplitDeliveryDomain<Right>
  build: (
    left: IStreamBuilder<Left>,
    right: IStreamBuilder<Right>,
  ) => IStreamBuilder<Output>
  evaluate: (left: Weighted<Left>, right: Weighted<Right>) => Weighted<Output>
}

function addBatch<T>(
  state: State<T>,
  batch: Weighted<T>,
  law: string,
  policy: LawValuePolicy<T>,
): void {
  const consolidated: State<T> = new Map()
  for (const [value, delta] of batch) {
    if (!Number.isInteger(delta)) {
      throw new Error(`${law}: weights must be integers`)
    }
    const key = policy.identity(value)
    const weight = (consolidated.get(key)?.weight ?? 0) + delta
    if (weight === 0) consolidated.delete(key)
    else consolidated.set(key, { value, weight })
  }

  for (const [key, { value, weight }] of consolidated) {
    const nextWeight = (state.get(key)?.weight ?? 0) + weight
    if (nextWeight < 0) {
      throw new Error(`${law}: generated an illegal negative input state`)
    }
    if (nextWeight === 0) state.delete(key)
    else state.set(key, { value: policy.clone(value), weight: nextWeight })
  }
}

function addOutput<T>(
  state: State<T>,
  batch: Weighted<T>,
  policy: LawValuePolicy<T>,
): void {
  for (const [value, delta] of batch) {
    const key = policy.identity(value)
    const nextWeight = (state.get(key)?.weight ?? 0) + delta
    if (nextWeight === 0) state.delete(key)
    else state.set(key, { value: policy.clone(value), weight: nextWeight })
  }
}

function fromWeighted<T>(
  values: Weighted<T>,
  policy: LawValuePolicy<T>,
): State<T> {
  const state: State<T> = new Map()
  addOutput(state, values, policy)
  return state
}

function asWeighted<T>(state: State<T>): Weighted<T> {
  return [...state.values()].map(({ value, weight }) => [value, weight])
}

function normalized<T>(state: State<T>): Array<[string, number]> {
  return [...state.entries()]
    .map(([key, { weight }]) => [key, weight] as [string, number])
    .sort(([left], [right]) => left.localeCompare(right))
}

function difference<T>(
  before: Weighted<T>,
  after: Weighted<T>,
  policy: LawValuePolicy<T>,
): State<T> {
  const result = fromWeighted(after, policy)
  addOutput(
    result,
    before.map(([value, weight]) => [value, -weight]),
    policy,
  )
  return result
}

export function weightedDifference<T>(
  before: Weighted<T>,
  after: Weighted<T>,
  policy: LawValuePolicy<T>,
  cancellationValue?: T,
): Weighted<T> {
  const result = asWeighted(difference(before, after, policy))
  if (cancellationValue !== undefined) {
    result.push([cancellationValue, -1], [cancellationValue, 1])
  }
  return result
}

export function weightedTransitions<T>(
  states: Array<Weighted<T>>,
  policy: LawValuePolicy<T>,
  cancellationValue?: T,
): Array<Weighted<T>> {
  return states
    .slice(1)
    .map((next, index) =>
      weightedDifference(states[index]!, next, policy, cancellationValue),
    )
}

function assertEqual<T>(
  law: string,
  checkpoint: number,
  kind: string,
  actual: State<T>,
  expected: State<T>,
): void {
  const actualRows = normalized(actual)
  const expectedRows = normalized(expected)
  if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
    throw new Error(
      `${law}: ${kind} diverged at checkpoint ${checkpoint}\n` +
        `expected ${JSON.stringify(expectedRows)}\n` +
        `actual   ${JSON.stringify(actualRows)}`,
    )
  }
}

function validUnitPartitions<T>(
  state: State<T>,
  batch: Weighted<T>,
  law: string,
  policy: LawValuePolicy<T>,
  domain: SplitDeliveryDomain<T> | undefined,
): Array<Weighted<T>> {
  let validation = new Map(
    [...state].map(([key, { value, weight }]) => [
      key,
      { value: policy.clone(value), weight },
    ]),
  )

  const assertDomain = (candidate: State<T>): void => {
    if (!domain?.uniqueKey) return
    const occupied = new Set<string>()
    for (const { value, weight } of candidate.values()) {
      if (weight <= 0) continue
      const key = domain.uniqueKey(value)
      if (occupied.has(key)) {
        throw new Error(
          `${law}: split delivery violates unique input key ${key}`,
        )
      }
      occupied.add(key)
    }
  }

  assertDomain(validation)
  const pending = batch.map(
    ([value, weight]) => [policy.clone(value), weight] as [T, number],
  )
  const deliveries: Array<Weighted<T>> = []

  while (pending.length > 0) {
    let selected = -1
    let nextValidation: State<T> | undefined
    for (let index = 0; index < pending.length; index++) {
      const candidate = new Map(
        [...validation].map(([key, { value, weight }]) => [
          key,
          { value: policy.clone(value), weight },
        ]),
      )
      try {
        addBatch(candidate, [pending[index]!], law, policy)
        assertDomain(candidate)
        selected = index
        nextValidation = candidate
        break
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes(
            `generated an illegal negative input state`,
          ) ||
            error.message.includes(`split delivery violates unique input key`))
        ) {
          // This unit is not a legal prefix. Another unit may make it legal.
          continue
        }
        throw error
      }
    }
    if (selected < 0 || !nextValidation) {
      throw new Error(
        `${law}: batch has no unit ordering with legal split-delivery prefixes`,
      )
    }
    const [delivery] = pending.splice(selected, 1)
    deliveries.push([delivery!])
    validation = nextValidation
  }

  return deliveries
}

interface RunResult<T> {
  output: State<T>
  checkpoints: number
  deliveries: number
}

function runUnary<Input, Output>(
  law: UnaryIncrementalizationLaw<Input, Output>,
  partition: boolean,
): RunResult<Output> {
  const graph = new D2()
  const input = graph.newInput<Input>()
  const emitted: Weighted<Output> = []
  law
    .build(input)
    .pipe(output((message) => emitted.push(...message.getInner())))
  graph.finalize()

  const inputState: State<Input> = new Map()
  const outputState: State<Output> = new Map()
  let deliveriesCount = 0
  const logicalBatches = [law.initial, ...law.batches]
  logicalBatches.forEach((batch, checkpoint) => {
    const before = law.evaluate(asWeighted(inputState))
    const deliveries = partition
      ? validUnitPartitions(
          inputState,
          batch,
          law.name,
          law.inputPolicy,
          law.splitDomain,
        )
      : [batch]
    addBatch(inputState, batch, law.name, law.inputPolicy)
    const after = law.evaluate(asWeighted(inputState))
    const expectedDelta = difference(before, after, law.outputPolicy)
    emitted.length = 0

    for (const delivery of deliveries) {
      input.sendData(new MultiSet(delivery))
      graph.run()
      deliveriesCount++
    }

    const actualDelta = fromWeighted(emitted, law.outputPolicy)
    assertEqual(
      law.name,
      checkpoint,
      `output delta`,
      actualDelta,
      expectedDelta,
    )
    addOutput(outputState, emitted, law.outputPolicy)
    assertEqual(
      law.name,
      checkpoint,
      `materialized output`,
      outputState,
      fromWeighted(after, law.outputPolicy),
    )
  })
  return {
    output: outputState,
    checkpoints: logicalBatches.length,
    deliveries: deliveriesCount,
  }
}

export function assertUnaryIncrementalization<Input, Output>(
  law: UnaryIncrementalizationLaw<Input, Output>,
): IncrementalizationReach {
  const atomic = runUnary(law, false)
  const split = runUnary(law, true)
  assertEqual(
    law.name,
    law.batches.length,
    `partitioned output`,
    split.output,
    atomic.output,
  )
  return {
    atomicCheckpoints: atomic.checkpoints,
    atomicDeliveries: atomic.deliveries,
    splitCheckpoints: split.checkpoints,
    splitDeliveries: split.deliveries,
  }
}

function runBinary<Left, Right, Output>(
  law: BinaryIncrementalizationLaw<Left, Right, Output>,
  partition: boolean,
): RunResult<Output> {
  const graph = new D2()
  const left = graph.newInput<Left>()
  const right = graph.newInput<Right>()
  const emitted: Weighted<Output> = []
  law
    .build(left, right)
    .pipe(output((message) => emitted.push(...message.getInner())))
  graph.finalize()

  const leftState: State<Left> = new Map()
  const rightState: State<Right> = new Map()
  const outputState: State<Output> = new Map()
  let deliveriesCount = 0
  const logicalBatches = [
    { left: law.initialLeft, right: law.initialRight },
    ...law.batches,
  ]

  logicalBatches.forEach((batch, checkpoint) => {
    const before = law.evaluate(asWeighted(leftState), asWeighted(rightState))
    const leftDeliveries = partition
      ? validUnitPartitions(
          leftState,
          batch.left,
          law.name,
          law.leftPolicy,
          law.leftSplitDomain,
        )
      : [batch.left]
    const rightDeliveries = partition
      ? validUnitPartitions(
          rightState,
          batch.right,
          law.name,
          law.rightPolicy,
          law.rightSplitDomain,
        )
      : [batch.right]
    addBatch(leftState, batch.left, law.name, law.leftPolicy)
    addBatch(rightState, batch.right, law.name, law.rightPolicy)
    const after = law.evaluate(asWeighted(leftState), asWeighted(rightState))
    const expectedDelta = difference(before, after, law.outputPolicy)
    emitted.length = 0

    if (partition) {
      for (const delivery of leftDeliveries) {
        left.sendData(new MultiSet(delivery))
        graph.run()
        deliveriesCount++
      }
      for (const delivery of rightDeliveries) {
        right.sendData(new MultiSet(delivery))
        graph.run()
        deliveriesCount++
      }
    } else {
      left.sendData(new MultiSet(batch.left))
      right.sendData(new MultiSet(batch.right))
      graph.run()
      deliveriesCount++
    }

    const actualDelta = fromWeighted(emitted, law.outputPolicy)
    assertEqual(
      law.name,
      checkpoint,
      `output delta`,
      actualDelta,
      expectedDelta,
    )
    addOutput(outputState, emitted, law.outputPolicy)
    assertEqual(
      law.name,
      checkpoint,
      `materialized output`,
      outputState,
      fromWeighted(after, law.outputPolicy),
    )
  })
  return {
    output: outputState,
    checkpoints: logicalBatches.length,
    deliveries: deliveriesCount,
  }
}

export function assertBinaryIncrementalization<Left, Right, Output>(
  law: BinaryIncrementalizationLaw<Left, Right, Output>,
): IncrementalizationReach {
  const atomic = runBinary(law, false)
  const split = runBinary(law, true)
  assertEqual(
    law.name,
    law.batches.length,
    `partitioned output`,
    split.output,
    atomic.output,
  )
  return {
    atomicCheckpoints: atomic.checkpoints,
    atomicDeliveries: atomic.deliveries,
    splitCheckpoints: split.checkpoints,
    splitDeliveries: split.deliveries,
  }
}
