// The ready-callback truncate grammar and its row-overlay model, moved
// unchanged out of collection-sync-reentrancy-oracle.test.ts so that the
// grammar-size check in collection-sync-reentrancy.test.ts can import it
// without importing the oracle file. It registers no tests.
// A truncate marks the Collection ready before it publishes its batch, and a
// ready callback can write in that window. The callback's messages and the
// truncate batch together must be valid for every subscriber, and must end
// at the Collection's rows, whatever optimistic requests were already
// active. A subscriber without initial state has no sent-key filter to hide
// a repeated message. A filtered subscriber keeps only rows whose value is
// `one`, so a removal must reach it with the row it holds. Subscribers
// receive the truncate's messages only after the Collection is ready. A
// message that carries a source row is synced and remote unless a prior
// request owns its key. A subscriber that the callback creates starts from
// the rows it sees, and a live query becomes ready showing replaced rows.
//
// The model overlays active intents, in order, over source rows. Before the
// truncate, the source holds keys 1 and 4. The replacement holds 1 and 2, so
// key 4's prefix delete must remain. A prior request is active before the
// truncate. The callback then writes once against the rows it can see.
export type ReadyIntent =
  | { type: `update` | `insert`; key: number; value: string }
  | { type: `delete`; key: number }
export const overlay = (
  rows: ReadonlyArray<readonly [number, string]>,
  intents: ReadonlyArray<ReadyIntent | undefined>,
) => {
  const visible = new Map(rows)
  for (const intent of intents) {
    if (!intent) continue
    if (intent.type === `delete`) visible.delete(intent.key)
    else visible.set(intent.key, intent.value)
  }
  return visible
}
export const sourceBefore = [
  [1, `one`],
  [4, `four`],
] as const
export const replacement = [
  [1, `one-again`],
  [2, `two`],
] as const
const priorIntents: Record<string, ReadyIntent | undefined> = {
  none: undefined,
  'update 1': { type: `update`, key: 1, value: `prior-one` },
  'delete 1': { type: `delete`, key: 1 },
  'insert 3': { type: `insert`, key: 3, value: `prior-three` },
}
const callbackIntents = (visible: ReadonlyMap<number, string>) =>
  [1, 2, 3, 4].flatMap((key): Array<ReadyIntent> =>
    visible.has(key)
      ? [
          { type: `update`, key, value: `callback-${key}` },
          { type: `delete`, key },
        ]
      : [{ type: `insert`, key, value: `callback-${key}` }],
  )
export const sourceValues = new Set<string>(
  [...sourceBefore, ...replacement].map(([, value]) => value),
)
export const describeIntent = (intent: ReadyIntent | undefined) =>
  intent ? `${intent.type} ${intent.key}` : `none`
export const readyCases = ([`onFirstReady`, `status:change`] as const).flatMap(
  (hook) =>
    Object.entries(priorIntents).flatMap(([priorName, prior]) =>
      callbackIntents(overlay(replacement, [prior])).flatMap((callback) =>
        ([`initial`, `raw`, `filtered`] as const).map((subscriber) => ({
          hook,
          priorName,
          prior,
          callback,
          callbackName: describeIntent(callback),
          subscriber,
        })),
      ),
    ),
)

export type ReadyCase = (typeof readyCases)[number]
