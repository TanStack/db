/**
 * # Do generated public query types respect the row/value boundary?
 *
 * Authority: VirtualRowProps and ARCHITECTURE.md, Nested materialization.
 * Published Collection roots and whole source rows carry four readonly virtual
 * fields. Inline projected objects, nested objects, arrays and opaque values
 * retain their authored shape. The maintainer’s 2026-11-05 boundary-only
 * decision also preserves authored collisions in QueryRef callback inputs and
 * structured refs. Empty grouping contributes no key; a nonempty grouping or
 * aggregate contributes a missing key, including nested and wrapped aggregates.
 * A declared key list that may be empty contributes an optional missing key.
 * Prior definite grouping and aggregates retain their required generated key.
 * Nullable whole-row selections are absent or
 * complete; facade rows always receive required metadata. WithoutVirtualProps
 * distributes over discriminated row unions.
 *
 * The source generator enacts that law with independently written Published,
 * Missing and SameShape types. It never imports production metadata classifiers.
 * Each finite input varies key domain, ordinary value type, nested optionality
 * and discriminated source unions. Every input crosses root projection shape,
 * direct/recursive/union composition and inline materialization form. Expected
 * shapes follow authored declarations, not inferred production types.
 *
 * The real TypeScript compiler receives consumer source importing only the
 * public @tanstack/db entry. Every diagnostic, including dependencies, survives
 * comparison with the empty diagnostic set. This checks source public exports;
 * built declarations, npm resolution, adapter handlers and runtime values are
 * separate receiving paths. Concrete helper examples remain supplemental in
 * virtual-row-fields-reference-types.test-d.ts.
 */
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterAll, expect } from 'vitest'
import * as publicDb from '../../src/index.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../oracle-assertion-adapter.js'
import { checkWithCleanup } from './virtual-row-fields-support.js'
import {
  metadataCompositions as compositions,
  metadataProjectionShapes as projections,
} from './virtual-row-fields-grammar-oracle.js'

// Exhaustive finite grammar. Removing an axis loses a distinct public type:
// numeric/union keys, scalar types, optional nested values or union narrowing.
// Boolean keys and nullable Collection rows are excluded as illegal inputs.
const typeShapes = [`string`, `number`, `string | number`].flatMap((key) =>
  [`string`, `number`].flatMap((value) =>
    [false, true].flatMap((optional) =>
      [false, true].map((union) => ({ key, value, optional, union })),
    ),
  ),
)
type TypeShape = (typeof typeShapes)[number]
const inlineShapes = [
  `whole`,
  `selected-whole`,
  `nullable-whole`,
  `object`,
  `nested-object`,
  `array`,
  `date`,
] as const
const inlineForms = [`facade`, `toArray`, `materialize`, `findOne`] as const
// Authored fields are data before publication. A single-field collision must
// remain visible even when it does not resemble a complete metadata record.
const authoredCollisions = [
  { name: `none`, fields: `` },
  { name: `key`, fields: `, $key: 'authored-key' as const` },
  {
    name: `collection`,
    fields: `, $collectionId: 'authored-collection' as const`,
  },
  { name: `origin`, fields: `, $origin: 'authored-origin' as const` },
  {
    name: `pending`,
    fields: `, $hasPendingWrites: 'authored-pending' as const`,
  },
  {
    name: `all`,
    fields: `, $key: 'authored-key' as const, $collectionId: 'authored-collection' as const, $origin: 'authored-origin' as const, $hasPendingWrites: 'authored-pending' as const`,
  },
] as const
const authoredPaths = [
  `query-ref`,
  `nested-query-ref`,
  `join`,
  `union`,
] as const
const authoredKinds = [`structured`, `functional`] as const
const groupedForms = [`keys-first`, `keys-last`, `aggregate`] as const
type GroupingCall = `empty` | `possible` | `nonempty`
// Grouping accumulates expressions. One definitely nonempty call guarantees a
// generated key; otherwise an admitted empty list makes that key optional.
// These facts describe declared inputs, independently of production contexts.
function groupingKeyFor(calls: ReadonlyArray<GroupingCall>) {
  if (calls.includes(`nonempty`)) return true
  if (calls.includes(`possible`)) return `optional`
  return false
}

