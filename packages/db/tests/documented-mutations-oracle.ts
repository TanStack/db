import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
} from './mutation-confirmation-oracle'
import type {
  MutationConfirmationCut,
  MutationConfirmationHistory,
  MutationConfirmationInputs,
  MutationConfirmationObservation,
  MutationOperation,
} from './mutation-confirmation-oracle'

/**
 * Recommended mutation handlers must confirm successful server writes before
 * settlement. Before/WRONG examples deliberately omit that obligation. Their
 * old return values have no coordinating effect (the approved RC contract).
 *
 * This grammar receives the existing mutation-confirmation judgment; it owns
 * no second outcome model. A declared strategy is independent of execution:
 * an API may commit and reject before the handler can request confirmation.
 * Such a rejection drops the optimistic state onto the old base. A later
 * explicit read/stream delivery reveals the committed server row.
 *
 * Scope: exact handler ASTs, one mutation, one edited key and an optional peer.
 * Complete ordinary fields, including Dates and own undefined, are observed.
 * Transport rejection and resolved HTTP 503 responses are separate lanes for
 * the fetch handler, with server-write fact varied independently. The HTTP
 * branch owes an Error with its declared message and exact error propagation.
 * Full schema/factory/query/component execution, awaitMatch, timeout guidance,
 * multiple mutations, persistence wrappers and live providers are not claimed.
 */
export type DocumentedRow = Record<string, unknown> & { id: string | number }
export type DocumentedApi =
  `bulk-todos` | `todos` | `products` | `profile` | `single-todo` | `fetch`
export type DocumentedPayload =
  | `modified`
  | `changes`
  | `id-changes`
  | `where-data`
  | `key`
  | `rows`
  | `updates`
  | `keys`
export type DocumentedHandler = {
  id: string
  file: string
  heading: string
  fence: number
  selection?: `after` | `before` | `correct` | `wrong`
  operation: MutationOperation
  adapter: `query` | `electric`
  confirmation: MutationConfirmationHistory[`confirmation`]
  api: DocumentedApi
  payload: DocumentedPayload
  shape: `todo` | `dated-todo` | `product` | `profile`
  numeric?: boolean
  legacy?: boolean
}

const queryGuide = `docs/collections/query-collection.md`
const electricGuide = `docs/collections/electric-collection.md`
const mutations = `docs/guides/mutations.md`
const migration = `docs/guides/migrate-to-1-0-rc.md`
const skillRoot = `packages/db/skills/db-core/`
type Fence = Omit<DocumentedHandler, `id` | `operation` | `payload`> & {
  id: string
  handlers: Array<[MutationOperation, DocumentedPayload]>
}

