/**
 * Stream health is the incidence of failed streams with retained logical
 * owners, plus an independent connection outage. Releasing a stream claim
 * cannot heal that outage. Only a successful full sync of retained requirements
 * does so (Direct Errors and reportError/reportHealthy). This judgment knows no
 * SDK leases, request counters, rows or receipt machinery. A lease may expose
 * only its first failed stream, so it requires a nonempty, relevant stream
 * witness rather than enumerating inaccessible failures. Unknown causes and
 * missing/extra connection problems are never accepted as that witness.
 */
export type StreamProblem =
  | { kind: `stream`; stream: string; messages?: ReadonlyArray<string> }
  | { kind: `connection`; attempt?: number }
  | { kind: `other` }

// Provider inputs are distinct from adapter health reports. A cold acquisition
// may retire during replay while its receipt is held. A later checkpoint with
// no failed retained requirement heals the connection, while that original
// query still rejects its own acquisition. Pre-ready transport failures keep
// loading rather than becoming a ready source's reported outage.
export type StreamConnectionInput =
  | { kind: `interrupted`; ready: boolean }
  | {
      kind: `checkpoint`
      hasFailedRequirement: boolean
    }

export function streamConnectionOutage(
  inputs: ReadonlyArray<StreamConnectionInput>,
): boolean {
  return inputs.reduce(
    (outage, input) =>
      input.kind === `interrupted`
        ? outage || input.ready
        : outage && input.hasFailedRequirement,
    false,
  )
}

export function streamHealthViolations(
  expected: {
    streams: ReadonlyArray<string>
    connection: boolean
    rejectionOwnsStreams?: boolean
  },
  actual: ReadonlyArray<StreamProblem>,
): Array<string> {
  const violations: Array<string> = []
  const streams = actual.flatMap((problem) =>
    problem.kind === `stream` ? [problem.stream] : [],
  )
  if (actual.some((problem) => problem.kind === `other`))
    violations.push(`unclassified source failure`)
  if (
    actual.some((problem) => problem.kind === `connection`) !==
    expected.connection
  )
    violations.push(`connection outage differs`)
  if (
    streams.some((stream) => !expected.streams.includes(stream)) ||
    (!(expected.rejectionOwnsStreams && streams.length === 0) &&
      (streams.length === 0) !== (expected.streams.length === 0))
  )
    violations.push(`failed stream coverage differs`)
  return violations
}