// Empty callbacks are legal no-ops. Accumulation distinguishes an empty final
// call from erasing real grouping that an earlier call established.
const groupingBoundaries = [
  {
    name: `empty-callback-first`,
    expressions: `.groupBy(() => [])`,
    before: true,
    calls: [`empty`],
  },
  {
    name: `empty-callback-last`,
    expressions: `.groupBy(() => [])`,
    before: false,
    calls: [`empty`],
  },
  {
    name: `empty-wrapper-first`,
    expressions: `.groupBy(groupKeys(() => []))`,
    before: true,
    calls: [`empty`],
  },
  {
    name: `empty-wrapper-last`,
    expressions: `.groupBy(groupKeys(() => []))`,
    before: false,
    calls: [`empty`],
  },
  {
    name: `one-then-empty`,
    expressions: `.groupBy(groupKeys(({ groupSource }) => groupSource.id)).groupBy(() => [])`,
    before: true,
    calls: [`nonempty`, `empty`],
  },
  {
    name: `empty-then-one`,
    expressions: `.groupBy(() => []).groupBy(groupKeys(({ groupSource }) => groupSource.id))`,
    before: true,
    calls: [`empty`, `nonempty`],
  },
  {
    name: `callback-one`,
    expressions: `.groupBy(groupKeys(() => [])).groupBy(({ groupSource }) => [groupSource.id])`,
    before: true,
    calls: [`empty`, `nonempty`],
  },
  {
    name: `explicit-context-key`,
    expressions: `.groupBy(groupKeys<ContextFromSource<{ groupSource: typeof rows }>>(({ groupSource }) => groupSource.id))`,
    before: true,
    calls: [`nonempty`],
  },
  ...[`callback`, `wrapper`].flatMap((form) =>
    [`mutable`, `readonly`, `union`].flatMap((list) =>
      [false, true].map((nonempty) => {
        const key = `PublicRef<Row>['id']`
        const declared =
          list === `mutable`
            ? `Array<${key}>`
            : list === `readonly`
              ? `ReadonlyArray<${key}>`
              : `readonly [] | readonly [${key}]`
        const callback = `({ groupSource }): ${declared} => [${nonempty ? `groupSource.id` : ``}]`
        return {
          name: `possible-${form}-${list}-${nonempty ? `one` : `empty`}`,
          expressions: `${form === `callback` ? `.groupBy(groupKeys(() => []))` : ``}.groupBy(${form === `wrapper` ? `groupKeys(${callback})` : callback})`,
          before: true,
          calls:
            form === `callback`
              ? ([`empty`, `possible`] as const)
              : ([`possible`] as const),
        } as const
      }),
    ),
  ),
  {
    name: `nonempty-tuple-wrapper`,
    expressions: `.groupBy(groupKeys(({ groupSource }): readonly [PublicRef<Row>['id']] => [groupSource.id]))`,
    before: true,
    calls: [`nonempty`],
  },
  {
    name: `one-then-possible`,
    expressions: `.groupBy(groupKeys(({ groupSource }) => groupSource.id)).groupBy((): ReadonlyArray<PublicRef<Row>['id']> => [])`,
    before: true,
    calls: [`nonempty`, `possible`],
  },
  {
    name: `possible-then-one`,
    expressions: `.groupBy((): ReadonlyArray<PublicRef<Row>['id']> => []).groupBy(groupKeys(({ groupSource }) => groupSource.id))`,
    before: true,
    calls: [`possible`, `nonempty`],
  },
] as const
// Seven through nine are neighboring depths around the former cutoff. Sixteen
// distinguishes supporting that one boundary from merely moving it one level.
const aggregateDepths = [0, 7, 8, 9, 10, 16] as const
// Conditional inline fields are legal authoring choices. Array/array forms
// distinguish wrapper identity from value shape; singleton forms retain absence.
const wrappedAggregateForms = [
  `coalesce`,
  `case-scalar`,
  `case-object`,
  `case-default`,
  `case-condition`,
  `eq`,
  `gt`,
  `gte`,
  `lt`,
  `lte`,
  `and`,
  `or`,
  `not`,
  `isNull`,
  `isUndefined`,
  `inArray`,
  `like`,
  `ilike`,
  `upper`,
  `lower`,
  `length`,
  `concat`,
  `add`,
  `subtract`,
  `multiply`,
  `divide`,
  `nested`,
] as const
const wrappedAggregateKinds = [`aggregate`, `ordinary`] as const
const inlineChoices = [
  `array-array`,
  `array-materialized`,
  `array-single`,
] as const
const authoredStates = authoredCollisions.flatMap(({ name }) =>
  authoredPaths.flatMap((path) =>
    authoredKinds.map((kind) => `authored/${name}/${path}/${kind}`),
  ),
)
const states = [
  ...wrappedAggregateForms.flatMap((form) =>
    wrappedAggregateKinds.map((kind) => `wrapped-aggregate/${form}/${kind}`),
  ),
  ...inlineChoices.map((choice) => `inline-choice/${choice}`),
  ...authoredStates,
  ...authoredStates.map((state) => `structured-refs/${state}`),
  ...authoredCollisions.flatMap(({ name }) =>
    authoredKinds.map((kind) => `selected-context/${name}/${kind}`),
  ),
  ...groupedForms.flatMap((form) =>
    authoredCollisions.map(({ name }) => `grouped/${form}/${name}`),
  ),
  ...groupingBoundaries.flatMap(({ name }) =>
    authoredCollisions.map(
      (collision) => `grouping-boundary/${name}/${collision.name}`,
    ),
  ),
  ...aggregateDepths.flatMap((depth) =>
    [`none`, `key`].map((collision) => `aggregate-depth/${depth}/${collision}`),
  ),
  ...projections.flatMap((shape) =>
    compositions.map((composition) => `root/${shape}/${composition}`),
  ),
  ...inlineShapes.flatMap((shape) =>
    inlineForms
      .filter(
        (form) => form !== `facade` || (shape !== `array` && shape !== `date`),
      )
      .map((form) => `inline/${shape}/${form}`),
  ),
  `nested-query-ref`,
  `nested-index-ref`,
  `union-removal`,
  `construction-admitted`,
]
// Each finite history has one numeric token. A state keeps that token once,
// so repeated observations preserve the original per-history checkpoint count.
const historiesByState = new Map<string, Set<number>>(
  states.map((state) => [state, new Set<number>()]),
)
let publicTypeHistory = 0
let publicTypesEntered = false
afterAll(() => {
  if (!publicTypesEntered) return
  expect(
    [...historiesByState].filter(([, histories]) => histories.size < 1),
    `virtual row public types`,
  ).toEqual([])
  console.info(
    `virtual row public types reach`,
    Object.fromEntries(
      [...historiesByState].map(([state, histories]) => [
        state,
        histories.size,
      ]),
    ),
  )
})

function rootQuery(shape: (typeof projections)[number], alias: string) {
  const base = `new Query().from({ ${alias}: rows })`
  if (shape === `functional-direct`)
    return `${base}.fn.select(({ ${alias} }) => ${alias})`
  const select = shape.startsWith(`functional`) ? `fn.select` : `select`
  const result = shape.endsWith(`spread`)
    ? `{ ...${alias} }`
    : `{ id: ${alias}.id, payload: ${alias}.profile }`
  return `${base}.${select}(({ ${alias} }) => (${result}))`
}
function composeQuery(query: string, peer: string, composition: string) {
  const outer = (input: string) => `new Query().from({ outer: ${input} })`
  if (composition === `query-ref`) return outer(query)
  if (composition === `nested-query-ref`) return outer(outer(query))
  if (composition === `functional-query-ref`)
    return `${outer(query)}.fn.select(({ outer }) => outer)`
  if (composition === `joined-query-ref`)
    return `new Query().from({ anchor: rows }).innerJoin({ outer: ${query} }, ({ anchor, outer }) => eq(anchor.id, outer.id)).select(({ outer }) => outer)`
  const union = `new Query().unionAll(${query}, ${peer})`
  if (composition === `union`) return union
  if (composition === `union-last`)
    return `new Query().unionAll(${peer}, ${query})`
  if (composition === `union-query-ref`) return outer(union)
  return query
}

function nestedRecord(depth: number, value: string): string {
  let result = `{ total: ${value} }`
  for (let index = depth - 1; index >= 0; index--)
    result = `{ n${index}: ${result} }`
  return result
}

