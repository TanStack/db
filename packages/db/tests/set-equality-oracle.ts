/**
 * Change-event equality matches unordered Set members once each. Distinct
 * objects can have the same value, so their multiplicity still matters.
 * Authority: deepEquals's supported Set domain and the glossary's class/plain
 * compatibility rule. A plain record can match either keyed class; two
 * different classes cannot match. Greedy matching therefore is insufficient.
 *
 * The model enumerates assignments of authored descriptors. It never reads
 * production objects or calls the production comparator. Homologous self and
 * ancestor cycles exercise the same member law; arbitrary graph isomorphism,
 * changing getters, proxies and mutation during comparison are excluded.
 * Pure getters count leaf reads. The accepted performance repair requires
 * quadratic work for flat one-field members, not a numerical latency promise.
 */
import { expect } from 'vitest'
import { deepEquals } from '../src/utils.js'
import { declareOracle } from './oracle-declaration.js'

export type SetMemberSpec = {
  kind: `plain` | `first` | `second`
  value: number
}
export type SetShape = `flat` | `self` | `owner` | `nested-owner` | `shared`
type Member = { value: number; next?: unknown }
type Equal = (left: unknown, right: unknown) => boolean

class FirstMember {
  constructor(public value: number) {}
}
class SecondMember {
  constructor(public value: number) {}
}

export function expectedSetEquality(
  left: ReadonlyArray<SetMemberSpec>,
  right: ReadonlyArray<SetMemberSpec>,
): boolean {
  if (left.length !== right.length) return false
  // At most eight members in this grammar. Memoized subset enumeration is
  // an independent, small specification, not the production matching walk.
  const answers = new Map<number, boolean>()
  const assign = (index: number, used: number): boolean => {
    if (index === left.length) return true
    const known = answers.get(used)
    if (known !== undefined) return known
    const member = left[index]!
    const result = right.some(
      (candidate, slot) =>
        (used & (1 << slot)) === 0 &&
        member.value === candidate.value &&
        (member.kind === `plain` ||
          candidate.kind === `plain` ||
          member.kind === candidate.kind) &&
        assign(index + 1, used | (1 << slot)),
    )
    answers.set(used, result)
    return result
  }
  return assign(0, 0)
}

// The driver allocates every Set member separately, including repeated values.
// Only the declared shared-leaf shape aliases an acyclic child within one Set.
export function authoredSet(
  specs: ReadonlyArray<SetMemberSpec>,
  shape: SetShape,
  read: () => void,
): Set<Member> {
  const set = new Set<Member>()
  const shared = { leaf: 1 }
  for (const spec of specs) {
    const member: Member =
      spec.kind === `first`
        ? new FirstMember(spec.value)
        : spec.kind === `second`
          ? new SecondMember(spec.value)
          : { value: spec.value }
    Object.defineProperty(member, `value`, {
      enumerable: true,
      get: () => {
        read()
        return spec.value
      },
    })
    if (shape === `self`) member.next = member
    if (shape === `owner`) member.next = set
    if (shape === `nested-owner`) member.next = new Set([set])
    if (shape === `shared`) member.next = shared
    set.add(member)
  }
  return set
}

export function plainSetSpecs(
  values: ReadonlyArray<number>,
): Array<SetMemberSpec> {
  return values.map((value) => ({ kind: `plain`, value }))
}

export function checkSetEquality(
  left: ReadonlyArray<SetMemberSpec>,
  right: ReadonlyArray<SetMemberSpec>,
  shape: SetShape,
  equal: Equal = deepEquals,
): void {
  let reads = 0
  const a = authoredSet(left, shape, () => reads++)
  const b = authoredSet(right, shape, () => reads++)
  const expected = expectedSetEquality(left, right)
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    reads = 0
    const actual = equal(from, to)
    expect(actual, `Set member assignment (${shape})`).toBe(expected)
    // Flat members have one numeric field. At most one comparison per member
    // pair needs two leaf reads. Cardinality rejection needs none.
    if (shape === `flat`)
      expect(reads, `quadratic Set member reads`).toBeLessThanOrEqual(
        2 * left.length * right.length,
      )
  }
}

export const setShapes: ReadonlyArray<SetShape> = [
  `flat`,
  `self`,
  `owner`,
  `nested-owner`,
  `shared`,
]
export const setWorkSizes = [1, 2, 4, 6, 8] as const
export const setMemberKinds: ReadonlyArray<SetMemberSpec[`kind`]> = [
  `plain`,
  `first`,
  `second`,
]

