/**
 * Oracle owner: the query-builder compile-time suites.
 *
 * Laws and sources: nullable join refs stay nullable when selected whole. In
 * the separately enumerated generic callback cells, unresolved constraints
 * survive direct queries, joins, and both union forms. These laws preserve the
 * reports and prior art from issues 1467 and 1679.
 *
 * Reference and observation: TypeScript structural assignability and
 * `@ts-expect-error` are the independent judges. Product-contract cells cross
 * the public source -> query builder/Collection -> consumer type path. The
 * paired runtime test owns the unmatched-row value witness. Existing generic,
 * join, and nullable-leaf suites remain the broader compatibility owners.
 */
import { describe, expectTypeOf, test } from 'vitest'
import { Query, createLiveQueryCollection, eq } from '../../src/query/index.js'
import type { Collection } from '../../src/collection/index.js'
import type {
  Context,
  QueryBuilder,
  QueryResult,
  RefsForContext,
  WithResult,
} from '../../src/query/index.js'
import type { WithVirtualProps } from '../../src/virtual-props.js'

type Row = { id: string; departmentId: string }
type Department = { id: string; name: string }
type DeepNullable<T> = T extends object
  ? { [K in keyof T]: DeepNullable<T[K]> }
  : T | undefined
type IsAny<T> = 0 extends 1 & T ? true : false
type Selected<TContext extends Context> = WithResult<
  TContext,
  { selectedId: string }
>
type SelectedSourceContext<TContext extends Context> = Pick<
  Selected<TContext>,
  `baseSchema` | `schema` | `fromSourceName`
>

