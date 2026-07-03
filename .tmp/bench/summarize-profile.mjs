// Summarize a .cpuprofile: total (inclusive) time per function, top N.
// Usage: node summarize-profile.mjs <file> [topN]
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const topN = Number(process.argv[3] ?? 40)
const profile = JSON.parse(readFileSync(file, `utf8`))

const byId = new Map(profile.nodes.map((n) => [n.id, n]))
// Build child -> parent map
const parentOf = new Map()
for (const n of profile.nodes) {
  for (const c of n.children ?? []) parentOf.set(c, n.id)
}

// self time per node
const selfUs = new Map()
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i]
  selfUs.set(id, (selfUs.get(id) || 0) + (profile.timeDeltas[i] || 0))
}

// total time per function key: sum of self times of all nodes in subtree.
// Compute per-node total by propagating self up ancestors, attributing to each unique function key at most once per path.
const keyOf = (n) =>
  `${n.callFrame.functionName || `(anonymous)`} @ ${n.callFrame.url.split(`/`).slice(-3).join(`/`)}:${n.callFrame.lineNumber + 1}`

const totalUs = new Map()
for (const [nodeId, us] of selfUs) {
  // walk up ancestors, collect unique keys
  const seen = new Set()
  let cur = nodeId
  while (cur !== undefined) {
    const n = byId.get(cur)
    if (n) {
      const k = keyOf(n)
      if (!seen.has(k)) {
        seen.add(k)
        totalUs.set(k, (totalUs.get(k) || 0) + us)
      }
    }
    cur = parentOf.get(cur)
  }
}

const sorted = [...totalUs.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
console.log(`Top ${topN} by inclusive time:`)
for (const [key, us] of sorted) {
  console.log(`${(us / 1000).toFixed(1).padStart(9)}ms  ${key}`)
}
