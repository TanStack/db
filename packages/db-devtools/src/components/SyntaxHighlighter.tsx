import { createEffect, onMount } from "solid-js"
import Prism from "prismjs"
import "prismjs/components/prism-javascript"
import "prismjs/components/prism-typescript"

interface SyntaxHighlighterProps {
  code: string
  language?: string
  class?: string
}

export function SyntaxHighlighter(props: SyntaxHighlighterProps) {
  let preRef: HTMLPreElement | undefined

  onMount(() => {
    if (preRef) {
      Prism.highlightElement(preRef)
    }
  })

  createEffect(() => {
    if (preRef && props.code) {
      Prism.highlightElement(preRef)
    }
  })

  return (
    <pre
      ref={preRef}
      class={`language-${props.language || `javascript`} ${props.class || ``}`}
    >
      <code>{props.code}</code>
    </pre>
  )
}
