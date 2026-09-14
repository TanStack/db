// Render authored schemas separately from the expected-value model below.
// No framework code or Zod parsing supplies expected handler input.
export function mutationInputSchema(program, hasValue) {
  const contract = program.inputContract
  const value = hasValue
    ? `value:z.number().int()${contract ? `.transform(value=>value+${contract.offset})` : ''},`
    : ''
  if (!contract) return `z.object({${value}})`
  const detail = `z.object({label:z.string().trim().min(1),weight:z.number().int().default(${contract.defaultWeight})}).${contract.unknown}()`
  return `z.object({${value}details:${detail},entries:z.array(${detail})}).${contract.unknown}()`
}

export function mutationInput(program, step) {
  const input =
    step.kind === 'delete'
      ? {}
      : {
          value: step.value + (step.kind === 'invalid' ? 0.5 : 0),
        }
  if (!program.inputContract) return input
  const detail = (label) => ({
    label: `  ${label}  `,
    ...(step.weight === undefined ? {} : { weight: step.weight }),
  })
  input.details = detail(step.label ?? 'detail')
  input.entries = (step.labels ?? ['entry']).map(detail)
  // These names are arbitrary input, not a framework list of forbidden fields.
  const extra = { [program.inputContract.extraKey]: 'caller supplied' }
  if (step.extraAt === 'root') Object.assign(input, extra)
  if (step.extraAt === 'object') Object.assign(input.details, extra)
  if (step.extraAt === 'array' && input.entries.length)
    Object.assign(input.entries[0], extra)
  return input
}

export function expectedInput(program, input) {
  const contract = program.inputContract
  if ('value' in input && !Number.isInteger(input.value))
    return { valid: false, path: ['input', 'value'] }
  if (!contract) return { valid: true, value: structuredClone(input) }
  const extra = contract.extraKey
  if (!input.details.label.trim())
    return { valid: false, path: ['input', 'details', 'label'] }
  if (contract.unknown === 'strict' && extra in input.details)
    return { valid: false, path: ['input', 'details'] }
  for (const [index, entry] of input.entries.entries()) {
    if (!entry.label.trim())
      return { valid: false, path: ['input', 'entries', index, 'label'] }
    if (contract.unknown === 'strict' && extra in entry)
      return { valid: false, path: ['input', 'entries', index] }
  }
  if (contract.unknown === 'strict' && extra in input)
    return { valid: false, path: ['input'] }
  const keepExtra = (value) =>
    contract.unknown === 'passthrough' && extra in value
      ? { [extra]: value[extra] }
      : {}
  const detail = (value) => ({
    label: value.label.trim(),
    weight: value.weight ?? contract.defaultWeight,
    ...keepExtra(value),
  })
  return {
    valid: true,
    value: {
      ...('value' in input ? { value: input.value + contract.offset } : {}),
      details: detail(input.details),
      entries: input.entries.map(detail),
      ...keepExtra(input),
    },
  }
}
