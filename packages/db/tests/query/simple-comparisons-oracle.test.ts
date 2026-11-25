import { IR, extractSimpleComparisons } from '../../src/index.js'
import { differs, oracleProperty, pass, violation } from '../oracle-config.js'
import type { Observation, Verdict } from '../oracle-config.js'

/**
 * A simple comparison is a field plus an operator and a literal value.
 * docs/reference/functions/extractSimpleComparisons.md excludes complex
 * expressions. The helper must reject a field or computed right operand as a
 * whole expression rather than let an adapter send a different filter.
 *
 * The grammar crosses each supported binary operator with direct/negated
 * forms and with a supported comparison before, after, or absent. The model
 * speaks in terms of the authored value, before the driver creates any IR.
 * The only observation is the public helper's return or rejection.
 */

const operators = [`eq`, `gt`, `gte`, `lt`, `lte`, `in`] as const
const operands = [`value`, `null`, `undefined`, `field`, `computed`] as const
const companionPositions = [`none`, `first`, `last`] as const
const states = [...operands, `negated`, `conjunction`]
const checkpoint = `comparison extraction`
const law = `literal field-value representation`
const complex = `unsupported field-value comparison`
const companion = { field: [`active`], operator: `eq`, value: true }

interface History {
  operator: (typeof operators)[number]
  operand: (typeof operands)[number]
  negated: boolean
  companionPosition: (typeof companionPositions)[number]
}

const histories: Array<History> = operators.flatMap((operator) =>
  operands.flatMap((operand) =>
    [false, true].flatMap((negated) =>
      companionPositions.map((companionPosition) => ({
        operator,
        operand,
        negated,
        companionPosition,
      })),
    ),
  ),
)

function literal(history: History) {
  return history.operand === `null`
    ? null
    : history.operator === `in`
      ? [7, 11]
      : 7
}

// Predict the public result from the declared filter; no IR is inspected.
function model(history: History) {
  if (history.operand !== `value` && history.operand !== `null`) return complex
  const comparison = {
    field: [`a`],
    operator: history.negated ? `not_${history.operator}` : history.operator,
    value: literal(history),
  }
  switch (history.companionPosition) {
    case `first`:
      return [companion, comparison]
    case `last`:
      return [comparison, companion]
    case `none`:
      return [comparison]
  }
}

function rightOperand(history: History): IR.BasicExpression {
  switch (history.operand) {
    case `field`:
      return new IR.PropRef([`b`])
    case `computed`:
      return new IR.Func(`lower`, [new IR.PropRef([`b`])])
    case `undefined`:
      return new IR.Value(undefined)
    default:
      return new IR.Value(literal(history))
  }
}

function drive(
  history: History,
  observe: (point: string, value: unknown) => void,
) {
  const comparison = new IR.Func(history.operator, [
    new IR.PropRef([`a`]),
    rightOperand(history),
  ])
  const target = history.negated ? new IR.Func(`not`, [comparison]) : comparison
  const control = new IR.Func(`eq`, [
    new IR.PropRef([`active`]),
    new IR.Value(true),
  ])
  const condition =
    history.companionPosition === `first`
      ? new IR.Func(`and`, [control, target])
      : history.companionPosition === `last`
        ? new IR.Func(`and`, [target, control])
        : target

  observe(`reach`, history.operand)
  if (history.negated) observe(`reach`, `negated`)
  if (history.companionPosition !== `none`) observe(`reach`, `conjunction`)

  try {
    observe(checkpoint, extractSimpleComparisons(condition))
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes(`requires simple field-value comparisons`)
    ) {
      throw error
    }
    observe(checkpoint, complex)
  }
}

function check(
  _history: History,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof model>,
): Verdict {
  const outcome = trace.find((entry) => entry.checkpoint === checkpoint)
  if (!outcome)
    return violation(checkpoint, `the helper did not report an outcome`, law)
  return differs(checkpoint, law, outcome.value, expected) ?? pass
}

oracleProperty({
  id: `simple-comparisons.field-value`,
  law: {
    statement: `Extraction preserves literal filters and rejects a comparison whose right operand cannot be represented as a supported literal, even when conjoined with an otherwise supported comparison.`,
    authority: `The public extractSimpleComparisons reference rejects complex nested expressions.`,
    limits: `The enumerated binary comparison, negation and AND shapes at the public helper. No backend query execution or general predicate compiler claim.`,
  },
  owns: [`src/query/expression-helpers.ts#extractSimpleComparisons`],
  histories: { enumerated: histories, states },
  label: ({ operator, operand, negated, companionPosition }) =>
    `${negated ? `not ` : ``}${operator} with ${operand}, companion ${companionPosition}`,
  model,
  driver: drive,
  check,
  calibrations: [
    {
      name: `computed right operand decoded as null`,
      law,
      history: { enumerated: `eq with computed, companion none` },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === checkpoint
            ? {
                ...entry,
                value: [{ field: [`a`], operator: `eq`, value: null }],
              }
            : entry,
        ),
    },
  ],
})
