import type { LiveQuery } from "./createLiveQuery"

/**
 * Render function that receives query state and returns HTML string
 */
export type RenderFunction<TData> = (params: {
  data: TData
  isLoading: boolean
  isReady: boolean
  isError: boolean
  status: string
}) => string

/**
 * Automatically bind a live query to a DOM element
 * Automatically re-renders the element when the query changes
 *
 * @param query - The live query to bind
 * @param elementOrSelector - DOM element or CSS selector
 * @param render - Function that returns HTML string based on query state
 * @returns Cleanup function to stop auto-rendering
 *
 * @example
 * const todosQuery = createLiveQuery((q) => q.from({ todos }))
 *
 * bindToElement(todosQuery, '#todos-list', ({ data, isLoading }) => {
 *   if (isLoading) return '<div>Loading...</div>'
 *
 *   return `
 *     <ul>
 *       ${data.map(todo => `
 *         <li>${todo.text}</li>
 *       `).join('')}
 *     </ul>
 *   `
 * })
 */
export function bindToElement<TData = any>(
  query: LiveQuery<TData>,
  elementOrSelector: HTMLElement | string,
  renderFn: RenderFunction<TData>
): () => void {
  const element =
    typeof elementOrSelector === `string`
      ? document.querySelector<HTMLElement>(elementOrSelector)
      : elementOrSelector

  if (!element) {
    throw new Error(
      `Element not found: ${typeof elementOrSelector === `string` ? elementOrSelector : `<element>`}`
    )
  }

  // Subscribe to query changes and update element
  return query.subscribe(({ data, isLoading, isReady, isError, status }) => {
    element.innerHTML = renderFn({ data, isLoading, isReady, isError, status })
  })
}

/**
 * Create a reactive element that updates when query changes
 * Returns the element itself for easy insertion into the DOM
 *
 * @param query - The live query to bind
 * @param render - Function that returns HTML string
 * @param options - Element options (tag name, attributes)
 * @returns Tuple of [element, cleanup function]
 *
 * @example
 * const [listElement, cleanup] = createReactiveElement(
 *   todosQuery,
 *   ({ data }) => data.map(t => `<li>${t.text}</li>`).join('')
 * )
 *
 * document.body.appendChild(listElement)
 */
export function createReactiveElement<TData = any>(
  query: LiveQuery<TData>,
  renderFn: RenderFunction<TData>,
  options: {
    tagName?: string
    className?: string
    id?: string
    attributes?: Record<string, string>
  } = {}
): [HTMLElement, () => void] {
  const element = document.createElement(options.tagName || `div`)

  if (options.className) {
    element.className = options.className
  }

  if (options.id) {
    element.id = options.id
  }

  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value)
    })
  }

  const cleanup = bindToElement(query, element, renderFn)

  return [element, cleanup]
}

/**
 * Batch multiple query subscriptions and render once
 * Useful when you have multiple queries that affect the same UI
 *
 * @param queries - Array of live queries
 * @param render - Function called when any query changes
 * @returns Cleanup function
 *
 * @example
 * const todosQuery = createLiveQuery((q) => q.from({ todos }))
 * const statsQuery = createLiveQuery((q) => q.from({ stats }))
 *
 * batchSubscribe([todosQuery, statsQuery], () => {
 *   renderUI(todosQuery.data, statsQuery.data)
 * })
 */
export function batchSubscribe(
  queries: Array<LiveQuery<any>>,
  callback: () => void
): () => void {
  const unsubscribers = queries.map((query) => query.subscribe(callback))

  return () => {
    unsubscribers.forEach((unsub) => unsub())
  }
}

/**
 * Helper to safely render HTML and attach event listeners
 * Uses event delegation for better performance
 *
 * @param element - Target element
 * @param html - HTML string to render
 * @param events - Event handlers map
 *
 * @example
 * render(container, `
 *   <button data-action="delete" data-id="1">Delete</button>
 * `, {
 *   'click [data-action="delete"]': (e) => {
 *     const id = e.target.dataset.id
 *     deleteItem(id)
 *   }
 * })
 */
export function render(
  element: HTMLElement,
  htmlString: string,
  events?: Record<string, (e: Event) => void>
): void {
  element.innerHTML = htmlString

  if (events) {
    Object.entries(events).forEach(([key, handler]) => {
      const parts = key.split(` `, 2)
      const eventName = parts[0]
      const selector = parts[1]

      if (selector && eventName) {
        // Event delegation
        element.addEventListener(eventName, (e) => {
          const target = (e.target as HTMLElement).closest(selector)
          if (target) {
            handler(e)
          }
        })
      } else {
        // Direct event
        element.addEventListener(key, handler)
      }
    })
  }
}

/**
 * Create a simple template function for generating HTML
 * Tagged template literal that escapes values by default
 *
 * @example
 * const name = '<script>alert("xss")</script>'
 * const html = template`<div>Hello ${name}</div>`
 * // Result: <div>Hello &lt;script&gt;alert("xss")&lt;/script&gt;</div>
 */
export function template(
  strings: TemplateStringsArray,
  ...values: Array<any>
): string {
  return strings.reduce((result, str, i) => {
    const value = values[i] ?? ``
    const escaped =
      typeof value === `string` ? escapeHtml(value) : String(value)
    return result + str + escaped
  }, ``)
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, `&amp;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#039;`)
}

/**
 * HTML tagged template that doesn't escape (use with caution!)
 */
export function html(
  strings: TemplateStringsArray,
  ...vals: Array<any>
): string {
  return strings.reduce((result, str, i) => {
    return result + str + (vals[i] ?? ``)
  }, ``)
}