/**
 * The independent type law is textual because TypeScript checks generated
 * consumers. Normalize distributes only the outer record; nested values retain
 * optionality, unions and opaque types. No cast or never-running runtime path
 * supplies a missing type. Callback bodies are compiled with real inference.
 */
function consumerSource(
  shape: TypeShape,
  only?: ReadonlySet<string>,
): {
  source: string
  states: Array<string>
} {
  const witnesses: Array<string> = []
  const observed: Array<string> = []
  const addWitness = (state: string, source: string) => {
    if (!only || only.has(state)) {
      witnesses.push(`// Oracle state: ${state}\n${source}`)
      observed.push(state)
    }
  }
  const row = `{ id: ${shape.key}; value: ${shape.value}; profile${shape.optional ? `?` : ``}: Profile; nullable: Profile | null; tags: Array<${shape.value}>; createdAt: Date }`
  for (const projection of projections) {
    for (const composition of compositions) {
      const query = composeQuery(
        rootQuery(projection, `chosen`),
        rootQuery(projection, `peer`),
        composition,
      )
      const expected = projection.endsWith(`projection`)
        ? `{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``} }`
        : `Row`
      addWitness(
        `root/${projection}/${composition}`,
        `{
        const collection = createLiveQueryCollection({ query: ${query} });
        type Observation_${projection.replaceAll(`-`, `_`)}_${composition.replaceAll(`-`, `_`)} = Assert<SameShape<Normalize<typeof collection.toArray[number]>, Normalize<Published<${expected}>>>>;
      }`,
      )
    }
  }
  for (const projection of inlineShapes) {
    let query = `new Query().from({ child: rows }).where(({ child }) => eq(child.id, parent.id))`
    let value = `Row`
    let rowBearing = true
    if (projection === `selected-whole`)
      query += `.select(({ child }) => child)`
    if (projection === `nullable-whole`) {
      query += `.leftJoin({ missing: rows }, ({ child, missing }) => eq(child.id, missing.id)).select(({ missing }) => missing)`
      value = `Published<Row> | Missing<Published<Row>>`
    }
    if (projection === `object`) {
      query += `.select(({ child }) => ({ value: child.value }))`
      value = `{ value: ${shape.value} }`
      rowBearing = false
    }
    if (projection === `nested-object`) {
      query += `.select(({ child }) => ({ nested: { value: child.value } }))`
      value = `{ nested: { value: ${shape.value} } }`
      rowBearing = false
    }
    if (projection === `array` || projection === `date`) {
      query += `.select(({ child }) => child.${projection === `array` ? `tags` : `createdAt`})`
      value = projection === `array` ? `Array<${shape.value}>` : `Date`
      rowBearing = false
    }
    for (const form of inlineForms) {
      // Collection-valued includes require record projections. Arrays and Date
      // are legal only in the inline forms, as query construction enforces.
      if (
        form === `facade` &&
        (projection === `array` || projection === `date`)
      )
        continue
      // Facades publish ordinary projections as rows; inline forms do not.
      const expected =
        projection === `nullable-whole`
          ? form === `facade`
            ? `Published<Row | Missing<Row>>`
            : value
          : rowBearing || form === `facade`
            ? `Published<${value}>`
            : value
      const selected =
        form === `findOne`
          ? `materialize((${query}).findOne())`
          : `${form === `facade` ? `include` : form}(${query})`
      const observation =
        form === `facade`
          ? `typeof collection.toArray[number]['children']['toArray'][number]`
          : form === `findOne`
            ? `typeof collection.toArray[number]['children']`
            : `typeof collection.toArray[number]['children'][number]`
      addWitness(
        `inline/${projection}/${form}`,
        `{
        const collection = createLiveQueryCollection({ query: new Query().from({ parent: rows }).select(({ parent }) => ({ id: parent.id, children: ${selected} })) });
        type Observation_${projection.replaceAll(`-`, `_`)}_${form} = Assert<SameShape<Normalize<${observation}>, Normalize<${expected}${form === `findOne` ? ` | undefined` : ``}>>>;
      }`,
      )
    }
  }
  // Each legal syntax uses the same independent declared-shape judgment.
  // Check callback inputs and inline values before checking publication's
  // replacement of reserved names. Compiler acceptance is observed separately.
  for (const collision of authoredCollisions) {
    for (const path of authoredPaths) {
      for (const kind of authoredKinds) {
        const state = `authored/${collision.name}/${path}/${kind}`
        const expected = `{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``}${collision.fields.replaceAll(` as const`, ``).replaceAll(`, $`, `; $`)} }`
        const base = `new Query().from({ authoredSource: rows }).${kind === `functional` ? `fn.select` : `select`}(({ authoredSource }) => ({ id: authoredSource.id, payload: authoredSource.profile${collision.fields} }))`
        const query =
          path === `query-ref`
            ? `new Query().from({ value: ${base} })`
            : path === `nested-query-ref`
              ? `new Query().from({ value: new Query().from({ intermediate: ${base} }).select(({ intermediate }) => intermediate) })`
              : path === `join`
                ? `new Query().from({ anchor: rows }).innerJoin({ value: ${base} }, ({ anchor, value }) => eq(anchor.id, value.id))`
                : `new Query().unionAll(${base})`
        const callback = path === `union` ? `input` : `input.value`
        const havingExpected =
          path === `union`
            ? `${expected} & { $selected: ${expected} }`
            : expected
        addWitness(
          state,
          `{
          const query = ${query};
          const checked = query.fn.where(input => {
            type Observed = Assert<SameShape<Normalize<typeof ${callback}>, Normalize<${expected}>>>;
            return true;
          }).fn.having(input => {
            type Observed = Assert<SameShape<Normalize<typeof ${callback}>, Normalize<${havingExpected}>>>;
            return true;
          }).fn.select(input => {
            type Observed = Assert<SameShape<Normalize<typeof ${callback}>, Normalize<${expected}>>>;
            return ${callback};
          });
          const published = createLiveQueryCollection({ query: checked });
          type PublishedObservation = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<${expected}>>>>;
          const inline = createLiveQueryCollection({ query: new Query().from({ parent: rows }).select(({ parent }) => ({ id: parent.id, children: toArray(new Query().from({ typedChild: checked }).where(({ typedChild }) => eq(typedChild.id, parent.id))) })) });
          type InlineObservation = Assert<SameShape<Normalize<typeof inline.toArray[number]['children'][number]>, Normalize<${expected}>>>;
        }`,
        )
        // A whole Ref can unwrap its original value while individual fields
        // still have wrong types. Read each authored reserved field into an
        // ordinary output and separately check that absent names stay absent.
        const names = [...collision.fields.matchAll(/(\$\w+):/g)].map(
          (match) => match[1]!,
        )
        const expectedNames = names.length
          ? names.map((name) => `'${name}'`).join(` | `)
          : `never`
        const selectedFields = names
          .map((name) => `read_${name.slice(1)}: ${callback}.${name}`)
          .join(`, `)
        const expectedFields = collision.fields
          .replaceAll(` as const`, ``)
          .replaceAll(`, $`, `; read_`)
        const reservedCheck = `type ReservedNames = Assert<Equal<Extract<keyof typeof ${callback}, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, ${expectedNames}>>;`
        const selectBody = `${reservedCheck}
            return { id: ${callback}.id, payload: ${callback}.payload${selectedFields ? `, ${selectedFields}` : ``} };`
        const groupFields = [
          `${callback}.id`,
          `${callback}.payload`,
          ...names.map((name) => `${callback}.${name}`),
        ].join(`, `)
        addWitness(
          `structured-refs/${state}`,
          `{
          const query = ${query};
          const filtered = query.where(input => {
            ${reservedCheck}
            return eq(1, 1);
          });
          const checked = filtered.select(input => { ${selectBody} });
          const havingChecked = filtered.groupBy(groupKeys(input => [${groupFields}])).having(input => {
            ${reservedCheck}
            return eq(1, 1);
          }).select(input => { ${selectBody} });
          const published = createLiveQueryCollection({ query: checked });
          const publishedHaving = createLiveQueryCollection({ query: havingChecked });
          type Observed = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``}${expectedFields} }>>>>;
          type HavingObserved = Assert<SameShape<Normalize<typeof publishedHaving.toArray[number]>, Normalize<Published<{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``}${expectedFields} }>>>>;
        }`,
        )
      }
    }
  }
  // $selected is the other structured ref root for an authored value. Its
  // public Ref field carrier must retain each declared literal and no new names.
  for (const collision of authoredCollisions) {
    for (const kind of authoredKinds) {
      const names = [...collision.fields.matchAll(/(\$\w+):\s*('.*?')/g)]
      const expectedNames = names.length
        ? names.map((match) => `'${match[1]}'`).join(` | `)
        : `never`
      const checks = names
        .map(
          (match) =>
            `type Read_${match[1]!.slice(1)} = Assert<SameShape<typeof $selected.${match[1]}, PublicRef<{ value: ${match[2]} }>['value']>>;`,
        )
        .join(`\n`)
      const fields = names
        .map((match) => `${match[1]}: prepared.${match[1]}`)
        .join(`, `)
      const groupFields = [
        `prepared.id`,
        `prepared.payload`,
        ...names.map((match) => `prepared.${match[1]}`),
      ].join(`, `)
      addWitness(
        `selected-context/${collision.name}/${kind}`,
        `{
        const authored = new Query().from({ authoredSource: rows }).${kind === `functional` ? `fn.select` : `select`}(({ authoredSource }) => ({ id: authoredSource.id, payload: authoredSource.profile${collision.fields} }));
        const query = new Query().from({ prepared: authored })
          .groupBy(groupKeys(({ prepared }) => [${groupFields}]))
          .select(({ prepared }) => ({ id: prepared.id, payload: prepared.payload${fields ? `, ${fields}` : ``} }))
          .having(({ $selected }) => {
            type ReservedNames = Assert<Equal<Extract<keyof typeof $selected, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, ${expectedNames}>>;
            ${checks}
            return eq(1, 1);
          });
        const published = createLiveQueryCollection({ query });
        type Observed = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<{ id: ${shape.key}; payload: Profile${shape.optional ? ` | undefined` : ``}${collision.fields.replaceAll(` as const`, ``).replaceAll(`, $`, `; $`)} }>>>>;
      }`,
      )
    }
  }
  // Grouping generates a missing key independently of Collection enrichment.
  // An explicitly authored key still wins before publication. These neighbors
  // prevent the intermediate-value fix from removing aggregate QueryRef keys.
  for (const form of groupedForms) {
    for (const collision of authoredCollisions) {
      const fields = collision.fields
      const selected =
        form === `aggregate`
          ? `total: count(groupSource.id)`
          : `id: groupSource.id`
      const value = form === `aggregate` ? `total: number` : `id: ${shape.key}`
      const expected = `{ ${value}${fields.replaceAll(` as const`, ``).replaceAll(`, $`, `; $`)} }${collision.name === `key` || collision.name === `all` ? `` : ` & { readonly $key: string | number }`}`
      const base = `new Query().from({ groupSource: rows })`
      const query =
        form === `keys-first`
          ? `${base}.groupBy(groupKeys(({ groupSource }) => groupSource.id)).select(({ groupSource }) => ({ ${selected}${fields} }))`
          : `${base}.select(({ groupSource }) => ({ ${selected}${fields} }))${form === `keys-last` ? `.groupBy(groupKeys(({ groupSource }) => groupSource.id))` : ``}`
      addWitness(
        `grouped/${form}/${collision.name}`,
        `{
        const query = new Query().from({ grouped: ${query} }).fn.select(({ grouped }) => {
          type Observed = Assert<SameShape<Normalize<typeof grouped>, Normalize<${expected}>>>;
          return grouped;
        });
        const published = createLiveQueryCollection({ query });
        type Observed = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<${expected}>>>>;
      }`,
      )
    }
  }
  // The model uses the possibilities in the declared list, independently of
  // the inferred context marker. A broad list admits empty and nonempty values,
  // so its generated key is optional. Each form constructs both runtime choices.
  // Prior definite grouping remains definite when a later list may be empty.
  for (const grouping of groupingBoundaries) {
    for (const collision of authoredCollisions) {
      const base = `new Query().from({ groupSource: rows })`
      const selection = `.select(({ groupSource }) => ({ id: groupSource.id${collision.fields} }))`
      const query = grouping.before
        ? `${base}${grouping.expressions}${selection}`
        : `${base}${selection}${grouping.expressions}`
      const declared = `{ id: ${shape.key}${collision.fields.replaceAll(` as const`, ``).replaceAll(`, $`, `; $`)} }`
      const keyed = groupingKeyFor(grouping.calls)
      const expected = `${declared}${keyed && collision.name !== `key` && collision.name !== `all` ? ` & { readonly $key${keyed === `optional` ? `?` : ``}: string | number }` : ``}`
      addWitness(
        `grouping-boundary/${grouping.name}/${collision.name}`,
        `{
        const inner = ${query};
        const checked = new Query().from({ grouped: inner }).fn.select(({ grouped }) => {
          type Observed = Assert<SameShape<Normalize<typeof grouped>, Normalize<${expected}>>>;
          return grouped;
        });
        const published = createLiveQueryCollection({ query: checked });
        type PublishedObservation = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<${expected}>>>>;
        const inline = createLiveQueryCollection({ query: new Query().from({ parent: rows }).select(({ parent }) => ({ id: parent.id, children: toArray(new Query().from({ typedChild: inner }).where(({ typedChild }) => eq(typedChild.id, parent.id))) })) });
        type InlineObservation = Assert<SameShape<Normalize<typeof inline.toArray[number]['children'][number]>, Normalize<${expected}>>>;
      }`,
      )
    }
  }
  // A count directly present under ordinary records is still an aggregate of
  // this selection. Query helpers stop traversal into a separate query scope.
  for (const depth of aggregateDepths) {
    for (const collision of authoredCollisions.filter(
      ({ name }) => name === `none` || name === `key`,
    )) {
      const selection = nestedRecord(depth, `count(aggregateSource.id)`)
      const declared = nestedRecord(depth, `number`)
      const totalPath = [
        ...Array.from({ length: depth }, (_, index) => `n${index}`),
        `total`,
      ].join(`.`)
      const expected =
        collision.name === `key`
          ? `${declared} & { $key: 'authored-key' }`
          : `${declared} & { readonly $key: string | number }`
      addWitness(
        `aggregate-depth/${depth}/${collision.name}`,
        `{
        const inner = new Query().from({ aggregateSource: rows }).select(({ aggregateSource }) => ({ ...${selection}${collision.fields} }));
        const checked = new Query().from({ grouped: inner }).fn.select(({ grouped }) => {
          type Observed = Assert<SameShape<Normalize<typeof grouped>, Normalize<${expected}>>>;
          return grouped;
        });
        const published = createLiveQueryCollection({ query: checked });
        type PublishedObservation = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<${expected}>>>>;
        const numericParents = new Query().from({ numericParent: rows }).select(() => ({ id: 1 }));
        const inline = createLiveQueryCollection({ query: new Query().from({ parent: numericParents }).select(({ parent }) => ({ id: parent.id, children: toArray(new Query().from({ typedChild: inner }).where(({ typedChild }) => eq(typedChild.${totalPath}, parent.id))) })) });
        type InlineObservation = Assert<SameShape<Normalize<typeof inline.toArray[number]['children'][number]>, Normalize<${expected}>>>;
      }`,
      )
    }
  }
  // The expected child shape comes from its declared selection. Choosing a
  // wrapper at construction cannot expose that wrapper in a callback's values.
  for (const choice of inlineChoices) {
    const right =
      choice === `array-array`
        ? `toArray(leaves)`
        : choice === `array-materialized`
          ? `materialize(leaves)`
          : `materialize(leaves.findOne())`
    const child = `{ label: ${shape.value} }`
    const children =
      choice === `array-single`
        ? `Array<${child}> | ${child} | undefined`
        : `Array<${child}>`
    addWitness(
      `inline-choice/${choice}`,
      `{
      const chooseArray = rows.size === 0;
      const inner = new Query().from({ item: rows }).select(({ item }) => {
        const leaves = new Query().from({ leaf: rows }).where(({ leaf }) => eq(leaf.id, item.id)).select(({ leaf }) => ({ label: leaf.value }));
        return { id: item.id, children: chooseArray ? toArray(leaves) : ${right} };
      });
      const query = new Query().from({ result: inner }).fn.select(({ result }) => {
        type Observed = Assert<SameShape<Normalize<typeof result>, Normalize<{ id: ${shape.key}; children: ${children} }>>>;
        return result;
      });
      const published = createLiveQueryCollection({ query });
      type PublishedObservation = Assert<SameShape<Normalize<typeof published.toArray[number]>, Normalize<Published<{ id: ${shape.key}; children: ${children} }>>>>;
    }`,
    )
  }
  // The current grouped-intermediate contract supplies a missing generated
  // key for visible and wrapped aggregates alike. Ordinary controls retain
  // their authored shape. The expression's value does not choose key ownership.
  for (const form of wrappedAggregateForms) {
    for (const kind of wrappedAggregateKinds) {
      const aggregate = kind === `aggregate`
      const argument = aggregate ? `count(item.id)` : `rows.size`
      const text = `concat(${argument})`
      let expression: string
      let value: string
      if (form === `coalesce` || form === `nested`) {
        expression = `coalesce(${argument}, 0)`
        if (form === `nested`)
          for (let i = 0; i < 10; i++) expression = `coalesce(${expression}, 0)`
        value = `number`
      } else if (form === `case-scalar` || form === `case-default`) {
        expression =
          form === `case-default`
            ? `caseWhen(false, 0, ${argument})`
            : `caseWhen(true, ${argument}, 0)`
        value = `number`
      } else if (form === `case-object`) {
        expression = `caseWhen(true, { n: ${argument} }, { n: 0 })`
        value = `{ n: number }`
      } else if (form === `case-condition`) {
        expression = `caseWhen(gt(${argument}, 0), { n: 1 }, { n: 0 })`
        value = `{ n: number }`
      } else if ([`eq`, `gt`, `gte`, `lt`, `lte`].includes(form)) {
        expression = `${form}(${argument}, 0)`
        value = `boolean`
      } else if (form === `and` || form === `or`) {
        expression = `${form}(true, gt(${argument}, 0), true)`
        value = `boolean`
      } else if (
        form === `not` ||
        form === `isNull` ||
        form === `isUndefined`
      ) {
        expression = `${form}(${argument})`
        value = `boolean`
      } else if (form === `inArray`) {
        expression = `inArray(${argument}, [0, 1])`
        value = `boolean`
      } else if (form === `like` || form === `ilike`) {
        expression = `${form}(${text}, 'a')`
        value = `boolean`
      } else if (form === `upper` || form === `lower` || form === `length`) {
        expression = `${form}(${text})`
        value = form === `length` ? `number` : `string`
      } else if (form === `concat`) {
        expression = `concat(${text}, 'b')`
        value = `string`
      } else {
        expression = `${form}(${argument}, 1)`
        value = form === `divide` ? `number | null` : `number`
      }
      const expected = `{ value: ${value}${aggregate ? `; readonly $key: string | number` : ``} }`
      addWitness(
        `wrapped-aggregate/${form}/${kind}`,
        `{
        const inner = new Query().from({ item: rows }).select(({ item }) => ({ value: ${expression} }));
        const query = new Query().from({ wrapped: inner }).fn.select(({ wrapped }) => {
          type WrappedObservation = Assert<SameShape<Normalize<Omit<typeof wrapped, 'value'>>, Normalize<Omit<${expected}, 'value'>>>>;
          type WrappedValue = Assert<${value.startsWith(`{`) ? `SameShape` : `Equal`}<typeof wrapped.value, ${value}>>;
          return { checked: true };
        });
        const published = createLiveQueryCollection({ query: inner });
        type WrappedPublication = Assert<SameShape<Normalize<Omit<typeof published.toArray[number], 'value'>>, Normalize<Omit<Published<${expected}>, 'value'>>>>;
        type PublishedValue = Assert<${value.startsWith(`{`) ? `SameShape` : `Equal`}<typeof published.toArray[number]['value'], ${value}>>;
      }`,
      )
    }
  }
  return {
    source: `
    import { BTreeIndex, Query, caseWhen, coalesce, max, gt, gte, lt, lte, and, or, not, isNull, isUndefined, inArray, like, ilike, upper, lower, length, concat, add, subtract, multiply, divide, count, createCollection, createLiveQueryCollection, eq, groupKeys, include, materialize, toArray } from '@tanstack/db';
    import type { ContextFromSource, Ref as PublicRef, WithoutVirtualProps } from '@tanstack/db';
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
    type Assert<T extends true> = T;
    type Normalize<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;
    type Published<T> = T extends unknown ? Omit<T, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'> & { readonly $key: string | number; readonly $collectionId: string; readonly $origin: 'local' | 'remote'; readonly $hasPendingWrites: boolean } : never;
    type Missing<T> = T extends unknown ? { [K in keyof T]?: undefined } : never;
    type IsAny<T> = 0 extends (1 & T) ? true : false;
    type HasAny<T> = IsAny<T> extends true ? true : T extends Date ? true extends { [K in Exclude<keyof T, keyof Date>]-?: HasAny<T[K]> }[Exclude<keyof T, keyof Date>] ? true : false : T extends ReadonlyArray<infer V> ? HasAny<V> : T extends object ? true extends { [K in keyof T]-?: HasAny<T[K]> }[keyof T] ? true : false : false;
    type AllKeys<T> = T extends unknown ? keyof T : never;
    type ReadonlyKeys<T> = T extends unknown ? { [K in keyof T]-?: Equal<{ [P in K]: T[P] }, { -readonly [P in K]: T[P] }> extends true ? never : K }[keyof T] : never;
    // Keep modifiers attached to each union member. A global readonly-key union
    // would let a correct member hide a mutable sibling with the same key.
    type RecordSignature<T> = { keys: keyof T; fields: { [K in keyof T]-?: { value: Signature<T[K]>; readonly: K extends ReadonlyKeys<T> ? true : false; optional: {} extends Pick<T, K> ? true : false } } };
    type Signature<T> = T extends Date ? { opaque: 'Date'; extras: RecordSignature<Omit<T, keyof Date>> } : T extends ReadonlyArray<infer V> ? { array: Signature<V>; mutable: T extends Array<unknown> ? true : false; extras: RecordSignature<Omit<T, keyof Array<unknown> | keyof ReadonlyArray<unknown>>> } : T extends object ? RecordSignature<T> : { scalar: T };
    type SameShape<A, B> = true extends HasAny<A> | HasAny<B> ? false : [Signature<A>] extends [Signature<B>] ? [Signature<B>] extends [Signature<A>] ? Equal<AllKeys<A>, AllKeys<B>> : false : false;
    type MutableOne<T> = T extends { kind: 'b' } ? Omit<T, '$key'> & { $key: string | number } : T;
    type Profile = { label: ${shape.value} };
    type Base = ${row};
    type Row = Base${shape.union ? ` & ({ kind: 'a'; left: string } | { kind: 'b'; right: number })` : ``};
    const rows = createCollection<Row>({ getKey: row => row.id, sync: { sync: ({ markReady }) => { markReady(); } } });
    type Removal = Assert<SameShape<Normalize<WithoutVirtualProps<Published<Row>>>, Normalize<Row>>>;
    const nestedQuery = createLiveQueryCollection({ query: new Query().from({ row: rows }).select(({ row }) => {
      type NestedHasNoVirtualNames = Assert<Equal<Extract<keyof NonNullable<typeof row.profile>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, never>>;
      type RootNames = Assert<Equal<Extract<keyof typeof row, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>>;
      type RemovedAlias = Assert<Equal<Extract<keyof typeof row, '$synced'>, never>>;
      return { id: row.id, label: row.nullable?.label, sourceKey: row.$key, sourceCollectionId: row.$collectionId, sourceOrigin: row.$origin, sourcePending: row.$hasPendingWrites };
    }) });
    type CallbackValues = Assert<SameShape<Normalize<typeof nestedQuery.toArray[number]>, Normalize<Published<{ id: ${shape.key}; label: ${shape.value} | undefined; sourceKey: string | number; sourceCollectionId: string; sourceOrigin: 'local' | 'remote'; sourcePending: boolean }>>>>;
    rows.createIndex(row => {
      type RootNames = Assert<Equal<Extract<keyof typeof row, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>>;
      type RemovedAlias = Assert<Equal<Extract<keyof typeof row, '$synced'>, never>>;
      type NestedHasNoVirtualNames = Assert<Equal<Extract<keyof NonNullable<typeof row.profile>, '$key' | '$collectionId' | '$origin' | '$hasPendingWrites'>, never>>;
      return row.id;
    }, { indexType: BTreeIndex });
    ${witnesses.join(`\n`)}
  `,
    states: [
      ...observed,
      `nested-query-ref`,
      `nested-index-ref`,
      `union-removal`,
    ],
  }
}

// Cache only dependency syntax trees. The consumer gets a new tree per history;
// TypeScript retains full diagnostics and their exact file/span/code identity.
const packageRoot = resolve(process.cwd())
const filename = resolve(packageRoot, `tests/__generated-virtual-types.ts`)
const config = ts.readConfigFile(
  resolve(packageRoot, `tsconfig.json`),
  ts.sys.readFile,
)
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, `\n`),
  )
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
const options: ts.CompilerOptions = {
  ...parsed.options,
  noEmit: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  paths: {
    ...parsed.options.paths,
    '@tanstack/db': [resolve(packageRoot, `src/index.ts`)],
  },
}
const host = ts.createCompilerHost(options)
const original = host.getSourceFile.bind(host)
const cached = new Map<string, ts.SourceFile>()
let generated = ``
host.getSourceFile = (
  name,
  languageVersion,
  onError,
  shouldCreateNewSourceFile,
) => {
  if (name === filename)
    return ts.createSourceFile(name, generated, languageVersion, true)
  let source = cached.get(name)
  if (!source) {
    source = original(name, languageVersion, onError, shouldCreateNewSourceFile)
    if (source) cached.set(name, source)
  }
  return source
}
let previous: ts.Program | undefined
function compileConsumer(source: string): ReadonlyArray<ts.Diagnostic> {
  generated = source
  const program = ts.createProgram([filename], options, host, previous)
  previous = program
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  return diagnostics
}
/**
 * Compiler acceptance alone does not establish a legal query grammar. Erase
 * types and replay the exact consumer through public query/index construction.
 * This supplies no row/publication evidence. Every acquired Collection registers
 * cleanup immediately, including if a later construction throws.
 */
