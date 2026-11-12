/**
 * Reachable mixed-carrier cycles reject on both serial hash attempts. An
 * acyclic shared graph agrees with its independently unfolded tree. The
 * established structural-value law covers six recursive carriers, one to six
 * labeled nodes, and zero to three edges per node. Collision freedom, opaque
 * references, work limits, and failed-traversal atomicity stay with other owners.
 */
import { hash } from '../src/hashing/hash'
import { oracleReplayRequested } from '../../db/tests/oracle-config.js'
import {
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'
import {
  carriers,
  checkMixedGraph,
  driveMixedGraph,
  expectedMixedGraph,
  graphArbitrary,
  isAcyclic,
} from './hash-mixed-graph-shared-oracle'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from '../../db/tests/oracle-property.js'
import type { Carrier, Edge, Graph } from './hash-mixed-graph-shared-oracle'

const states = [
  ...carriers.flatMap((carrier) => [
    `cycle via ${carrier}`,
    `shared target via ${carrier}`,
    `equal distinct nodes via ${carrier}`,
  ]),
  `mixed back edge`,
  `disconnected mixed neighbor`,
  `mixed diamond`,
]

// These are model graph premises recorded only after the real hash calls.
// Reachability names the executed root graph, not disconnected authored nodes.
function mixedStates(graph: Graph): Array<string> {
  const reached: Array<string> = []
  const reachable = new Set([0])
  for (const node of reachable)
    for (const edge of graph[node]!.edges) reachable.add(edge.target)
  const connects = (start: number, end: number): boolean => {
    const seen = new Set([start])
    for (const node of seen) {
      if (node === end) return true
      for (const edge of graph[node]!.edges) seen.add(edge.target)
    }
    return false
  }
  const acyclic = isAcyclic(graph)
  for (const carrier of carriers) {
    if (
      [...reachable].some((node) =>
        graph[node]!.edges.some(
          (edge) => edge.carrier === carrier && connects(edge.target, node),
        ),
      )
    )
      reached.push(`cycle via ${carrier}`)
    if (
      acyclic &&
      [...reachable].some((node) => {
        const edges = graph[node]!.edges.filter(
          (edge) => edge.carrier === carrier,
        )
        return edges.some((edge, index) =>
          edges.slice(index + 1).some((other) => other.target === edge.target),
        )
      })
    )
      reached.push(`shared target via ${carrier}`)
    if (
      acyclic &&
      [...reachable].some((node) => {
        const edges = graph[node]!.edges.filter(
          (edge) => edge.carrier === carrier,
        )
        return edges.some((edge, index) =>
          edges
            .slice(index + 1)
            .some(
              (other) =>
                edge.target !== other.target &&
                graph[edge.target]!.edges.length === 0 &&
                graph[other.target]!.edges.length === 0 &&
                graph[edge.target]!.label === graph[other.target]!.label,
            ),
        )
      })
    )
      reached.push(`equal distinct nodes via ${carrier}`)
  }
  const edge = (node: number, target: number, carrier: Carrier) =>
    graph[node]?.edges.some(
      (value) => value.target === target && value.carrier === carrier,
    ) === true
  if (edge(0, 1, `map-key`) && edge(1, 2, `set`) && edge(2, 0, `symbol`))
    reached.push(`mixed back edge`)
  if (graph[0]!.edges.length === 0 && edge(1, 2, `set`) && edge(2, 0, `symbol`))
    reached.push(`disconnected mixed neighbor`)
  if (
    acyclic &&
    edge(0, 1, `object`) &&
    edge(0, 2, `array`) &&
    edge(1, 3, `map-value`) &&
    edge(2, 3, `set`)
  )
    reached.push(`mixed diamond`)
  return reached
}

// Force only the required topology. Generated labels and disconnected suffix
// nodes remain. Each result has fresh keys for per-invocation obligations.
function prefix(
  graph: Graph,
  edges: Array<Array<Edge>>,
  equalLeaves = false,
): Graph {
  const result = Array.from(
    { length: Math.max(graph.length, edges.length) },
    (_, node) => ({
      label: graph[node]?.label ?? graph[0]!.label,
      edges: [...(edges[node] ?? graph[node]!.edges)],
    }),
  )
  if (equalLeaves) result[2]!.label = result[1]!.label
  return result.map((node) =>
    Object.freeze({ ...node, edges: Object.freeze(node.edges) }),
  )
}

const constructionStates = new WeakMap<Graph, ReadonlyArray<string>>()
function enforceConstructed(
  builders: Array<ConstructedHistory<Graph>>,
): Array<ConstructedHistory<Graph>> {
  return builders.map((builder) => ({
    ...builder,
    build: (generated) => {
      const graph = builder.build(generated)
      constructionStates.set(graph, builder.enters)
      return graph
    },
  }))
}

const constructed: Array<ConstructedHistory<Graph>> = [
  ...carriers.flatMap((carrier): Array<ConstructedHistory<Graph>> => [
    {
      name: `cycle through ${carrier}`,
      enters: [`cycle via ${carrier}`],
      build: (graph) => prefix(graph, [[{ target: 0, carrier }]]),
    },
    {
      name: `sharing through ${carrier}`,
      enters: [`shared target via ${carrier}`],
      build: (graph) =>
        prefix(graph, [
          [
            { target: 1, carrier },
            { target: 1, carrier },
          ],
          [],
        ]),
    },
    {
      name: `equal distinct leaves through ${carrier}`,
      enters: [`equal distinct nodes via ${carrier}`],
      build: (graph) =>
        prefix(
          graph,
          [
            [
              { target: 1, carrier },
              { target: 2, carrier },
            ],
            [],
            [],
          ],
          true,
        ),
    },
  ]),
  {
    name: `mixed back edge`,
    enters: [`mixed back edge`],
    build: (graph) =>
      prefix(graph, [
        [{ target: 1, carrier: `map-key` }],
        [{ target: 2, carrier: `set` }],
        [{ target: 0, carrier: `symbol` }],
      ]),
  },
  {
    name: `disconnected mixed neighbor`,
    enters: [`disconnected mixed neighbor`],
    build: (graph) =>
      prefix(graph, [
        [],
        [{ target: 2, carrier: `set` }],
        [{ target: 0, carrier: `symbol` }],
      ]),
  },
  {
    name: `mixed diamond`,
    enters: [`mixed diamond`],
    build: (graph) =>
      prefix(graph, [
        [
          { target: 1, carrier: `object` },
          { target: 2, carrier: `array` },
        ],
        [{ target: 3, carrier: `map-value` }],
        [{ target: 3, carrier: `set` }],
        [],
      ]),
  },
]

// Fixed witnesses reconstruct every former named production case. Generated
// constructions above carry required reach; these literal histories do not.
const fixed = [
  ...carriers.flatMap((carrier) => [
    {
      name: `cycle through ${carrier}`,
      history: [{ label: 0, edges: [{ target: 0, carrier }] }],
    },
    {
      name: `distinct equal leaves through ${carrier}`,
      history: [
        {
          label: 0,
          edges: [
            { target: 1, carrier },
            { target: 2, carrier },
          ],
        },
        { label: 1, edges: [] },
        { label: 1, edges: [] },
      ],
    },
    {
      name: `shared leaf through ${carrier}`,
      history: [
        {
          label: 0,
          edges: [
            { target: 1, carrier },
            { target: 1, carrier },
          ],
        },
        { label: 1, edges: [] },
        { label: 1, edges: [] },
      ],
    },
  ]),
  {
    name: `mixed back edge`,
    history: [
      { label: 0, edges: [{ carrier: `map-key` as const, target: 1 }] },
      { label: 0, edges: [{ carrier: `set` as const, target: 2 }] },
      { label: 0, edges: [{ carrier: `symbol` as const, target: 0 }] },
    ],
  },
  {
    name: `disconnected mixed neighbor`,
    history: [
      { label: 0, edges: [] },
      { label: 0, edges: [{ carrier: `set` as const, target: 2 }] },
      { label: 0, edges: [{ carrier: `symbol` as const, target: 0 }] },
    ],
  },
  {
    name: `mixed diamond`,
    history: [
      {
        label: 0,
        edges: [
          { carrier: `object` as const, target: 1 },
          { carrier: `array` as const, target: 2 },
        ],
      },
      { label: 1, edges: [{ carrier: `map-value` as const, target: 3 }] },
      { label: 2, edges: [{ carrier: `set` as const, target: 3 }] },
      { label: 2, edges: [] },
    ],
  },
]

function expectedCampaign(graph: Graph) {
  return {
    graph: expectedMixedGraph(graph),
    requiredStates: constructionStates.get(graph) ?? [],
  }
}
function checkCampaign(
  graph: Graph,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof expectedCampaign>,
): Verdict {
  const semantic = checkMixedGraph(graph, trace, expected.graph)
  if (semantic.kind !== `pass`) return semantic
  for (const state of expected.requiredStates)
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
  return pass
}

oracleProperty({
  id: `ivm.hash-mixed-graph`,
  law: {
    statement: `A reachable structural cycle rejects each hash attempt; unfolding sharing in an acyclic value graph preserves its hash across object, array, Map-key, Map-value, Set, and symbol-keyed carriers.`,
    authority: `Established structural-value graph contract; oracle-coverage.md, Structural values and ordered primitives; hash-graph oracle.`,
    limits: `One to six nodes, zero to three ordered edges per node, labels 0..2, six recursive carriers, and in-range targets. No collision freedom, ordering invariance, opaque references, work/depth limits, or retry atomicity.`,
  },
  owns: [`src/hashing/hash.ts#hash`],
  histories: {
    arbitrary: graphArbitrary,
    runs: 150,
    fixedSeeds: [205203],
    states,
    constructed: enforceConstructed(constructed),
    fixed,
  },
  model: expectedCampaign,
  driver: (graph, observe) => {
    const hashValue =
      oracleReplayRequested() &&
      process.env.TANSTACK_DB_ORACLE_CALIBRATION === `accept-cycles`
        ? () => 0
        : hash
    driveMixedGraph(graph, observe, hashValue)
    for (const state of mixedStates(graph)) observe(`reach`, state)
  },
  check: checkCampaign,
  calibrations: [
    {
      name: `accepts a reachable cycle`,
      law: `reachable cycle`,
      corrupt: (trace, graph) =>
        isAcyclic(graph)
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `cycle rejection attempt 1`
                ? { ...entry, value: false }
                : entry,
            ),
    },
    {
      name: `omits the second rejection`,
      law: `reachable cycle`,
      corrupt: (trace, graph) =>
        isAcyclic(graph)
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `cycle rejection attempt 2`,
            ),
    },
    {
      name: `shared graph and unfolding disagree`,
      law: `acyclic unfolding`,
      corrupt: (trace, graph) =>
        !isAcyclic(graph)
          ? undefined
          : trace.map((entry) =>
              entry.checkpoint === `acyclic graph and unfolded tree`
                ? { ...entry, value: false }
                : entry,
            ),
    },
    {
      name: `omits a constructed state`,
      law: `constructed reach`,
      corrupt: (trace, graph) => {
        const state = constructionStates.get(graph)?.[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
  ],
})
