const wrapperNames = new WeakMap<object, string>()

export function registerWrapper(value: object, name: string): void {
  wrapperNames.set(value, name)
}

export function getWrapperExpressionName(value: unknown): string | undefined {
  return value !== null && typeof value === `object`
    ? wrapperNames.get(value)
    : undefined
}
