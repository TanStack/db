// A timeout identifies an unreached semantic checkpoint. It never supplies
// confirmation, cancels the handler, or turns a setup failure into a comparison.
export async function atMutationCheckpoint<T>(
  promise: Promise<T>,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Mutation oracle checkpoint timed out: ${label}`)),
          2000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
