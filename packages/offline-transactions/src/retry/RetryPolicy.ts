import { NonRetriableError } from "../types"
import { BackoffCalculator } from "./BackoffCalculator"
import type { RetryPolicy } from "../types"

export class DefaultRetryPolicy implements RetryPolicy {
  private backoffCalculator: BackoffCalculator
  private maxRetries: number

  constructor(maxRetries = 10, jitter = true) {
    this.backoffCalculator = new BackoffCalculator(jitter)
    this.maxRetries = maxRetries
  }

  calculateDelay(retryCount: number): number {
    return this.backoffCalculator.calculate(retryCount)
  }

  shouldRetry(error: Error, retryCount: number): boolean {
    if (retryCount >= this.maxRetries) {
      return false
    }

    if (error instanceof NonRetriableError) {
      return false
    }

    if (error.name === `AbortError`) {
      return false
    }

    if (error.message.includes(`401`) || error.message.includes(`403`)) {
      return false
    }

    if (error.message.includes(`422`) || error.message.includes(`400`)) {
      return false
    }

    return true
  }
}
