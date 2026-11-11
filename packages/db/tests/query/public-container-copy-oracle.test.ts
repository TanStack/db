import { D2 } from '@tanstack/db-ivm'
import fc from 'fast-check'
import { afterAll, beforeAll, expect } from 'vitest'
import { getQueryIR } from '../../src/query/builder/index.js'
import { compileQuery } from '../../src/query/compiler/index.js'
import {
  INCLUDES_ROUTING,
  stripInternalCallbackMetadata,
  transformPublicContainers,
} from '../../src/query/compiler/route-metadata.js'
import { materializeCompilation } from '../../src/query/live/materialized-pipeline.js'
import { Query, eq, include } from '../../src/query/index.js'
import { oracleProperty, pass, violation } from '../oracle-config.js'
import { declareOracle } from '../oracle-declaration.js'
import { createControlledCollection } from './includes-oracle-helpers.js'
import type { Observation, Verdict } from '../oracle-config.js'
import type { ValueResolver } from '../../src/query/live/materialized-pipeline.js'

/**
 * ARCHITECTURE.md's public-value preservation law requires cleanup copies to
 * retain prototypes, descriptors and user symbols without reading accessors.
 * This owner checks that law at resolver return, before Collection enrichment.
 * It owns copy shape; metadata attribution and opaque-payload work have their
 * own owners. No provider, framework or publication timing claim follows.
 *
 * Every input runs all four cleanup paths, three array prototypes and both
 * changed/unchanged states. Sparse sizes, values and locked lengths vary in
 * fixed/fresh campaigns. Plain, derived and null prototypes distinguish array
 * identity from inherited methods. Non-array opaque instances are excluded.
 * Removing a structural axis loses a path, prototype or identity obligation;
 * the empty and eight-slot examples pin the size range endpoints.
 */
const paths = [`shallow`, `generic`, `compiled-root`, `compiled-path`] as const
const prototypes = [`native`, `derived`, `null`] as const
const programs = paths.flatMap((path) =>
  prototypes.flatMap((prototype) =>
    [false, true].map((changed) => ({ path, prototype, changed })),
  ),
)
const inputGrammar = fc.record({
  size: fc.integer({ min: 0, max: 8 }),
  value: fc.integer({ min: -1, max: 1 }),
  locked: fc.boolean(),
})
type CopyInput = typeof inputGrammar extends fc.Arbitrary<infer T> ? T : never
type Program = (typeof programs)[number]
class AuthoredArray extends Array<unknown> {}

// The model captures only the public copy contract. It neither traverses the
// production graph nor classifies values with production's container helper.
function expectedCopy(input: object, program: Program, replacement: object) {
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(input)
  if (program.changed) {
    if (program.path === `compiled-path`)
      descriptors.detail = { ...descriptors.detail!, value: replacement }
    else delete descriptors[INCLUDES_ROUTING]
  }
  return {
    source: input,
    prototype: Object.getPrototypeOf(input) as unknown,
    descriptors,
    changed: program.changed,
  }
}

function expectCopyFollowsLaw(
  actual: unknown,
  expected: ReturnType<typeof expectedCopy>,
) {
  expect(Array.isArray(actual)).toBe(true)
  expect(Object.getPrototypeOf(actual)).toBe(expected.prototype)
  expect(actual === expected.source).toBe(!expected.changed)
  const descriptors: Record<PropertyKey, PropertyDescriptor> =
    Object.getOwnPropertyDescriptors(actual)
  expect(descriptors).toEqual(expected.descriptors)
  for (const key of Reflect.ownKeys(expected.descriptors)) {
    const descriptor = expected.descriptors[key]!
    if (`value` in descriptor)
      expect(descriptors[key]?.value).toBe(descriptor.value)
  }
}

declareOracle({
  owns: [
    `src/query/compiler/route-metadata.ts#stripInternalCallbackMetadata`,
    `src/query/compiler/route-metadata.ts#transformPublicContainers`,
    `src/query/live/materialized-pipeline.ts#compileValueResolver`,
  ],
  model: [expectedCopy],
  check: [expectCopyFollowsLaw, checkCopyPrograms, checkCopyCampaign],
  grammar: [programs, inputGrammar],
})

// Compile a real include plan, then test its resolver on supplied public
// values. The generic path also places the array below a record, so the driver
// exercises graph propagation instead of only a root replacement.
const source = createControlledCollection(`copy-law-source`)
let compiled!: ValueResolver
beforeAll(() => {
  const query = new Query()
    .from({ parent: source.collection })
    .select(({ parent }) => ({
      detail: include(
        new Query()
          .from({ child: source.collection })
          .where(({ child }) => eq(child.id, parent.id))
          .select(({ child }) => ({ id: child.id })),
      ),
    }))
  const graph = new D2()
  const input = graph.newInput<[number, { id: number }]>()
  const compilation = compileQuery(
    getQueryIR(query),
    { parent: input, child: input },
    { [source.collection.id]: source.collection },
    {},
    {},
    new Set(),
    {},
    () => {},
  )
  compiled = materializeCompilation(compilation).resolve!
})
afterAll(() => source.collection.cleanup())

