import type { CollectionImpl } from '../collection/index.js'
import type {
  CollectionWithQuerySchema,
  InferCollectionType,
} from './builder/types.js'

type QueryableField<TDocument extends object> = Extract<keyof TDocument, string>

type QueryableFieldList<TDocument extends object> = ReadonlyArray<
  QueryableField<TDocument>
>

type KeysFromList<TKeys> =
  TKeys extends ReadonlyArray<infer TKey> ? TKey : never

type ResolveQueryableKeys<
  TDocument extends object,
  TFilterable,
  TSortable,
> = Extract<
  KeysFromList<TFilterable> | KeysFromList<TSortable>,
  QueryableField<TDocument>
>

type ResolveQueryableSchema<
  TDocument extends object,
  TFilterable,
  TSortable,
> = [TFilterable] extends [undefined]
  ? [TSortable] extends [undefined]
    ? TDocument
    : Pick<TDocument, ResolveQueryableKeys<TDocument, TFilterable, TSortable>>
  : Pick<TDocument, ResolveQueryableKeys<TDocument, TFilterable, TSortable>>

export type QueryableFieldsConfig<
  TDocument extends object,
  TFilterable extends QueryableFieldList<TDocument> | undefined = undefined,
  TSortable extends QueryableFieldList<TDocument> | undefined = undefined,
> = {
  filterable?: TFilterable
  sortable?: TSortable
}

/**
 * Adds compile-time queryable field constraints to a collection source.
 *
 * Runtime behavior is unchanged. This only affects the refs available in
 * query callbacks like `where` and `orderBy`.
 */
export function withQueryableFields<
  TCollection extends CollectionImpl<any, any, any, any, any>,
  TFilterable extends
    | QueryableFieldList<InferCollectionType<TCollection>>
    | undefined = undefined,
  TSortable extends
    | QueryableFieldList<InferCollectionType<TCollection>>
    | undefined = undefined,
>(
  collection: TCollection,
  _queryable: QueryableFieldsConfig<
    InferCollectionType<TCollection>,
    TFilterable,
    TSortable
  >,
): CollectionWithQuerySchema<
  TCollection,
  ResolveQueryableSchema<
    InferCollectionType<TCollection>,
    TFilterable,
    TSortable
  >
> {
  return collection as CollectionWithQuerySchema<
    TCollection,
    ResolveQueryableSchema<
      InferCollectionType<TCollection>,
      TFilterable,
      TSortable
    >
  >
}
