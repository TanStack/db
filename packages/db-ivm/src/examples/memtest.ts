import { D2 } from "../../src/d2.js"
import { MultiSet } from "../multiset.js"
import { map, reduce } from "../operators/index.js"

const graph = new D2()

const reviews = graph.newInput<{
  id: number
  listingId: number
  score: number
  text: string
}>()

// Group reviews by listingId and sum score
reviews.pipe(
  map((x) => [x.listingId, x.score]),
  reduce((values) => {
    // `values` is an array of [value, multiplicity] pairs for a specific key
    let sum = 0
    for (const [value, multiplicity] of values) {
      sum += value * multiplicity
    }
    return [[sum, 1]]
  })
)
graph.finalize()

// Get iteration count from command line argument, default to 100000
const ITER_COUNT = process.argv[2] ? parseInt(process.argv[2], 10) : 1000
console.log(`ITER_COUNT: ${ITER_COUNT}`)

const t0 = Date.now()

for (let i = 1; i < ITER_COUNT; i++) {
  reviews.sendData(
    new MultiSet([[{ id: 3 + i, listingId: 1, score: 1, text: `tada` }, 1]])
  )
  //   reviews.sendFrontier(i+1)

  graph.run()
}

const t1 = Date.now()

console.log(`Time taken: ${t1 - t0} ms`)
