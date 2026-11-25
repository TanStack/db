/** Tracks host work without deciding any Collection result. */
export function createHostQuiescence() {
  let activity = 0
  const pending = new Set<Promise<unknown>>()
  const note = () => {
    activity++
  }
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work)
    note()
    const done = () => {
      pending.delete(work)
      note()
    }
    void work.then(done, done)
    return work
  }
  const wait = async (label: string) => {
    let quietTasks = 0
    for (let task = 0; task < 400 && quietTasks < 5; task++) {
      // A transport retry can be silent between attempts. Its actual Promise
      // supplies completion; neither silence nor a Collection status does.
      if (pending.size) {
        await Promise.allSettled([...pending])
        quietTasks = 0
      }
      const before = activity
      await new Promise((resolve) => setTimeout(resolve, 2))
      quietTasks =
        activity === before && pending.size === 0 ? quietTasks + 1 : 0
    }
    if (quietTasks < 5) throw new Error(`hosts did not quiesce: ${label}`)
  }
  return { note, track, wait }
}
