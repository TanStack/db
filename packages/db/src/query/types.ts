import type {
  ConditionOperand,
  ExplicitLiteral,
  FunctionCall,
  LiteralValue,
  Select,
} from "./schema.js"

// Input is analogous to a table in a SQL database
// A Schema is a set of named Inputs
export type Input = Record<string, unknown>
export type Schema = Record<string, Input>

// Context is a Schema with a default input
export type Context<
  TBaseSchema extends Schema = Schema,
  TSchema extends Schema = Schema,
> = {
  baseSchema: TBaseSchema
  schema: TSchema
  default?: keyof TSchema
  result?: Record<string, unknown>
  hasJoin?: boolean
}

// Helper types

export type Flatten<T> = {
  [K in keyof T]: T[K]
} & {}

type UniqueSecondLevelKeys<T> = {
  [K in keyof T]: Exclude<
    keyof T[K],
    // all keys in every branch except K
    {
      [P in Exclude<keyof T, K>]: keyof T[P]
    }[Exclude<keyof T, K>]
  >
}[keyof T]

type InputNames<TSchema extends Schema> = RemoveIndexSignature<{
  [I in keyof TSchema]: I
}>[keyof RemoveIndexSignature<{
  [I in keyof TSchema]: I
}>]

type UniquePropertyNames<TSchema extends Schema> = UniqueSecondLevelKeys<
  RemoveIndexSignature<TSchema>
>

export type RemoveIndexSignature<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : K]: T[K]
}

// Fully qualified references like "@employees.id"
type QualifiedReferencesOfSchemaString<TSchema extends Schema> =
  RemoveIndexSignature<{
    [I in keyof TSchema]: {
      [P in keyof RemoveIndexSignature<
        TSchema[I]
      >]: `@${string & I}.${string & P}`
    }[keyof RemoveIndexSignature<TSchema[I]>]
  }>

type QualifiedReferenceString<TContext extends Context<Schema>> =
  QualifiedReferencesOfSchemaString<
    TContext[`schema`]
  >[keyof QualifiedReferencesOfSchemaString<TContext[`schema`]>]

// Fully qualified references like { col: '@employees.id' }
type QualifiedReferencesOfSchemaObject<TSchema extends Schema> =
  RemoveIndexSignature<{
    [I in keyof TSchema]: {
      [P in keyof RemoveIndexSignature<TSchema[I]>]: {
        col: `${string & I}.${string & P}`
      }
    }[keyof RemoveIndexSignature<TSchema[I]>]
  }>

type QualifiedReferenceObject<TContext extends Context<Schema>> =
  QualifiedReferencesOfSchemaObject<
    TContext[`schema`]
  >[keyof QualifiedReferencesOfSchemaObject<TContext[`schema`]>]

type QualifiedReference<TContext extends Context<Schema>> =
  | QualifiedReferenceString<TContext>
  | QualifiedReferenceObject<TContext>

type DefaultReferencesOfSchemaString<
  TSchema extends Schema,
  TDefault extends keyof TSchema,
> = RemoveIndexSignature<{
  [P in keyof TSchema[TDefault]]: `@${string & P}`
}>

type DefaultReferenceString<TContext extends Context<Schema>> =
  TContext[`default`] extends undefined
    ? never
    : DefaultReferencesOfSchemaString<
        TContext[`schema`],
        Exclude<TContext[`default`], undefined>
      >[keyof DefaultReferencesOfSchemaString<
        TContext[`schema`],
        Exclude<TContext[`default`], undefined>
      >]

type DefaultReferencesOfSchemaObject<
  TSchema extends Schema,
  TDefault extends keyof TSchema,
> = RemoveIndexSignature<{
  [P in keyof TSchema[TDefault]]: { col: `${string & P}` }
}>

type DefaultReferenceObject<TContext extends Context<Schema>> =
  TContext[`default`] extends undefined
    ? never
    : DefaultReferencesOfSchemaObject<
        TContext[`schema`],
        Exclude<TContext[`default`], undefined>
      >[keyof DefaultReferencesOfSchemaObject<
        TContext[`schema`],
        Exclude<TContext[`default`], undefined>
      >]

type DefaultReference<TContext extends Context<Schema>> =
  | DefaultReferenceString<TContext>
  | DefaultReferenceObject<TContext>

type UniqueReferencesOfSchemaString<TSchema extends Schema> =
  RemoveIndexSignature<{
    [I in keyof TSchema]: {
      [P in keyof TSchema[I]]: P extends UniquePropertyNames<TSchema>
        ? `@${string & P}`
        : never
    }[keyof TSchema[I]]
  }>

type UniqueReferenceString<TContext extends Context<Schema>> =
  UniqueReferencesOfSchemaString<
    TContext[`schema`]
  >[keyof UniqueReferencesOfSchemaString<TContext[`schema`]>]

