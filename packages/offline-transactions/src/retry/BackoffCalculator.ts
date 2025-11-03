export class BackoffCalculator {
  private jitter: boolean

  constructor(jitter = true) {
    this.jitter = jitter
  }

  calculate(retryCount: number): number {
    const baseDelay = Math.min(1000 * Math.pow(2, retryCount), 60000)
    const jitterMultiplier = this.jitter ? Math.random() * 0.3 : 0
    return Math.floor(baseDelay * (1 + jitterMultiplier))
  }
}