function checkCopyPrograms(
  description: CopyInput,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const failures: Array<unknown> = []
  for (const program of programs) {
    const input: Array<unknown> = new Array(description.size)
    if (description.size > 0) input[description.size - 1] = description.value
    Object.setPrototypeOf(
      input,
      program.prototype === `native`
        ? Array.prototype
        : program.prototype === `derived`
          ? AuthoredArray.prototype
          : null,
    )
    let reads = 0
    const marker = { reference: true }
    const replacement = { reference: false }
    Object.defineProperties(input, {
      detail: { value: marker, enumerable: true },
      hidden: { value: description.value },
      accessor: {
        get: () => {
          reads++
          return marker
        },
        enumerable: true,
      },
      [Symbol(`authored`)]: { value: marker },
      ...(program.changed && program.path !== `compiled-path`
        ? { [INCLUDES_ROUTING]: { value: true } }
        : {}),
      length: { writable: !description.locked },
    })
    const before = Object.getOwnPropertyDescriptors(input)
    const expected = expectedCopy(input, program, replacement)
    const resolve = (leaf: unknown) =>
      program.path === `compiled-path` && program.changed && leaf === marker
        ? replacement
        : leaf
    try {
      const actual =
        program.path === `shallow`
          ? stripInternalCallbackMetadata(input)
          : program.path === `generic`
            ? (
                transformPublicContainers(
                  { input },
                  resolve,
                  new Set([INCLUDES_ROUTING]),
                ) as { input: unknown }
              ).input
            : compiled(input, resolve)
      // A return is the component checkpoint. All states count before their
      // comparison, so a failed shape cannot masquerade as missing reach.
      observe(
        `reach`,
        `${program.path}/${program.prototype}/${program.changed}`,
      )
      expectCopyFollowsLaw(actual, expected)
      expect(Object.getOwnPropertyDescriptors(input)).toEqual(before)
      expect(reads).toBe(0)
    } catch (error) {
      // Only the existing comparison's assertion failure is a semantic
      // observation. Runtime failures keep their original aggregate behavior.
      if (error instanceof Error && error.name === `AssertionError`)
        observe(`${program.path}/${program.prototype}/${program.changed}`, {
          kind: `copy comparison mismatch`,
          difference: String(error),
        })
      failures.push(
        new Error(
          `${program.path}/${program.prototype}/${program.changed}: ${String(error)}`,
          { cause: error },
        ),
      )
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `public copy law: ${failures.map(String).join(`; `)}`,
    )
}

const copyStates = programs.map(
  ({ path, prototype, changed }) => `${path}/${prototype}/${changed}`,
)

// The original descriptor/reference judgment above remains beside its model.
// This adapter forwards only its assertion failures, preserving the original
// AggregateError and assertion stack as the driver's cause. Reach is checked
// after comparisons, so a missing state cannot replace a setup failure.
function checkCopyCampaign(
  _description: CopyInput,
  trace: ReadonlyArray<Observation>,
  requiredStates: ReadonlyArray<string>,
): Verdict {
  for (const entry of trace) {
    const value = entry.value as { kind?: string; difference?: string } | null
    if (value?.kind === `copy comparison mismatch`)
      return violation(entry.checkpoint, value.difference!, `public copy shape`)
  }
  for (const state of requiredStates)
    if (
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(
        `constructed states`,
        `public copy program missed ${state}`,
        `public copy reach`,
      )
  return pass
}

oracleProperty({
  id: `query.public-container-copy`,
  law: {
    statement: `Cleanup copies preserve public array shape, prototypes, descriptors, user symbols and reference leaves without reading accessors or mutating the source.`,
    authority: `ARCHITECTURE.md's public-value preservation law, stated at the start of this owner.`,
    limits: `The original twenty-four cleanup-path/prototype/change cells, sparse sizes zero through eight and locked lengths; resolver return before Collection enrichment. No publication or provider claim.`,
  },
  histories: {
    arbitrary: inputGrammar,
    runs: 6,
    fixedSeeds: [2355],
    fixed: [
      {
        name: `empty unlocked array`,
        history: { size: 0, value: 0, locked: false },
      },
      {
        name: `eight-slot locked array`,
        history: { size: 8, value: -1, locked: true },
      },
    ],
    states: copyStates,
    constructed: [
      {
        name: `all copy programs with generated array data`,
        enters: copyStates,
        build: (generated) => ({ ...generated }),
      },
    ],
  },
  // The expected descriptors remain computed by expectedCopy for each runtime
  // input. The registration model carries the existing full-program reach law.
  model: () => copyStates,
  driver: checkCopyPrograms,
  check: checkCopyCampaign,
})