async function checkConsumerConstruction(source: string): Promise<void> {
  const cleanups: Array<() => Promise<void>> = []
  const track = <
    T extends { cleanup: (options: { dependents: boolean }) => Promise<void> },
  >(
    collection: T,
  ): T => {
    cleanups.unshift(() => collection.cleanup({ dependents: true }))
    return collection
  }
  await checkWithCleanup(() => {
    const parsedConsumer = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.ES2022,
      true,
    )
    const importFree = ts.createPrinter().printFile(
      ts.factory.updateSourceFile(
        parsedConsumer,
        parsedConsumer.statements.filter(
          (statement) => !ts.isImportDeclaration(statement),
        ),
      ),
    )
    // Reparse printed source before binding. Removing imports only in an emit
    // transform leaves CommonJS's bound import substitutions in the output.
    const { outputText, diagnostics = [] } = ts.transpileModule(importFree, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
      reportDiagnostics: true,
    })
    checkConsumer(diagnostics)
    const api = {
      ...publicDb,
      createCollection: (
        ...arguments_: Parameters<typeof publicDb.createCollection>
      ) => track(publicDb.createCollection(...arguments_)),
      createLiveQueryCollection: (
        ...arguments_: Parameters<typeof publicDb.createLiveQueryCollection>
      ) => track(publicDb.createLiveQueryCollection(...arguments_)),
    }
    // The source is generated solely from this file's closed grammar. Imports
    // are removed by TypeScript's AST transform; public exports supply bindings.
    const construct = new Function(
      `api`,
      `exports`,
      `const { BTreeIndex, Query, caseWhen, coalesce, max, gt, gte, lt, lte, and, or, not, isNull, isUndefined, inArray, like, ilike, upper, lower, length, concat, add, subtract, multiply, divide, count, createCollection, createLiveQueryCollection, eq, groupKeys, include, materialize, toArray } = api;\n${outputText}`,
    )
    construct(api, {})
  }, cleanups)
}
function checkConsumer(diagnostics: ReadonlyArray<ts.Diagnostic>): void {
  expect(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => `\n`,
    }),
  ).toBe(``)
}
// The former case body, unchanged: compile one generated consumer against the
// public types, admit its construction, and record the states it entered.
async function judgePublicTypeShape(shape: TypeShape): Promise<void> {
  publicTypesEntered = true
  publicTypeHistory++
  const consumer = consumerSource(shape)
  await checkConsumerConstruction(consumer.source)
  historiesByState.get(`construction-admitted`)!.add(publicTypeHistory)
  const diagnostics = compileConsumer(consumer.source)
  for (const state of consumer.states)
    historiesByState.get(state)!.add(publicTypeHistory)
  checkConsumer(diagnostics)
}

