/**
 * Hash follows the root-reachable structural graph. Cycles reject on each
 * attempt; acyclic sharing has the same digest as an independently unfolded
 * tree. The established graph contract covers plain numeric-labeled objects
 * with array edges, at most six nodes and three edges per node. Other cycle
 * carriers, collision freedom, and work bounds remain separate owners.
 */
import fc from 'fast-check'
import {
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import {
  checkGraph,
  driveGraph,
  expectedGraph,
  graphArbitrary,
  graphWitnesses,
  isAcyclic,
} from './hash-graph-shared-oracle'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property.js'
import type { GraphHistory } from './hash-graph-shared-oracle'

// Retain the old topology grammar. The offset supplies randomized numeric
// labels even when a construction must force all edges of a small topology.
const historyArbitrary = fc.record({
  edges: graphArbitrary,
  offset: fc.integer({ min: -20, max: 20 }),
})
const states = [
  `isolated root`,
  `root self-cycle`,
  `reachable mutual cycle`,
  `unreachable self-cycle`,
  `shared acyclic diamond`,
  `duplicate acyclic edges`,
  `duplicate cyclic edges`,
  `maximum node and edge bounds`,
  `repeated cycle rejection`,
]

function graphStates({ edges }: GraphHistory): Array<string> {
  const reached: Array<string> = []
  const reachable = new Set([0])
  for (const node of reachable)
    for (const target of edges[node]!) reachable.add(target)
  const acyclic = isAcyclic(edges)
  const root = edges[0]!
  if (root.length === 0) reached.push(`isolated root`)
  if (root.includes(0)) reached.push(`root self-cycle`)
  if (root.some((child) => child !== 0 && edges[child]!.includes(0)))
    reached.push(`reachable mutual cycle`)
  if (
    edges.some(
      (targets, node) => !reachable.has(node) && targets.includes(node),
    )
  )
    reached.push(`unreachable self-cycle`)
  const distinctChildren = [...new Set(root)]
  if (
    acyclic &&
    distinctChildren.some((left, index) =>
      distinctChildren
        .slice(index + 1)
        .some((right) =>
          edges[left]!.some((child) => edges[right]!.includes(child)),
        ),
    )
  )
    reached.push(`shared acyclic diamond`)
  if (
    [...reachable].some(
      (node) => new Set(edges[node]).size < edges[node]!.length,
    )
  )
    reached.push(acyclic ? `duplicate acyclic edges` : `duplicate cyclic edges`)
  if (edges.length === 6 && edges.some((targets) => targets.length === 3))
    reached.push(`maximum node and edge bounds`)
  if (!acyclic) reached.push(`repeated cycle rejection`)
  return reached
}

// Each construction allocates a fresh history and fresh adjacency arrays. Its
// prefix forces one topology; generated labels and unaffected suffix edges stay.
function prefix(
  history: GraphHistory,
  forced: Array<Array<number>>,
): GraphHistory {
  const length = Math.max(history.edges.length, forced.length)
  return {
    offset: history.offset,
    edges: Array.from({ length }, (_, node) =>
      node < forced.length
        ? [...forced[node]!]
        : [...(history.edges[node] ?? [])],
    ),
  }
}

// e1fb504 associates only the initially seeded constructions with their state
// claims. Record every fresh result, including generated and shrunk builds, so
// the shared comparison enforces each builder's declared states independently.
const constructionStates = new WeakMap<GraphHistory, ReadonlyArray<string>>()

function enforceConstructed(
  builders: Array<ConstructedHistory<GraphHistory>>,
): Array<ConstructedHistory<GraphHistory>> {
  return builders.map((builder) => ({
    ...builder,
    build: (generated) => {
      const history = builder.build(generated)
      constructionStates.set(history, builder.enters)
      return history
    },
  }))
}

function expectedCampaign(history: GraphHistory) {
  return {
    graph: expectedGraph(history),
    requiredStates: constructionStates.get(history) ?? [],
  }
}

function checkCampaign(
  history: GraphHistory,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedCampaign>,
): Verdict {
  const result = checkGraph(history, trace, expected.graph)
  if (result.kind !== `pass`) return result
  for (const state of expected.requiredStates) {
    if (
      !trace.some(
        (entry) => entry.checkpoint === `reach` && entry.value === state,
      )
    )
      return violation(
        `constructed states`,
        `constructed history missed ${state}`,
        `constructed reach`,
      )
  }
  return pass
}

oracleProperty({
  id: `ivm.hash-graph`,
  law: {
    statement: `Each reachable cycle rejects on both attempts; an acyclic graph agrees with its independently unfolded tree regardless of sharing.`,
    authority: `Established structural-value graph contract; oracle-coverage.md, Structural values and ordered primitives.`,
    limits: `Plain numeric-labeled object nodes with array edges, one to six nodes and at most three edges per node. No collision-freedom or work-bound claim, and no other cycle carriers.`,
  },
  owns: [`src/hashing/hash.ts#hash`],
  histories: {
    arbitrary: historyArbitrary,
    runs: 300,
    fixedSeeds: [1657019],
    states,
    constructed: enforceConstructed([
      {
        name: `isolated root with generated labels`,
        enters: [`isolated root`],
        build: (history) => prefix(history, [[]]),
      },
      {
        name: `root self-cycle with generated labels`,
        enters: [`root self-cycle`, `repeated cycle rejection`],
        build: (history) => prefix(history, [[0]]),
      },
      {
        name: `mutual cycle with generated labels`,
        enters: [`reachable mutual cycle`, `repeated cycle rejection`],
        build: (history) => prefix(history, [[1], [0]]),
      },
      {
        name: `disconnected cycle with generated labels`,
        enters: [`unreachable self-cycle`],
        build: (history) => prefix(history, [[], [1]]),
      },
      {
        name: `shared diamond with generated labels`,
        enters: [`shared acyclic diamond`],
        build: (history) => prefix(history, [[1, 2], [3], [3], []]),
      },
      {
        name: `duplicate acyclic edges with generated labels`,
        enters: [`duplicate acyclic edges`],
        build: (history) => prefix(history, [[1, 1], []]),
      },
      {
        name: `duplicate cyclic edges with generated labels`,
        enters: [`duplicate cyclic edges`, `repeated cycle rejection`],
        build: (history) => prefix(history, [[1, 1], [0]]),
      },
      {
        name: `maximum bounds with generated labels`,
        enters: [`maximum node and edge bounds`],
        build: (history) =>
          prefix(history, [[1, 2, 5], [3], [3], [4], [5], []]),
      },
    ]),
    fixed: graphWitnesses.map(({ name, edges }) => ({
      name,
      history: { edges, offset: 0 },
    })),
  },
  model: expectedCampaign,
  driver: (history, observe) => {
    driveGraph(history, observe)
    for (const state of graphStates(history)) observe(`reach`, state)
  },
  check: checkCampaign,
  calibrations: [
    {
      name: `omits a constructed state`,
      law: `constructed reach`,
      corrupt: (trace, history) => {
        const state = constructionStates.get(history)?.[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
    {
      name: `accepts a reachable cycle`,
      law: `cycle rejection`,
      corrupt: (trace, history) =>
        isAcyclic(history.edges)
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `cycle rejection attempt 1`
                ? { ...entry, value: false }
                : entry,
            ),
    },
    {
      name: `omits the second rejection`,
      law: `cycle rejection`,
      corrupt: (trace, history) =>
        isAcyclic(history.edges)
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `cycle rejection attempt 2`,
            ),
    },
    {
      name: `shared graph and unfolding disagree`,
      law: `graph unfolding`,
      corrupt: (trace, history) =>
        isAcyclic(history.edges)
          ? trace.map((entry) =>
              entry.checkpoint === `acyclic graph and unfolded tree`
                ? { ...entry, value: false }
                : entry,
            )
          : undefined,
    },
  ],
})
