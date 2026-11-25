/**
 * A receiving acknowledgment for persistence's ordered health-call queue.
 * `issue` surrounds the real source callback before persistence queues it;
 * `deliver` surrounds that callback when persistence forwards it to core.
 * The target is the calls already issued when `receive` starts. No health
 * value, expected Error, or later provider event decides when it completes.
 */
export type HealthReportCounts = {
  issued: number
  delivered: number
  pending: number
}
type ReportKind = `error` | `healthy`
type PendingReport = {
  kind: ReportKind
  error: unknown
  acknowledge: () => void
  received: Promise<void>
}

export function createHealthReportHandoff(timeoutMs = 2_000) {
  const pending = new Set<PendingReport>()
  let issued = 0
  let delivered = 0
  const counts = (): HealthReportCounts => ({
    issued,
    delivered,
    pending: pending.size,
  })
  return {
    issue(kind: ReportKind, error: unknown, forward: () => void) {
      let acknowledge = () => {}
      const received = new Promise<void>((resolve) => {
        acknowledge = resolve
      })
      pending.add({ kind, error, acknowledge, received })
      issued++
      forward()
    },
    deliver(kind: ReportKind, error: unknown, forward: () => void) {
      const report = [...pending].find(
        (candidate) => candidate.kind === kind && candidate.error === error,
      )
      try {
        forward()
      } finally {
        // A wrapper-owned report has no matching upstream issue. It still
        // reaches core, but does not acknowledge a source-issued call.
        if (report) {
          pending.delete(report)
          delivered++
          report.acknowledge()
        }
      }
    },
    async receive(): Promise<HealthReportCounts> {
      const target = [...pending]
      const targetIssued = issued
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.all(target.map((report) => report.received)),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(
                new Error(
                  `Health report receiving acknowledgment missing: target ${targetIssued}, issued ${issued}, delivered ${delivered}, pending ${pending.size}`,
                ),
              )
            }, timeoutMs)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
      return counts()
    },
    counts,
  }
}
