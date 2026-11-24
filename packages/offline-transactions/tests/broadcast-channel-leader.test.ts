// Supplemental example for the BroadcastChannel fallback. The law-driven
// coverage is broadcast-channel-leader-oracle.property.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { BroadcastChannelLeader } from '../src/coordination/BroadcastChannelLeader'

const observed = (result: Promise<boolean>) => {
  const outcome: { value?: boolean } = {}
  void result.then((value) => {
    outcome.value = value
  })
  return outcome
}

describe(`BroadcastChannelLeader`, () => {
  it(`releases and queues a new election when a gain listener releases and requests again`, async () => {
    vi.useFakeTimers()
    // The leader schedules through window, which fake timers leave alone here.
    const timers = [
      vi
        .spyOn(window, `setTimeout`)
        .mockImplementation(((callback: () => void, delay?: number) =>
          setTimeout(callback, delay)) as never),
      vi
        .spyOn(window, `setInterval`)
        .mockImplementation(((callback: () => void, delay?: number) =>
          setInterval(callback, delay)) as never),
    ]
    const posted: Array<string> = []
    class ControlledChannel {
      constructor(readonly name: string) {}
      addEventListener() {}
      removeEventListener() {}
      postMessage(message: { type: string }) {
        posted.push(message.type)
      }
      close() {}
    }
    vi.stubGlobal(`BroadcastChannel`, ControlledChannel)
    const leader = new BroadcastChannelLeader(`oracle-reentrant`)
    const heard: Array<boolean> = []
    let armed = true
    let outcome: { value?: boolean } = {}
    let leaderAfterRelease: boolean | undefined
    let electionsAfterRequest = 0
    leader.onLeadershipChange((isLeader) => {
      if (!isLeader || !armed) return
      armed = false
      leader.releaseLeadership()
      outcome = observed(leader.requestLeadership())
      leaderAfterRelease = leader.isLeader()
      electionsAfterRequest = posted.filter(
        (type) => type === `election`,
      ).length
    })
    leader.onLeadershipChange((isLeader) => {
      heard.push(isLeader)
    })
    try {
      void leader.requestLeadership()
      // No other tab answers, so the election claims leadership.
      await vi.advanceTimersByTimeAsync(10_000)
      expect(heard, `listeners heard the gain, then the loss`).toEqual([
        true,
        false,
      ])
      expect(leaderAfterRelease, `released at once`).toBe(false)
      expect(electionsAfterRequest, `the request started an election`).toBe(2)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(outcome.value, `the request result`).toBe(false)
      // Disposing releases again; a tab that is not leading notifies nothing.
      leader.dispose()
      expect(heard, `a release while not leading`).toEqual([true, false])
    } finally {
      leader.dispose()
      for (const timer of timers) timer.mockRestore()
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