describe(`query API type algebra`, () => {
  test(`select preserves required source fields in generic contexts`, () => {
    function preserveSourceContext<TContext extends Context>(
      selected: Selected<TContext>,
    ) {
      const baseSchema: TContext[`baseSchema`] = selected.baseSchema
      const schema: TContext[`schema`] = selected.schema
      const fromSourceName: TContext[`fromSourceName`] = selected.fromSourceName
      const result: { selectedId: string } = selected.result
      const sourceContext: SelectedSourceContext<TContext> = selected
      return { baseSchema, schema, fromSourceName, result, sourceContext }
    }

    void preserveSourceContext
  })

  test(`whole-object selections preserve nullable join refs`, () => {
    function projectNullableDepartment(
      rows: Collection<Row, string>,
      departments: Collection<Department, string>,
    ) {
      const query = createLiveQueryCollection((q) =>
        q
          .from({ row: rows })
          .leftJoin({ department: departments }, ({ row, department }) =>
            eq(row.departmentId, department.id),
          )
          .select(({ department }) => ({
            department,
            departmentName: department.name,
            nested: { department },
          })),
      )

      const result = query.toArray[0]!
      type ActualDepartment = typeof result.department
      type ExpectedDepartment = WithVirtualProps<Department, string> | undefined

      expectTypeOf<ActualDepartment>().toEqualTypeOf<ExpectedDepartment>()
      expectTypeOf<
        unknown extends ActualDepartment ? true : false
      >().toEqualTypeOf<false>()
      expectTypeOf<
        null extends ActualDepartment ? true : false
      >().toEqualTypeOf<false>()
      expectTypeOf<
        DeepNullable<
          WithVirtualProps<Department, string>
        > extends ActualDepartment
          ? true
          : false
      >().toEqualTypeOf<false>()
      expectTypeOf<
        NonNullable<ActualDepartment>[`name`]
      >().toEqualTypeOf<string>()
      expectTypeOf(result.nested.department).toEqualTypeOf<ExpectedDepartment>()

      const absentLeaf: typeof result.departmentName = undefined

      // @ts-expect-error An unmatched whole-object ref requires a guard.
      result.department.name
      // @ts-expect-error Nested whole-object refs retain the same guard.
      result.nested.department.name

      void absentLeaf
      return query
    }

    void projectNullableDepartment
  })

  test(`branch unions preserve nullable whole-object fields`, () => {
    type Address = { city: string }
    type Person = Row & { address: Address; optionalAddress?: Address }

    function projectNullableBranchFields(
      rowsA: Collection<Person, string>,
      rowsB: Collection<Person, string>,
      othersA: Collection<Person, string>,
      othersB: Collection<Person, string>,
    ) {
      const joinedBranchA = new Query()
        .from({ rowA: rowsA })
        .leftJoin({ otherA: othersA }, ({ rowA, otherA }) =>
          eq(rowA.id, otherA.id),
        )
        .select(({ otherA }) => ({ other: otherA }))
      const joinedBranchB = new Query()
        .from({ rowB: rowsB })
        .leftJoin({ otherB: othersB }, ({ rowB, otherB }) =>
          eq(rowB.id, otherB.id),
        )
        .select(({ otherB }) => ({ other: otherB }))
      const joinedUnion = new Query()
        .unionAll(joinedBranchA, joinedBranchB)
        .select(({ other }) => ({
          other,
          otherAddress: other.address,
        }))

      type JoinedResult = QueryResult<typeof joinedUnion>
      const joinedResult = null as unknown as JoinedResult
      expectTypeOf(joinedResult.other).toEqualTypeOf<
        WithVirtualProps<Person, string> | undefined
      >()
      expectTypeOf(joinedResult.otherAddress).toEqualTypeOf<
        Address | undefined
      >()
      // @ts-expect-error An unmatched branch whole object requires a guard.
      joinedResult.other.id
      if (joinedResult.other) {
        expectTypeOf(joinedResult.other.id).toEqualTypeOf<string>()
        // @ts-expect-error Nested user objects do not gain row virtual props.
        joinedResult.other.address.$key
      }

      const optionalBranchA = new Query()
        .from({ rowA: rowsA })
        .select(({ rowA }) => ({ address: rowA.optionalAddress }))
      const optionalBranchB = new Query()
        .from({ rowB: rowsB })
        .select(({ rowB }) => ({ address: rowB.optionalAddress }))
      const optionalUnion = new Query()
        .unionAll(optionalBranchA, optionalBranchB)
        .select(({ address }) => ({ address }))

      type OptionalResult = QueryResult<typeof optionalUnion>
      const optionalResult = null as unknown as OptionalResult
      expectTypeOf(optionalResult.address).toEqualTypeOf<Address | undefined>()
      // @ts-expect-error An absent selected object requires a guard.
      optionalResult.address.city

      return { joinedUnion, optionalUnion }
    }

    void projectNullableBranchFields
  })

  test(`spreading a nullable join ref widens its leaves`, () => {
    function spreadNullableDepartment(
      rows: Collection<Row, string>,
      departments: Collection<Department, string>,
    ) {
      const query = createLiveQueryCollection((q) =>
        q
          .from({ row: rows })
          .leftJoin({ department: departments }, ({ row, department }) =>
            eq(row.departmentId, department.id),
          )
          .select(({ department }) => ({ ...department })),
      )

      const result = query.toArray[0]!
      expectTypeOf(result.id).toEqualTypeOf<string | undefined>()
      expectTypeOf(result.name).toEqualTypeOf<string | undefined>()
      return query
    }

    void spreadNullableDepartment
  })

  test(`unresolved generic constraints survive joins and union sources`, () => {
    function composeGenericSources<T extends { id: string }>(
      rows: Collection<Row, string>,
      a: Collection<T, string>,
      b: Collection<T, string>,
      id: string,
    ) {
      const direct = new Query().from({ item: a }).where(({ item }) => {
        // @ts-expect-error The generic constraint guarantees no other field.
        void item.notGuaranteed
        return eq(item.id, id)
      })

      const joined = new Query()
        .from({ row: rows })
        .leftJoin({ item: a }, ({ row, item }) => {
          // @ts-expect-error Only the generic constraint is available.
          void item.notGuaranteed
          return eq(row.id, item.id)
        })
        .where(({ item }) => {
          // @ts-expect-error Nullable generic refs expose only guaranteed fields.
          void item.notGuaranteed
          return eq(item.id, id)
        })
        .select(({ item }) => {
          // @ts-expect-error Only the generic constraint is available.
          void item.notGuaranteed
          return { id: item.id }
        })

      const sourceUnion = new Query()
        .unionAll({ a, b })
        .where(({ a: aRef, b: bRef }) => {
          // @ts-expect-error Union refs expose only guaranteed fields.
          void aRef.notGuaranteed
          // @ts-expect-error Union refs expose only guaranteed fields.
          void bRef.notGuaranteed
          return eq(aRef.id, bRef.id)
        })

      const aRows = new Query().from({ a })
      const bRows = new Query().from({ b })
      const branchUnion = new Query()
        .unionAll(aRows, bRows)
        .where(({ id: itemId }) => eq(itemId, id))
        .where((refs) => {
          // @ts-expect-error Branch unions expose no unselected field.
          void refs.notGuaranteed
          return eq(refs.id, id)
        })

      const selectedBranchUnion = new Query()
        .unionAll(aRows, bRows)
        .select(({ id: itemId }) => ({ renamed: itemId }))
        .where((refs) => {
          void refs.id
          void refs.$selected.renamed
          expectTypeOf<IsAny<typeof refs.id>>().toEqualTypeOf<false>()
          expectTypeOf<
            IsAny<typeof refs.$selected.renamed>
          >().toEqualTypeOf<false>()
          // @ts-expect-error Selected aliases require the $selected namespace.
          void refs.renamed
          // @ts-expect-error Only the generic constraint is available.
          void refs.notGuaranteed
          return eq(refs.id, refs.$selected.renamed)
        })

      const joinedBranchUnion = new Query()
        .unionAll(aRows, bRows)
        .leftJoin({ row: rows }, ({ id: itemId, row }) => {
          expectTypeOf<IsAny<typeof itemId>>().toEqualTypeOf<false>()
          expectTypeOf<IsAny<typeof row.id>>().toEqualTypeOf<false>()
          // @ts-expect-error The joined source declares no other field.
          void row.notGuaranteed
          return eq(itemId, row.id)
        })
        .where((refs) => {
          void refs.id
          void refs.row.id
          expectTypeOf<IsAny<typeof refs.id>>().toEqualTypeOf<false>()
          expectTypeOf<IsAny<typeof refs.row.id>>().toEqualTypeOf<false>()
          // @ts-expect-error Only the generic constraint is available.
          void refs.notGuaranteed
          return eq(refs.id, refs.row.id)
        })
        .select(({ id: itemId, row }) => ({ id: itemId, rowId: row.id }))

      const rightJoinedBranchUnion = new Query()
        .unionAll(aRows, bRows)
        .rightJoin({ row: rows }, ({ id: itemId, row }) => eq(itemId, row.id))
        .select(({ id: itemId }) => ({ id: itemId }))

      return {
        direct,
        joined,
        sourceUnion,
        branchUnion,
        selectedBranchUnion,
        joinedBranchUnion,
        rightJoinedBranchUnion,
      }
    }

    type Concrete = ReturnType<
      typeof composeGenericSources<{ id: string; concrete: number }>
    >
    type JoinedId = QueryResult<Concrete[`joined`]>[`id`]
    type DirectConcrete = QueryResult<Concrete[`direct`]>[`concrete`]
    type SourceAId = NonNullable<
      QueryResult<Concrete[`sourceUnion`]>[`a`]
    >[`id`]
    type SourceAConcrete = NonNullable<
      QueryResult<Concrete[`sourceUnion`]>[`a`]
    >[`concrete`]
    type SourceBId = NonNullable<
      QueryResult<Concrete[`sourceUnion`]>[`b`]
    >[`id`]
    type BranchId = QueryResult<Concrete[`branchUnion`]>[`id`]
    type BranchConcrete = QueryResult<Concrete[`branchUnion`]>[`concrete`]
    type SelectedBranchId = QueryResult<
      Concrete[`selectedBranchUnion`]
    >[`renamed`]
    type JoinedBranchId = QueryResult<Concrete[`joinedBranchUnion`]>[`id`]
    type JoinedBranchRowId = QueryResult<Concrete[`joinedBranchUnion`]>[`rowId`]
    type RightJoinedBranchId = QueryResult<
      Concrete[`rightJoinedBranchUnion`]
    >[`id`]
    expectTypeOf<DirectConcrete>().toEqualTypeOf<number>()
    expectTypeOf<IsAny<JoinedId>>().toEqualTypeOf<false>()
    expectTypeOf<JoinedId>().toEqualTypeOf<string | undefined>()
    expectTypeOf<IsAny<SourceAId>>().toEqualTypeOf<false>()
    expectTypeOf<SourceAId>().toEqualTypeOf<string>()
    expectTypeOf<IsAny<SourceBId>>().toEqualTypeOf<false>()
    expectTypeOf<SourceBId>().toEqualTypeOf<string>()
    expectTypeOf<SourceAConcrete>().toEqualTypeOf<number>()
    expectTypeOf<IsAny<BranchId>>().toEqualTypeOf<false>()
    expectTypeOf<BranchId>().toEqualTypeOf<string>()
    expectTypeOf<BranchConcrete>().toEqualTypeOf<number>()
    expectTypeOf<SelectedBranchId>().toEqualTypeOf<string>()
    expectTypeOf<JoinedBranchId>().toEqualTypeOf<string>()
    expectTypeOf<JoinedBranchRowId>().toEqualTypeOf<string | undefined>()
    expectTypeOf<RightJoinedBranchId>().toEqualTypeOf<string | undefined>()

    void composeGenericSources
  })

  test(`specific query builders remain assignable to erased query builders`, () => {
    function eraseBuilder<T extends { id: string }>(
      source: Collection<T, string>,
    ) {
      const specific = new Query().unionAll(
        new Query().from({ source }),
        new Query().from({ source }),
      )
      const erased: QueryBuilder<any> = specific
      return erased
    }

    void eraseBuilder
  })

  test(`exact nullish schema leaves stay exact`, () => {
    type NullishRow = { id: string; nullValue: null; undefinedValue: undefined }
    type ExactNullishContext = {
      baseSchema: { nullValue: null; undefinedValue: undefined }
      schema: { nullValue: null; undefinedValue: undefined }
      fromSourceName: `nullValue`
      hasJoins: false
    }
    type ExactNullishRefs = RefsForContext<ExactNullishContext>

    function projectNullishLeaves(source: Collection<NullishRow, string>) {
      const query = createLiveQueryCollection((q) =>
        q.from({ row: source }).select(({ row }) => ({
          nullValue: row.nullValue,
          undefinedValue: row.undefinedValue,
        })),
      )
      const result = query.toArray[0]!
      expectTypeOf(result.nullValue).toEqualTypeOf<null>()
      expectTypeOf(result.undefinedValue).toEqualTypeOf<undefined>()
      return query
    }

    expectTypeOf<ExactNullishRefs[`nullValue`]>().not.toBeNever()
    expectTypeOf<ExactNullishRefs[`undefinedValue`]>().not.toBeNever()
    void projectNullishLeaves
  })

  test(`branch unions preserve intrinsic nullish fields through nullable joins`, () => {
    type BranchRow = {
      id: string
      exactNull: null
      exactUndefined: undefined
      nullableText: string | null
      nullableObject: { label: string } | null
    }

    function projectNullableBranchUnion(
      a: Collection<BranchRow, string>,
      b: Collection<BranchRow, string>,
      rows: Collection<{ id: string }, string>,
    ) {
      const branch = (source: Collection<BranchRow, string>) =>
        new Query().from({ source }).select(({ source: value }) => ({
          id: value.id,
          exactNull: value.exactNull,
          exactUndefined: value.exactUndefined,
          nullableText: value.nullableText,
          nullableObject: value.nullableObject,
        }))
      const union = new Query().unionAll(branch(a), branch(b))
      const rightJoined = union
        .rightJoin({ row: rows }, ({ id, row }) => eq(id, row.id))
        .select(
          ({ exactNull, exactUndefined, nullableText, nullableObject }) => ({
            exactNull,
            exactUndefined,
            nullableText,
            nullableObject,
          }),
        )
      const fullJoined = union
        .fullJoin({ row: rows }, ({ id, row }) => eq(id, row.id))
        .select(
          ({ exactNull, exactUndefined, nullableText, nullableObject }) => ({
            exactNull,
            exactUndefined,
            nullableText,
            nullableObject,
          }),
        )

      type RightResult = QueryResult<typeof rightJoined>
      type FullResult = QueryResult<typeof fullJoined>
      expectTypeOf<RightResult[`exactNull`]>().toEqualTypeOf<null | undefined>()
      expectTypeOf<RightResult[`exactUndefined`]>().toEqualTypeOf<undefined>()
      expectTypeOf<RightResult[`nullableText`]>().toEqualTypeOf<
        string | null | undefined
      >()
      expectTypeOf<RightResult[`nullableObject`]>().toEqualTypeOf<
        { label: string } | null | undefined
      >()
      expectTypeOf<FullResult[`exactNull`]>().toEqualTypeOf<null | undefined>()
      expectTypeOf<FullResult[`exactUndefined`]>().toEqualTypeOf<undefined>()
      expectTypeOf<FullResult[`nullableText`]>().toEqualTypeOf<
        string | null | undefined
      >()
      expectTypeOf<FullResult[`nullableObject`]>().toEqualTypeOf<
        { label: string } | null | undefined
      >()

      const result = null as unknown as RightResult
      if (result.nullableObject) {
        expectTypeOf(result.nullableObject.label).toEqualTypeOf<string>()
        // @ts-expect-error Nested user objects do not gain row virtual props.
        result.nullableObject.$key
      }

      return { rightJoined, fullJoined }
    }

    void projectNullableBranchUnion
  })

  test(`an explicit undefined refs schema falls back to the query schema`, () => {
    type ExplicitUndefinedRefsContext = {
      baseSchema: { row: Row }
      schema: { row: Row }
      refsSchema: undefined
      fromSourceName: `row`
      hasJoins: false
    }

    function useSchemaFallback(
      refs: RefsForContext<ExplicitUndefinedRefsContext>,
    ) {
      void refs.row.id
    }

    void useSchemaFallback
  })
})