// These declarations specify the published recommendations and collaborators.
// They do not inspect the extracted handler to choose its required outcome.
const fences: Array<Fence> = [
  {
    id: `error-post`,
    file: `docs/guides/error-handling.md`,
    heading: `## Transaction Error Handling`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `fetch`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `query-handlers`,
    file: queryGuide,
    heading: `## Persistence Handlers`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
      [`delete`, `keys`],
    ],
  },
  {
    id: `query-upsert`,
    file: queryGuide,
    heading: `#### Applying a Server Response Without Refetching`,
    fence: 0,
    adapter: `query`,
    confirmation: `write`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [[`insert`, `rows`]],
  },
  {
    id: `query-incremental`,
    file: queryGuide,
    heading: `### Example: Incremental Updates`,
    fence: 0,
    adapter: `query`,
    confirmation: `write`,
    api: `bulk-todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
    ],
  },
  {
    id: `mutations-after`,
    file: mutations,
    heading: `### Simplified Mutations vs Traditional Approaches`,
    fence: 1,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `mutations-query`,
    file: mutations,
    heading: `### Collection-Specific Handler Patterns`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `mutations-electric`,
    file: mutations,
    heading: `### Collection-Specific Handler Patterns`,
    fence: 1,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `mutations-profile`,
    file: mutations,
    heading: `#### Combining Local and Server Collections`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `profile`,
    shape: `profile`,
    handlers: [[`update`, `modified`]],
  },
  {
    id: `migration-electric`,
    file: migration,
    heading: `## Await synchronization inside mutation handlers`,
    fence: 1,
    selection: `after`,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `changes`]],
  },
  {
    id: `migration-query`,
    file: migration,
    heading: `### Query Collection handlers no longer refetch`,
    fence: 0,
    selection: `after`,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `changes`]],
  },
  {
    id: `skill-query`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### 4. Mutation handlers with explicit refetch (QueryCollection pattern)`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `id-changes`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-electric`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### 4. Mutation handlers with explicit refetch (QueryCollection pattern)`,
    fence: 1,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [[`update`, `id-changes`]],
  },
  {
    id: `skill-correct`,
    file: `${skillRoot}mutations-optimistic/SKILL.md`,
    heading: `### HIGH: Returning before Query Collection has confirmed data`,
    fence: 0,
    selection: `correct`,
    adapter: `query`,
    confirmation: `refetch`,
    api: `single-todo`,
    shape: `todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `skill-products`,
    file: `${skillRoot}collection-setup/references/query-adapter.md`,
    heading: `## Complete Example`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `products`,
    shape: `product`,
    handlers: [
      [`insert`, `rows`],
      [`update`, `updates`],
      [`delete`, `keys`],
    ],
  },
  {
    id: `skill-electric-complete`,
    file: `${skillRoot}collection-setup/references/electric-adapter.md`,
    heading: `## Complete Example`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `dated-todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `where-data`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-setup-query`,
    file: `${skillRoot}collection-setup/SKILL.md`,
    heading: `## Setup`,
    fence: 0,
    adapter: `query`,
    confirmation: `refetch`,
    api: `todos`,
    shape: `dated-todo`,
    numeric: true,
    handlers: [
      [`insert`, `modified`],
      [`update`, `id-changes`],
      [`delete`, `key`],
    ],
  },
  {
    id: `skill-setup-electric`,
    file: `${skillRoot}collection-setup/SKILL.md`,
    heading: `### ElectricSQL with txid tracking`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `dated-todo`,
    handlers: [[`insert`, `modified`]],
  },
  {
    id: `electric-handlers`,
    file: electricGuide,
    heading: `### 1. Using Txid (Recommended)`,
    fence: 0,
    adapter: `electric`,
    confirmation: `txid`,
    api: `todos`,
    shape: `todo`,
    handlers: [
      [`insert`, `modified`],
      [`update`, `where-data`],
    ],
  },
]

export const documentedHandlers: Array<DocumentedHandler> = fences.flatMap(
  ({ handlers, ...fence }) =>
    handlers.map(([operation, payload]) => ({
      ...fence,
      operation,
      payload,
      id: `${fence.id}/${operation}`,
      confirmation:
        fence.id === `skill-products` && operation === `insert`
          ? `write`
          : fence.confirmation,
    })),
)
export const negativeDocumentedHandlers: Array<DocumentedHandler> = [
  {
    ...documentedHandlers.find((h) => h.id === `migration-electric/update`)!,
    id: `migration-electric-before/update`,
    selection: `before`,
    confirmation: `none`,
    legacy: true,
  },
  {
    ...documentedHandlers.find((h) => h.id === `migration-query/update`)!,
    id: `migration-query-before/update`,
    selection: `before`,
    confirmation: `none`,
  },
  {
    ...documentedHandlers.find((h) => h.id === `skill-correct/insert`)!,
    id: `skill-wrong/insert`,
    selection: `wrong`,
    confirmation: `none`,
  },
]

export type DocumentedMutationHistory = {
  id: string
  handler: DocumentedHandler
  apiOutcome: `success` | `reject-before-write` | `reject-after-write`
  // This splits an unsuccessful mutation attempt from its transport result:
  // fetch may resolve to a non-OK HTTP response, with either ledger-write fact.
  failureResponse?: `http-status`
  mutation: MutationConfirmationHistory
}

export type DocumentedMutationObservation =
  MutationConfirmationObservation<DocumentedRow> & {
    handlerOutcome: `pending` | `fulfilled` | `rejected`
    handlerError: unknown
  }

