export type ShapeOf<T> = {
  [K in keyof T]: unknown
}

export type FirebaseConversion<I, O> = (value: I) => O

export type FirebaseOptionalConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = {
  [K in keyof InputType as InputType[K] extends OutputType[K]
    ? K
    : never]?: FirebaseConversion<InputType[K], OutputType[K]>
}

export type FirebaseRequiredConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = {
  [K in keyof InputType as InputType[K] extends OutputType[K]
    ? never
    : K]: FirebaseConversion<InputType[K], OutputType[K]>
}

export type FirebaseConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = FirebaseOptionalConversions<InputType, OutputType> &
  FirebaseRequiredConversions<InputType, OutputType>
