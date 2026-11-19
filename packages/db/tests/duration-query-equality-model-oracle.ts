// The independent Duration equality model and the fixed input grammar of
// duration-query-equality-oracle.test.ts, which states the law and its limits.
// duration-query-equality-calibration.test.ts calibrates the same model. This
// module registers no tests and has no side effects.
import { Temporal } from 'temporal-polyfill'

export const fields = [
  `years`,
  `months`,
  `weeks`,
  `days`,
  `hours`,
  `minutes`,
  `seconds`,
  `milliseconds`,
  `microseconds`,
  `nanoseconds`,
] as const

export function modelEqual(
  left: Temporal.Duration,
  right: Temporal.Duration,
): boolean {
  return fields.every((field) => left[field] === right[field])
}

export type Case = {
  name: string
  stored: Temporal.Duration
  probe: Temporal.Duration
}

export const sameDisplay: Case = {
  name: `seconds versus milliseconds with identical display`,
  stored: Temporal.Duration.from({ seconds: 1 }),
  probe: Temporal.Duration.from({ milliseconds: 1000 }),
}
export const oppositeSigns: Case = {
  name: `opposite signs`,
  stored: Temporal.Duration.from({ seconds: 1 }),
  probe: Temporal.Duration.from({ seconds: -1 }),
}
export const secondFieldChange: Case = {
  name: `same first nonzero field with a changed second field`,
  stored: Temporal.Duration.from({ hours: 1, minutes: 2 }),
  probe: Temporal.Duration.from({ hours: 1, minutes: 3 }),
}

export const cases: ReadonlyArray<Case> = [
  ...fields.flatMap((field) => {
    const stored = Temporal.Duration.from({ [field]: 1 })
    return [
      {
        name: `${field} equal copy`,
        stored,
        probe: Temporal.Duration.from({ [field]: 1 }),
      },
      {
        name: `${field} changed`,
        stored,
        probe: Temporal.Duration.from({ [field]: 2 }),
      },
    ]
  }),
  sameDisplay,
  oppositeSigns,
  secondFieldChange,
]

export function modelKeys({ stored, probe }: Case): Set<string> {
  return new Set(modelEqual(stored, probe) ? [`row`] : [])
}