const publicTypesLaw = `Generated consumers of the public API observe the row and value types that the virtual-field boundary promises, and their constructions are admitted at runtime.`

oracleProperty({
  id: `virtual-row-fields-types.public-types`,
  law: {
    statement: publicTypesLaw,
    authority: `The Collection virtual-field boundary and reserved public row fields in packages/db/src/query/live/ARCHITECTURE.md (boundary-only metadata, maintainer decision of 2026-11-05), stated at the start of this owner.`,
    limits: `The enumerated key, value, optional, and union type shapes of this file's closed consumer grammar.`,
  },
  owns: [`src/index.ts`],
  histories: typeShapes,
  label: (shape) =>
    `preserves generated public row/value types: ${JSON.stringify(shape)}`,
  resolve: (shape) => ({ shape }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(publicTypesLaw, plan, observe, () =>
      judgePublicTypeShape(plan.shape),
    ),
  check: forwardAssertionJudgment,
  // The old tests allowed 30 seconds each. The framework's determinism test
  // runs every third shape twice in one test, about 16 compilations, so the
  // property's per-test limit covers that test too.
  timeout: 300_000,
})

// Feed a hostile type observation through the actual compiler/checker. Altering
// only the expected law emulates leaked value metadata or lost nullability;
// the legal production query remains identical to its accepted neighbor.
const hostileTypeObservations = [
  `value-metadata`,
  `lost-nullability`,
  `one-branch-readonly`,
  `nested-any`,
  `date-metadata-any`,
  `nested-optional-metadata`,
  `nested-readonly`,
] as const

// The former case body, unchanged: a hostile expected law over the identical
// legal query must fail only its generated Assert constraints.
function judgeHostileTypeObservation(
  fault: (typeof hostileTypeObservations)[number],
): void {
  const consumer = consumerSource(
    fault === `one-branch-readonly` ? typeShapes[1]! : typeShapes[0]!,
    new Set([
      fault === `value-metadata`
        ? `inline/object/toArray`
        : fault === `lost-nullability`
          ? `inline/nullable-whole/toArray`
          : fault === `date-metadata-any`
            ? `inline/date/toArray`
            : `root/functional-direct/direct`,
    ]),
  )
  checkConsumer(compileConsumer(consumer.source))
  const wrong =
    fault === `value-metadata`
      ? consumer.source.replace(
          `Normalize<{ value: string }>>>`,
          `Normalize<Published<{ value: string }>>>>`,
        )
      : fault === `lost-nullability`
        ? consumer.source.replaceAll(
            `Published<Row> | Missing<Published<Row>>`,
            `Published<Row>`,
          )
        : fault === `one-branch-readonly`
          ? consumer.source.replace(
              `Normalize<Published<Row>>>>`,
              `Normalize<MutableOne<Published<Row>>>>>`,
            )
          : fault === `date-metadata-any`
            ? consumer.source.replace(
                `Normalize<Date>>>`,
                `Normalize<Date & { readonly $key: any }>>>`,
              )
            : fault === `nested-optional-metadata`
              ? consumer.source.replace(
                  `Normalize<Published<Row>>>>`,
                  `Normalize<Published<Omit<Row, 'profile'> & { profile: Profile & { readonly $key?: string } }>>>>`,
                )
              : fault === `nested-readonly`
                ? consumer.source.replace(
                    `Normalize<Published<Row>>>>`,
                    `Normalize<Published<Omit<Row, 'profile'> & { profile: { readonly label: string } }>>>>`,
                  )
                : consumer.source.replace(
                    `type Profile = { label: string };`,
                    `type Profile = { label: any };`,
                  )
  expect(wrong).not.toBe(consumer.source)
  const diagnostics = compileConsumer(wrong)
  // A syntax/setup error cannot stand in for a rejected wrong type. Require
  // only failed Assert constraints in this generated consumer's law aliases.
  expect(diagnostics.length).toBeGreaterThan(0)
  for (const diagnostic of diagnostics) {
    expect(diagnostic.file?.fileName).toBe(filename)
    expect(diagnostic.code).toBe(2344)
    const text = diagnostic.file!.text
    const lineStart = text.lastIndexOf(`\n`, diagnostic.start) + 1
    const lineEnd = text.indexOf(`\n`, diagnostic.start)
    expect(text.slice(lineStart, lineEnd)).toMatch(
      /type (Observation_|Removal|CallbackValues)/,
    )
  }
  expect(() => checkConsumer(diagnostics)).toThrow()
}

const hostileTypesLaw = `The public-type check rejects each hostile type observation through the actual compiler, with only the generated consumer's law aliases failing.`

oracleProperty({
  id: `virtual-row-fields-types.hostile-observations`,
  law: {
    statement: hostileTypesLaw,
    authority: `The Collection virtual-field boundary and reserved public row fields in packages/db/src/query/live/ARCHITECTURE.md (boundary-only metadata, maintainer decision of 2026-11-05), stated at the start of this owner.`,
    limits: `The seven enumerated hostile observations over two legal type shapes.`,
  },
  owns: [`src/index.ts`],
  histories: hostileTypeObservations,
  label: (fault) => `rejects a hostile public type observation: ${fault}`,
  resolve: (fault) => ({ fault }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(hostileTypesLaw, plan, observe, () =>
      judgeHostileTypeObservation(plan.fault),
    ),
  check: forwardAssertionJudgment,
  // The old tests allowed 30 seconds each; the determinism test runs one
  // observation in eight twice in one test.
  timeout: 120_000,
})

// Grammar controls preserve the admission checkpoint that exposed two invalid
// early fixtures. Their legal neighbors run the identical generated body.
const admissionLaw = `A generated consumer's construction is admitted at runtime only when it is a legal query: an illegal neighbor of an admitted construction is rejected at admission.`
const admissionFaults = [`non-record-facade`, `missing-index-type`] as const

oracleProperty({
  id: `virtual-row-fields-types.construction-admission`,
  law: {
    statement: admissionLaw,
    authority: `The Collection virtual-field boundary and reserved public row fields in packages/db/src/query/live/ARCHITECTURE.md (boundary-only metadata, maintainer decision of 2026-11-05), stated at the start of this owner.`,
    limits: `One legal inline array consumer and its two illegal neighbors.`,
  },
  owns: [`src/index.ts`],
  histories: [{ shape: 0, paths: [`inline/array/toArray`] }],
  label: () =>
    `admits the legal generated construction beside its illegal neighbors`,
  resolve: ({ shape, paths }) => ({
    consumer: consumerSource(typeShapes[shape]!, new Set(paths)),
  }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(admissionLaw, plan, observe, () =>
      checkConsumerConstruction(plan.consumer.source),
    ),
  check: forwardAssertionJudgment,
  calibrations: admissionFaults.map((fault) => ({
    name: `rejects an illegal generated construction at admission: ${fault}`,
    law: admissionLaw,
    // The former calibration body. Exactly the old matcher: only a rejection
    // whose message names this fault's admission error counts as the check
    // rejecting the illegal construction; any other outcome fails this
    // calibration, as it failed the old test.
    driver: (plan, observe) =>
      recordAssertionJudgment(admissionLaw, plan, observe, async () => {
        const { consumer } = plan
        const wrong =
          fault === `non-record-facade`
            ? consumer.source.replace(
                `children: toArray(`,
                `children: include(`,
              )
            : consumer.source.replace(`, { indexType: BTreeIndex }`, ``)
        expect(wrong).not.toBe(consumer.source)
        const expected =
          fault === `non-record-facade`
            ? /must select an object when materializing as a Collection/
            : /No index type specified and no defaultIndexType set/
        try {
          await checkConsumerConstruction(wrong)
        } catch (error) {
          if (error instanceof Error && expected.test(error.message))
            rejectAt(`admission ${fault}`, error)
          throw new Error(
            `the illegal construction failed outside the expected rejection: ${String(error)}`,
          )
        }
      }),
  })),
})
