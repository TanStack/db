import fc from 'fast-check'

// These runner controls inject a wrong observation into the calling owner's
// existing independent check, shrink it, and verify the exact replay protocol.
// They do not add a product campaign or compute an expected product result.
export function runIncludesCalibration<T>(
  property: fc.IAsyncProperty<T>,
  parameters: fc.Parameters<T>,
): Promise<fc.RunDetails<T>> {
  return fc.check(property, parameters)
}
