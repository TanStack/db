<script lang="ts">
  import { setHydrationContext } from "./hydration.svelte"
  import type { DehydratedState } from "./server"
  import type { Snippet } from "svelte"

  interface Props {
    /**
     * The dehydrated state from the server, typically from `dehydrate(serverContext)`
     */
    state: DehydratedState | undefined
    /**
     * Child content to render
     */
    children: Snippet
  }

  let { state, children }: Props = $props()

  // Set the hydration context so child components can access hydrated data
  setHydrationContext(state)
</script>

<!--
  HydrationBoundary component that provides hydrated query data to child components.

  This component should wrap your application or page component in SSR environments.
  It makes the prefetched query data available to useLiveQuery hooks via Svelte context.

  @example
  ```svelte
  <script lang="ts">
    import { HydrationBoundary } from '@tanstack/svelte-db'
    let { data } = $props()
  </script>

  <HydrationBoundary state={data.dehydratedState}>
    <TodoList />
  </HydrationBoundary>
  ```
-->
{@render children()}