// The authored handler's own Promise is observed independently of transaction
// settlement. At a held source cut it must still be pending; no fixture gate
// may supply a missing await. This uses the existing outcome model's result,
// not another account of optimistic settlement. Already accepted direct writes
// have no held-source cut and impose no requirement about await spelling.
export function checkDocumentedMutation(
  history: DocumentedMutationHistory,
  cut: MutationConfirmationCut,
  observed: DocumentedMutationObservation,
  failure: Error,
  inputs: MutationConfirmationInputs<DocumentedRow>,
): void {
  const { handlerOutcome, handlerError, ...transaction } = observed
  const settled = cut === `settled` || cut === `late-confirmed`
  let expectedFailure = failure
  if (history.failureResponse === `http-status` && settled) {
    // Kind/message are independently declared for the actual guide's HTTP
    // branch. Only after that judgment does its captured error become the
    // identity token that adapter settlement must preserve.
    expect(handlerOutcome, `${cut}: HTTP status must reject the handler`).toBe(
      `rejected`,
    )
    expect(handlerError, `${cut}: HTTP error kind`).toBeInstanceOf(Error)
    if (!(handlerError instanceof Error)) throw new Error(`Missing HTTP Error`)
    expect(handlerError.message, `${cut}: HTTP error message`).toBe(
      `HTTP Error: 503`,
    )
    expectedFailure = handlerError
  }
  const expected = expectedMutationConfirmation(
    history.mutation,
    cut,
    expectedFailure,
    inputs,
  )
  expect(handlerOutcome, `${cut}: actual documented handler Promise`).toBe(
    expected.settlement,
  )
  expect(handlerError, `${cut}: actual documented handler rejection`).toBe(
    expected.error,
  )
  checkMutationConfirmation(
    history.mutation,
    cut,
    transaction,
    expectedFailure,
    inputs,
  )
}

// API failure is upstream of the handler's acknowledgement. It commits no
// source transaction. The existing default rejection-after-ack stays unchanged.
export function documentedMutationHistories(
  adapter: `query` | `electric`,
): Array<DocumentedMutationHistory> {
  const histories: Array<DocumentedMutationHistory> = [
    ...documentedHandlers,
    ...negativeDocumentedHandlers,
  ]
    .filter((h) => h.adapter === adapter)
    .flatMap((handler) =>
      (handler.confirmation === `none`
        ? ([`success`] as const)
        : ([`success`, `reject-before-write`, `reject-after-write`] as const)
      ).flatMap((apiOutcome) =>
        [false, true].map((peer) => ({
          id: `${handler.id}/${apiOutcome}/peer:${peer}`,
          handler,
          apiOutcome,
          mutation: {
            adapter,
            operation: handler.operation,
            peer,
            confirmation: handler.confirmation,
            confirmationEntry:
              apiOutcome === `success` ? `reached` : `unreachable`,
            ...(apiOutcome === `success`
              ? {
                  outcome: `fulfilled` as const,
                  returned: handler.legacy
                    ? (`legacy-txid` as const)
                    : (`void` as const),
                }
              : { outcome: apiOutcome, returned: `void` as const }),
          },
        })),
      ),
    )
  return histories.flatMap((history) =>
    history.handler.api === `fetch` && history.apiOutcome !== `success`
      ? [
          history,
          {
            ...history,
            id: `${history.id}/http:503`,
            failureResponse: `http-status` as const,
          },
        ]
      : [history],
  )
}

export function documentedMutationInputs(
  handler: DocumentedHandler,
): MutationConfirmationInputs<DocumentedRow> {
  const id = handler.numeric ? 1 : `1`
  const peerId = handler.numeric ? 2 : `2`
  if (handler.shape === `profile` || handler.shape === `product`)
    return {
      before: { id, name: `before` },
      optimistic: { id, name: `optimistic` },
      confirmed: { id, name: `confirmed`, server_value: undefined },
      peer: { id: peerId, name: `peer` },
    }
  const dated = handler.shape === `dated-todo`
  const extra = dated ? { created_at: new Date(`2026-10-01T00:00:00Z`) } : {}
  return {
    before: { id, text: `before`, completed: false, ...extra },
    optimistic: { id, text: `optimistic`, completed: false, ...extra },
    confirmed: { id, text: `confirmed`, completed: true, ...extra },
    peer: { id: peerId, text: `peer`, completed: false, ...extra },
  }
}

declareOracle({
  check: [checkDocumentedMutation],
  grammar: [documentedMutationHistories, documentedHandlers],
  model: [documentedMutationInputs],
})
