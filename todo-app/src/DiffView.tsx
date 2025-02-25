import React from "react"
import { diffLines } from "diff"

interface DiffViewProps {
  oldValue: unknown
  newValue: unknown
}

export function DiffView({ oldValue, newValue }: DiffViewProps) {
  const diff = diffLines(
    JSON.stringify(oldValue, null, 2),
    JSON.stringify(newValue, null, 2)
  )

  return (
    <pre className="text-sm font-mono bg-gray-50 p-2 rounded overflow-auto">
      {diff.map((part, index) => (
        <div
          key={index}
          className={`${
            part.added
              ? `bg-green-50 text-green-800 border-l-4 border-green-500`
              : part.removed
                ? `bg-red-50 text-red-800 border-l-4 border-red-500`
                : `text-gray-800`
          } px-2 whitespace-pre`}
        >
          {part.added ? `+ ` : part.removed ? `- ` : `  `}
          {part.value}
        </div>
      ))}
    </pre>
  )
}
