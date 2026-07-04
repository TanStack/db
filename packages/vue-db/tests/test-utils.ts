import { nextTick } from 'vue'

// Helper function to wait for Vue reactivity
export async function waitForVueUpdate() {
  await nextTick()
  // Additional small delay to ensure collection updates are processed
  await new Promise((resolve) => setTimeout(resolve, 50))
}

// Helper function to poll for a condition until it passes or times out
export async function waitFor(fn: () => void, timeout = 2000, interval = 20) {
  const start = Date.now()

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    try {
      fn()
      return
    } catch (err) {
      if (Date.now() - start > timeout) throw err
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
  }
}