type UniqueReferencesOfSchemaObject<TSchema extends Schema> =
  RemoveIndexSignature<{
    [I in keyof TSchema]: {
      [P in keyof TSchema[I]]: P extends UniquePropertyNames<TSchema>
        ? { col: `${string & P}` }
        : never
    }[keyof TSchema[I]]
  }>

type UniqueReferenceObject<TContext extends Context<Schema>> =
  UniqueReferencesOfSchemaObject<
    TContext[`schema`]
  >[keyof UniqueReferencesOfSchemaObject<TContext[`schema`]>]

type UniqueReference<TContext extends Context<Schema>> =
  | UniqueReferenceString<TContext>
  | UniqueReferenceObject<TContext>

type InputWildcardString<TContext extends Context<Schema>> = Flatten<
  {
    [I in InputNames<TContext[`schema`]>]: `@${I}.*`
  }[InputNames<TContext[`schema`]>]
>

type InputWildcardObject<TContext extends Context<Schema>> = Flatten<
  {
    [I in InputNames<TContext[`schema`]>]: { col: `${I}.*` }
  }[InputNames<TContext[`schema`]>]
>

type InputWildcard<TContext extends Context<Schema>> =
  | InputWildcardString<TContext>
  | InputWildcardObject<TContext>

type AllWildcardString = `@*`
type AllWildcardObject = { col: `*` }
type AllWildcard = AllWildcardString | AllWildcardObject

export type PropertyReferenceString<TContext extends Context<Schema>> =
  | DefaultReferenceString<TContext>
  | QualifiedReferenceString<TContext>
  | UniqueReferenceString<TContext>

export type WildcardReferenceString<TContext extends Context<Schema>> =
  | InputWildcardString<TContext>
  | AllWildcardString

export type PropertyReferenceObject<TContext extends Context<Schema>> =
  | DefaultReferenceObject<TContext>
  | QualifiedReferenceObject<TContext>
  | UniqueReferenceObject<TContext>

export type WildcardReferenceObject<TContext extends Context<Schema>> =
  | InputWildcardObject<TContext>
  | AllWildcardObject

export type PropertyReference<TContext extends Context<Schema>> =
  | DefaultReference<TContext>
  | QualifiedReference<TContext>
  | UniqueReference<TContext>

export type WildcardReference<TContext extends Context<Schema>> =
  | InputWildcard<TContext>
  | AllWildcard

type InputWithProperty<TSchema extends Schema, TProperty extends string> = {
  [I in keyof RemoveIndexSignature<TSchema>]: TProperty extends keyof TSchema[I]
    ? I
    : never
}[keyof RemoveIndexSignature<TSchema>]

export type TypeFromPropertyReference<
  TContext extends Context<Schema>,
  TReference extends PropertyReference<TContext>,
> = TReference extends
  | `@${infer InputName}.${infer PropName}`
  | { col: `${infer InputName}.${infer PropName}` }
  ? InputName extends keyof TContext[`schema`]
    ? PropName extends keyof TContext[`schema`][InputName]
      ? TContext[`schema`][InputName][PropName]
      : never
    : never
  : TReference extends `@${infer PropName}` | { col: `${infer PropName}` }
    ? PropName extends keyof TContext[`schema`][Exclude<
        TContext[`default`],
        undefined
      >]
      ? TContext[`schema`][Exclude<TContext[`default`], undefined>][PropName]
      : TContext[`schema`][InputWithProperty<
          TContext[`schema`],
          PropName
        >][PropName]
    : never

/**
 * Return the key that would be used in the result of the query for a given property
 * reference.
 * - `@id` -> `id`
 * - `@employees.id` -> `id`
 * - `{ col: 'id' }` -> `id`
 * - `{ col: 'employees.id' }` -> `id`
 */
export type ResultKeyFromPropertyReference<
  TContext extends Context<Schema>,
  TReference extends PropertyReference<TContext>,
> = TReference extends `@${infer _InputName}.${infer PropName}`
  ? PropName
  : TReference extends { col: `${infer _InputName}.${infer PropName}` }
    ? PropName
    : TReference extends `@${infer PropName}`
      ? PropName
      : TReference extends { col: `${infer PropName}` }
        ? PropName
        : never

export type InputReference<TContext extends Context<Schema>> = {
  [I in InputNames<TContext[`schema`]>]: I
}[InputNames<TContext[`schema`]>]

export type RenameInput<
  TSchema extends Schema,
  TInput extends keyof TSchema,
  TNewName extends string,
> = Flatten<
  {
    [K in Exclude<keyof TSchema, TInput>]: TSchema[K]
  } & {
    [P in TNewName]: TSchema[TInput]
  }