// Two-member class words exhaust the smallest non-equivalence matching domain.
// In particular [plain, first] vs [first, second] requires reassignment.
export function checkSetFamily(
  value: number,
  reverse: boolean,
  reach: (
    state: SetShape | `equal-duplicates` | `late-mismatch` | `cardinality`,
  ) => void,
): void {
  const words = setMemberKinds.flatMap((first) =>
    setMemberKinds.map((second) => [first, second]),
  )
  for (const shape of setShapes) {
    for (const left of words) {
      for (const right of words) {
        const specs = (kinds: typeof left) =>
          kinds.map((kind) => ({ kind, value }))
        const a = specs(left)
        const b = specs(reverse ? [...right].reverse() : right)
        checkSetEquality(a, b, shape)
      }
    }
    reach(shape)
  }
  // Nearby equal, changed-leaf and changed-multiplicity values all use the
  // same assignment model. Late mismatch reconstructs the reported slowdown.
  for (const size of setWorkSizes) {
    const same = Array.from({ length: size }, () => value)
    const different = [...same.slice(1), value + 1]
    checkSetEquality(
      plainSetSpecs(same),
      plainSetSpecs([...same].reverse()),
      `flat`,
    )
    reach(`equal-duplicates`)
    checkSetEquality(plainSetSpecs(different), plainSetSpecs(same), `flat`)
    reach(`late-mismatch`)
    checkSetEquality(plainSetSpecs(same.slice(1)), plainSetSpecs(same), `flat`)
    reach(`cardinality`)
  }
}

declareOracle({
  model: [expectedSetEquality],
  check: [checkSetEquality, checkSetFamily],
  grammar: [setShapes, setWorkSizes, setMemberKinds],
})

/**
 * An augmenting chain has a known bijection without solving production's
 * matching problem. Gray-code columns differ in one coordinate. Each left
 * word permits the two adjacent columns by using a plain record in that
 * coordinate. Its other coordinates use the column's keyed classes. The final
 * left word names column zero exactly. Matching every earlier word to its
 * successor and the final word to zero is a complete assignment witness.
 *
 * A changed leaf in the final right column instead isolates that column:
 * every left leaf is zero, so no left word can match it. These are sufficient
 * positive and negative judgments for this grammar, not a general graph solver.
 * Rotation varies Set insertion order. Flat matching depth must not become
 * JavaScript call depth, even though arbitrary nested-value depth is unbounded
 * by this instrument. Small generated chains and a finite 8,192-member chain
 * share the same descriptor judgment and production comparison.
 */
type WordDescriptor = ReadonlyArray<SetMemberSpec>
export function setChainDescriptors(
  bits: number,
  broken: boolean,
  rotate: boolean,
) {
  const size = 2 ** bits
  const column = (index: number): Array<SetMemberSpec> => {
    const gray = index ^ (index >> 1)
    return Array.from({ length: bits }, (_, coordinate) => ({
      kind: ((gray >> coordinate) & 1) === 0 ? `first` : `second`,
      value: broken && index === size - 1 ? 1 : 0,
    }))
  }
  const right = Array.from({ length: size }, (_, index) => column(index))
  const left = Array.from({ length: size }, (_, index) => {
    const start = index === size - 1 ? 0 : index
    const a = column(start).map((member) => ({ ...member, value: 0 }))
    const b = column(index === size - 1 ? 0 : index + 1)
    return a.map((member, coordinate): SetMemberSpec => ({
      ...member,
      kind: member.kind === b[coordinate]!.kind ? member.kind : `plain`,
    }))
  })
  const witness = left.map((_, index) => (index + 1) % size)
  if (rotate) {
    right.push(right.shift()!)
    for (const [index, slot] of witness.entries())
      witness[index] = (slot + size - 1) % size
  }
  return { left, right, witness }
}
function expectedChainEquality(
  left: ReadonlyArray<WordDescriptor>,
  right: ReadonlyArray<WordDescriptor>,
  witness: ReadonlyArray<number>,
): boolean {
  const compatible = (a: WordDescriptor, b: WordDescriptor) =>
    a.length === b.length &&
    a.every(
      (member, index) =>
        member.value === b[index]!.value &&
        (member.kind === `plain` ||
          b[index]!.kind === `plain` ||
          member.kind === b[index]!.kind),
    )
  if (
    right.some((word) =>
      left.every((candidate) => !compatible(candidate, word)),
    )
  )
    return false
  if (
    left.length === right.length &&
    new Set(witness).size === right.length &&
    witness.every(
      (slot, index) =>
        slot >= 0 &&
        slot < right.length &&
        compatible(left[index]!, right[slot]!),
    )
  )
    return true
  throw new Error(
    `Chain grammar supplied neither a bijection nor an isolated-column witness`,
  )
}
export function checkSetChain(bits: number, broken: boolean, rotate: boolean) {
  const { left, right, witness } = setChainDescriptors(bits, broken, rotate)
  const expected = expectedChainEquality(left, right, witness)
  const word = (specs: WordDescriptor) => [
    ...authoredSet(specs, `flat`, () => {}),
  ]
  expect(deepEquals(new Set(left.map(word)), new Set(right.map(word)))).toBe(
    expected,
  )
}
declareOracle({
  model: [expectedChainEquality],
  check: [checkSetChain],
  grammar: [setChainDescriptors],
})
