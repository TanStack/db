/**
 * Shared value-domain model for the SQLite reopen and expression-index owners.
 * Fixture ranks specify semantic order independently of SQL and DB comparators;
 * kind plus canonical text specifies equality. Equal ranks with different text
 * preserve the PlainDate calendar distinction. Endpoints and adjacent values
 * challenge ISO lexical order, floating-point nanoseconds, and signed years.
 * These bounded tables do not claim native-host or arbitrary calendar coverage.
 */
import { Temporal } from 'temporal-polyfill'
import { IR } from '@tanstack/db'

export { Temporal }

export const temporalFamilies = [
  {
    kind: `Instant`,
    name: `nanoseconds`,
    texts: [
      `1970-01-01T00:00:00Z`,
      `1970-01-01T00:00:00.000000001Z`,
      `1970-01-01T00:00:00.000000002Z`,
    ],
    ranks: [0, 1, 2],
  },
  {
    kind: `Instant`,
    name: `negative`,
    texts: [
      `1969-12-31T23:59:59.999999998Z`,
      `1969-12-31T23:59:59.999999999Z`,
      `1970-01-01T00:00:00Z`,
    ],
    ranks: [0, 1, 2],
  },
  {
    kind: `Instant`,
    name: `endpoints`,
    texts: [
      `-271821-04-20T00:00:00Z`,
      `1970-01-01T00:00:00Z`,
      `+275760-09-13T00:00:00Z`,
    ],
    ranks: [0, 1, 2],
  },
  {
    kind: `PlainDate`,
    name: `calendars`,
    texts: [`2026-01-02`, `2026-01-02[u-ca=japanese]`, `2026-01-03`],
    ranks: [0, 0, 1],
  },
  {
    kind: `PlainDate`,
    name: `signed-years`,
    texts: [`-000001-12-31`, `0000-01-01`, `0001-01-01`],
    ranks: [0, 1, 2],
  },
  {
    kind: `PlainDate`,
    name: `endpoints`,
    texts: [`-271821-04-19`, `1970-01-01`, `+275760-09-13`],
    ranks: [0, 1, 2],
  },
] as const

export type TemporalFamily = (typeof temporalFamilies)[number]

export function temporalValue(family: TemporalFamily, index: number) {
  const text = family.texts[index]!
  return family.kind === `Instant`
    ? Temporal.Instant.from(text)
    : Temporal.PlainDate.from(text)
}

export function observeTemporal(value: unknown): unknown {
  if (value instanceof Temporal.Instant)
    return { kind: `Instant`, text: value.toString() }
  if (value instanceof Temporal.PlainDate)
    return { kind: `PlainDate`, text: value.toString() }
  if (Array.isArray(value)) return value.map(observeTemporal)
  if (value !== null && typeof value === `object`) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        observeTemporal(entry),
      ]),
    )
  }
  return value
}

/** Real IR constructs the request; only literal fixture ranks/text judge it. */
export function temporalQueryCases(family: TemporalFamily) {
  const ref = new IR.PropRef([`stamp`])
  const literal = new IR.Value(temporalValue(family, 1))
  const eq = new IR.Func<boolean>(`eq`, [ref, literal])
  const gt = new IR.Func<boolean>(`gt`, [ref, literal])
  const expected = (predicate: (index: number) => boolean) =>
    family.texts.flatMap((_, i) => (predicate(i) ? [`row-${i}`] : []))
  return [
    ...([`eq`, `gt`, `gte`, `lt`, `lte`] as const).map((operator) => ({
      name: operator,
      where: new IR.Func<boolean>(operator, [ref, literal]),
      expectedKeys: expected((i) =>
        operator === `eq`
          ? family.texts[i] === family.texts[1]
          : operator === `gt`
            ? family.ranks[i]! > family.ranks[1]
            : operator === `gte`
              ? family.ranks[i]! >= family.ranks[1]
              : operator === `lt`
                ? family.ranks[i]! < family.ranks[1]
                : family.ranks[i]! <= family.ranks[1],
      ),
    })),
    {
      name: `in`,
      where: new IR.Func<boolean>(`in`, [
        ref,
        new IR.Value([temporalValue(family, 1)]),
      ]),
      expectedKeys: expected((i) => family.texts[i] === family.texts[1]),
    },
    {
      name: `batched-in`,
      where: new IR.Func<boolean>(`in`, [
        ref,
        new IR.Value([
          ...Array.from({ length: 900 }, () => temporalValue(family, 0)),
          temporalValue(family, 1),
        ]),
      ]),
      expectedKeys: expected(
        (i) =>
          family.texts[i] === family.texts[0] ||
          family.texts[i] === family.texts[1],
      ),
    },
    {
      name: `not-eq`,
      where: new IR.Func<boolean>(`not`, [eq]),
      expectedKeys: expected((i) => family.texts[i] !== family.texts[1]),
    },
    {
      name: `not-in`,
      where: new IR.Func<boolean>(`not`, [
        new IR.Func(`in`, [ref, new IR.Value([temporalValue(family, 1)])]),
      ]),
      expectedKeys: expected((i) => family.texts[i] !== family.texts[1]),
    },
    {
      name: `not-gt`,
      where: new IR.Func<boolean>(`not`, [gt]),
      expectedKeys: expected((i) => family.ranks[i]! <= family.ranks[1]),
    },
    {
      name: `or`,
      where: new IR.Func<boolean>(`or`, [eq, gt]),
      expectedKeys: expected(
        (i) =>
          family.texts[i] === family.texts[1] ||
          family.ranks[i]! > family.ranks[1],
      ),
    },
    {
      name: `and`,
      where: new IR.Func<boolean>(`and`, [
        new IR.Func(`not`, [eq]),
        new IR.Func(`gte`, [ref, literal]),
      ]),
      expectedKeys: expected(
        (i) =>
          family.texts[i] !== family.texts[1] &&
          family.ranks[i]! >= family.ranks[1],
      ),
    },
    {
      name: `field-eq`,
      where: new IR.Func<boolean>(`eq`, [ref, new IR.PropRef([`target`])]),
      expectedKeys: expected((i) => family.texts[i] === family.texts[1]),
    },
  ]
}
