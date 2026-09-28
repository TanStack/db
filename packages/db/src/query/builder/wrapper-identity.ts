import {
  assertLocalDbInstance,
  markDbInstance,
} from '../../duplicate-instance-check.js'

const wrapperNames = new WeakMap<object, string>()

export function registerWrapper(value: object, name: string): void {
  markDbInstance(value)
  wrapperNames.set(value, name)
}

export function getWrapperExpressionName(value: unknown): string | undefined {
  assertLocalDbInstance(value)
  return value !== null && typeof value === `object`
    ? wrapperNames.get(value)
    : undefined
}