>

export type MaybeRenameInput<
  TSchema extends Schema,
  TInput extends keyof TSchema,
  TNewName extends string | undefined,
> = TNewName extends undefined
  ? TSchema
  : RenameInput<TSchema, TInput, Exclude<TNewName, undefined>>

/**
 * Helper type to combine result types from each select item in a tuple
 */
export type InferResultTypeFromSelectTuple<
  TContext extends Context<Schema>,
  TSelects extends ReadonlyArray<Select<TContext>>,
> = UnionToIntersection<
  {
    [K in keyof TSelects]: TSelects[K] extends Select<TContext>
      ? InferResultType<TContext, TSelects[K]>
      : never
  }[number]
>

/**
 * Convert a union type to an intersection type
 */
type UnionToIntersection<TUnion> = (
  TUnion extends any ? (x: TUnion) => void : never
) extends (x: infer I) => void
  ? I
  : never

/**
 * Infers the result type from a single select item
 */
type InferResultType<
  TContext extends Context<Schema>,
  TSelect extends Select<TContext>,
> =
  TSelect extends PropertyReferenceString<TContext>
    ? {
        [K in ResultKeyFromPropertyReference<
          TContext,
          TSelect
        >]: TypeFromPropertyReference<TContext, TSelect>
      }
    : TSelect extends WildcardReferenceString<TContext>
      ? TSelect extends `@*`
        ? InferAllColumnsType<TContext>
        : TSelect extends `@${infer TableName}.*`
          ? TableName extends keyof TContext[`schema`]
            ? InferTableColumnsType<TContext, TableName>
            : {}
          : {}
      : TSelect extends {
            [alias: string]:
              | PropertyReference<TContext>
              | FunctionCall<TContext>
          }
        ? {
            [K in keyof TSelect]: TSelect[K] extends PropertyReference<TContext>
              ? TypeFromPropertyReference<TContext, TSelect[K]>
              : TSelect[K] extends FunctionCall<TContext>
                ? InferFunctionCallResultType<TContext, TSelect[K]>
                : never
          }
        : {}

/**
 * Infers the result type for all columns from all tables
 */
type InferAllColumnsType<TContext extends Context<Schema>> = {
  [K in keyof TContext[`schema`]]: {
    [P in keyof TContext[`schema`][K]]: TContext[`schema`][K][P]
  }
}[keyof TContext[`schema`]]

/**
 * Infers the result type for all columns from a specific table
 */
type InferTableColumnsType<
  TContext extends Context<Schema>,
  TTable extends keyof TContext[`schema`],
> = {
  [P in keyof TContext[`schema`][TTable]]: TContext[`schema`][TTable][P]
}

/**
 * Infers the result type for a function call
 */
type InferFunctionCallResultType<
  TContext extends Context<Schema>,
  TFunctionCall extends FunctionCall<TContext>,
> = TFunctionCall extends { SUM: any }
  ? number
  : TFunctionCall extends { COUNT: any }
    ? number
    : TFunctionCall extends { AVG: any }
      ? number
      : TFunctionCall extends { MIN: any }
        ? InferOperandType<TContext, TFunctionCall[`MIN`]>
        : TFunctionCall extends { MAX: any }
          ? InferOperandType<TContext, TFunctionCall[`MAX`]>
          : TFunctionCall extends { DATE: any }
            ? string
            : TFunctionCall extends { JSON_EXTRACT: any }
              ? unknown
              : TFunctionCall extends { JSON_EXTRACT_PATH: any }
                ? unknown
                : TFunctionCall extends { UPPER: any }
                  ? string
                  : TFunctionCall extends { LOWER: any }
                    ? string
                    : TFunctionCall extends { COALESCE: any }
                      ? InferOperandType<TContext, TFunctionCall[`COALESCE`]>
                      : TFunctionCall extends { CONCAT: any }
                        ? string
                        : TFunctionCall extends { LENGTH: any }
                          ? number
                          : TFunctionCall extends { ORDER_INDEX: any }
                            ? number
                            : unknown

/**
 * Infers the type of an operand
 */
type InferOperandType<
  TContext extends Context<Schema>,
  TOperand extends ConditionOperand<TContext>,
> =
  TOperand extends PropertyReference<TContext>
    ? TypeFromPropertyReference<TContext, TOperand>
    : TOperand extends LiteralValue
      ? TOperand
      : TOperand extends ExplicitLiteral
        ? TOperand[`value`]
        : TOperand extends FunctionCall<TContext>
          ? InferFunctionCallResultType<TContext, TOperand>
          : TOperand extends Array<ConditionOperand<TContext>>
            ? InferOperandType<TContext, TOperand[number]>
            : unknown
