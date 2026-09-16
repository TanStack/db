/**
 * Oracle owner: the query-builder compile-time suites.
 *
 * Laws and sources: nullable join refs stay nullable when selected whole, and
 * unresolved generic constraints survive joins and both union forms. These
 * laws preserve the reports and prior art from issues 1467 and 1679.
 *
 * Reference and observation: TypeScript structural assignability and
 * `@ts-expect-error` are the independent judges. Product-contract cells cross
 * the public source -> query builder/Collection -> consumer type path. The
 * paired runtime test owns the unmatched-row value witness. Existing generic,
 * heterogeneous-union, join, and nullable-leaf suites remain the broader
 * compatibility owners.
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

      return {
        direct,
        joined,
        sourceUnion,
        branchUnion,
        selectedBranchUnion,
        joinedBranchUnion,
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

    void composeGenericSources
  })

  test(`branch unions keep heterogeneous public result members`, () => {
    type Alpha = { kind: `alpha`; id: string; alphaValue: number }
    type Beta = { kind: `beta`; id: string; betaValue: boolean }

    function composeHeterogeneousBranches(
      alpha: Collection<Alpha, string>,
      beta: Collection<Beta, string>,
      departments: Collection<Department, string>,
    ) {
      const selectedOnly = new Query()
        .unionAll(
          new Query().from({ alpha }).select(({ alpha: row }) => ({
            id: row.id,
          })),
          new Query().from({ beta }).select(({ beta: row }) => ({
            id: row.id,
          })),
        )
        .select(({ id }) => ({ renamed: id }))
        .where((refs) => {
          void refs.$selected.renamed
          void refs.id
          expectTypeOf<
            IsAny<typeof refs.$selected.renamed>
          >().toEqualTypeOf<false>()
          // @ts-expect-error Selected aliases require the $selected namespace.
          void refs.renamed
          return eq(refs.$selected.renamed, refs.id)
        })

      const query = createLiveQueryCollection((q) => {
        const alphaRows = q.from({ alpha }).select(({ alpha: row }) => ({
          kind: row.kind,
          id: row.id,
          alphaValue: row.alphaValue,
        }))
        const betaRows = q.from({ beta }).select(({ beta: row }) => ({
          kind: row.kind,
          id: row.id,
          betaValue: row.betaValue,
        }))
        const union = q.unionAll(alphaRows, betaRows)
        const callbackProjection = union
          .leftJoin(
            { department: departments },
            ({ kind, id, alphaValue, betaValue, department }) => {
              void kind
              void alphaValue
              void betaValue
              return eq(id, department.id)
            },
          )
          .where(({ kind, alphaValue, betaValue }) => {
            void alphaValue
            void betaValue
            return eq(kind, `beta`)
          })
          .select(({ kind, alphaValue, betaValue }) => ({
            kind,
            alphaValue,
            betaValue,
          }))

        type CallbackProjection = QueryResult<typeof callbackProjection>
        expectTypeOf<CallbackProjection[`kind`]>().toEqualTypeOf<
          `alpha` | `beta`
        >()
        expectTypeOf<CallbackProjection[`alphaValue`]>().toEqualTypeOf<number>()
        expectTypeOf<CallbackProjection[`betaValue`]>().toEqualTypeOf<boolean>()

        void callbackProjection
        return union
      })

      type Result = (typeof query.toArray)[number]
      expectTypeOf<IsAny<Result>>().toEqualTypeOf<false>()
      expectTypeOf<Result[`kind`]>().toEqualTypeOf<`alpha` | `beta`>()

      function assertNarrowing(result: Result) {
        if (result.kind === `alpha`) {
          expectTypeOf(result.alphaValue).toEqualTypeOf<number>()
          // @ts-expect-error The beta-only field must not leak across branches.
          void result.betaValue
        } else {
          expectTypeOf(result.betaValue).toEqualTypeOf<boolean>()
          // @ts-expect-error The alpha-only field must not leak across branches.
          void result.alphaValue
        }
      }

      void assertNarrowing
      void selectedOnly
      return query
    }

    void composeHeterogeneousBranches
  })

  test(`mixed branch context kinds retain their callback keys`, () => {
    type Alpha = { id: string; alphaValue: number }
    type Beta = { id: string; betaValue: boolean }
    type Gamma = { id: string; betaId: string; gammaValue: Date }

    function composeMixedBranches(
      alpha: Collection<Alpha, string>,
      beta: Collection<Beta, string>,
      gamma: Collection<Gamma, string>,
    ) {
      const selected = new Query().from({ alpha }).select(({ alpha: row }) => ({
        id: row.id,
        alphaValue: row.alphaValue,
      }))
      const plain = new Query().from({ beta })
      const joined = new Query()
        .from({ gamma })
        .leftJoin({ beta }, ({ gamma: row, beta: joinedBeta }) =>
          eq(row.betaId, joinedBeta.id),
        )

      const query = new Query()
        .unionAll(selected, plain, joined)
        .where(({ alphaValue, betaValue, gamma: gammaRow, beta: betaRow }) => {
          void betaValue
          void gammaRow.id
          void betaRow.id
          return eq(alphaValue, alphaValue)
        })
        .select(
          ({ alphaValue, betaValue, gamma: gammaRow, beta: betaRow }) => ({
            alphaValue,
            betaValue,
            gammaId: gammaRow.id,
            betaId: betaRow.id,
          }),
        )

      type Result = QueryResult<typeof query>
      expectTypeOf<Result[`alphaValue`]>().toEqualTypeOf<number>()
      expectTypeOf<Result[`betaValue`]>().toEqualTypeOf<boolean>()
      expectTypeOf<Result[`gammaId`]>().toEqualTypeOf<string>()
      expectTypeOf<Result[`betaId`]>().toEqualTypeOf<string | undefined>()
      return query
    }

    void composeMixedBranches
  })

  test(`specific query builders remain assignable to erased query builders`, () => {
    function eraseBuilder<T extends { id: string }>(
      source: Collection<T, string>,
    ) {
      const specific = new Query().from({ source })
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
