import type { TransportedLoadSubsetOptions } from './remote-subset-wire'

export type RemoteSubsetOwner = ((
  options: TransportedLoadSubsetOptions,
) => Promise<void> | void) & {
  unloadSubset: (options: TransportedLoadSubsetOptions) => void
  onError: (error: unknown) => void
}

export function reportRemoteSubsetOwnerError(
  owner: RemoteSubsetOwner,
  error: unknown,
): void {
  try {
    owner.onError(error)
  } catch {
    // Reporting must not replace the original owner failure.
  }
}

export async function unloadRemoteSubsetOwner(
  owner: RemoteSubsetOwner,
  options: TransportedLoadSubsetOptions,
): Promise<void> {
  try {
    const result = (
      owner.unloadSubset as unknown as (
        options: TransportedLoadSubsetOptions,
      ) => unknown
    )(options)
    await Promise.resolve(result)
  } catch (error) {
    reportRemoteSubsetOwnerError(owner, error)
    throw error
  }
}
