/**
 * Commit-time observation for Preact drivers.
 *
 * The probe component records the hook result in a layout effect, which
 * Preact runs synchronously when it commits a render. A source write outside
 * `act` still schedules a real Preact render, and that render commits on the
 * next microtask. Passive effects are different: Preact runs them after
 * paint, and `act` drains only the ones scheduled inside it, so a `useEffect`
 * recorder (as in `@testing-library/preact`'s `renderHook`) can miss a
 * committed render.
 *
 * Rejection: the probe sits under an error boundary, as a real app's hook
 * would. A render that throws is caught there, the boundary unmounts the
 * failed hook (releasing its subscription), and the probe rethrows the
 * captured error from the mount or rerender that caused it, and from every
 * later read: the failed hook is no longer mounted. Without the
 * boundary, Preact keeps the failed component mounted, and a later
 * notification re-renders it outside `act`.
 */
import { Component, h, render } from 'preact'
import { useLayoutEffect } from 'preact/hooks'
import { act } from 'preact/test-utils'

class RejectionBoundary extends Component<{
  onError: (error: unknown) => void
  children?: any
}> {
  state = { failed: false }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
    this.setState({ failed: true })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export interface MountedHook<P> {
  result: { current: any }
  rerender: (props: P) => void
  unmount: () => void
}

/** Mount one hook in a probe component and record each committed result. */
export function renderHook<P>(
  useResult: (props: P) => unknown,
  options?: { initialProps?: P; onCommit?: (result: any) => void },
): MountedHook<P> {
  const container = document.createElement(`div`)
  let committed: unknown
  let rejection: { error: unknown } | undefined
  const result = {
    get current(): any {
      if (rejection) throw rejection.error
      return committed
    },
  }
  function Probe({ props }: { props: P }) {
    const value = useResult(props)
    useLayoutEffect(() => {
      committed = value
      options?.onCommit?.(value)
    })
    return null
  }
  const unmount = () => act(() => render(null, container))
  /** Render inside `act`, then rethrow a rejection the boundary caught. */
  const commit = (props: P) => {
    act(() => {
      render(
        h(
          RejectionBoundary,
          { onError: (error) => (rejection ??= { error }) },
          h(Probe, { props }),
        ),
        container,
      )
    })
    if (rejection) throw rejection.error
  }
  // A rejected first render must not leave its container mounted.
  try {
    commit(options?.initialProps as P)
  } catch (error) {
    unmount()
    throw error
  }
  return { result, rerender: commit, unmount }
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
