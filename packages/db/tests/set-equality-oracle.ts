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
