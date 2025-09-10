// Load environment variables from .env file
import { config } from "dotenv"
config()

import { performance } from "node:perf_hooks"
import { createInterface } from "node:readline"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db"
import {
  setTracingEnabled,
  addTracer,
  setupHoneycombFromEnv,
  withSpan,
  withSpanAsync,
} from "@tanstack/db-tracing"
import { z } from "zod"
import type { Collection } from "@tanstack/db"

// Define Zod schemas for our data types
const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  created_at: z.date(),
  owner_id: z.string(),
})

const issueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum([`open`, `in_progress`, `closed`]),
  priority: z.enum([`low`, `medium`, `high`, `critical`]),
  project_id: z.string(),
  assignee_id: z.string(),
  created_at: z.date(),
  updated_at: z.date(),
})

const commentSchema = z.object({
  id: z.string(),
  content: z.string(),
  issue_id: z.string(),
  author_id: z.string(),
  created_at: z.date(),
})

// Define the data types for our issue tracker
interface Project {
  id: string
  name: string
  description: string
  created_at: Date
  owner_id: string
}

interface Issue {
  id: string
  title: string
  description: string
  status: `open` | `in_progress` | `closed`
  priority: `low` | `medium` | `high` | `critical`
  project_id: string
  assignee_id: string
  created_at: Date
  updated_at: Date
}

interface Comment {
  id: string
  content: string
  issue_id: string
  author_id: string
  created_at: Date
}

interface BenchmarkResult {
  projectCount: number
  issueCount: number
  commentCount: number
  avgTime: number
  minTime: number
  maxTime: number
  stdDev: number
  times: Array<number>
}

interface TestData {
  projects: Array<Project>
  issues: Array<Issue>
  comments: Array<Comment>
}

interface Collections {
  projectsCollection: Collection<Project, string>
  issuesCollection: Collection<Issue, string>
  commentsCollection: Collection<Comment, string>
}

/**
 * Initialize Honeycomb tracing for the benchmark
 * @param enableTracing - Whether to enable tracing or not
 */
async function initializeTracing(enableTracing: boolean = true): Promise<void> {
  if (!enableTracing) {
    console.log("🚫 Tracing disabled - running benchmarks without tracing")
    setTracingEnabled(false)
    return
  }

  try {
    console.log("🔍 Initializing Honeycomb tracing...")
    const honeycombTracer = await setupHoneycombFromEnv()
    setTracingEnabled(true)
    addTracer(honeycombTracer)
    console.log("✅ Honeycomb tracing initialized successfully")
  } catch (error) {
    console.warn("⚠️  Failed to initialize Honeycomb tracing:", error)
    console.log("📊 Running benchmarks without tracing...")
    setTracingEnabled(false)
  }
}

/**
 * Generate test data for the issue tracker benchmark
 * @param projectCount - Number of projects to generate
 * @param issueCount - Number of issues to generate
 * @param commentCount - Number of comments to generate
 * @returns Object containing arrays of projects, issues, and comments
 */
function generateTestData(
  projectCount: number,
  issueCount: number,
  commentCount: number
): TestData {
  return withSpan(
    "generate-test-data",
    () => {
      const projects: Array<Project> = []
      const issues: Array<Issue> = []
      const comments: Array<Comment> = []

      const statuses: Array<Issue[`status`]> = [`open`, `in_progress`, `closed`]
      const priorities: Array<Issue[`priority`]> = [
        `low`,
        `medium`,
        `high`,
        `critical`,
      ]
      const users = [`user1`, `user2`, `user3`, `user4`, `user5`]

      // Generate projects
      for (let i = 0; i < projectCount; i++) {
        projects.push({
          id: `project-${i}`,
          name: `Project ${i}`,
          description: `Description for project ${i}`,
          created_at: new Date(),
          owner_id: users[i % users.length],
        })
      }

      // Generate issues
      for (let i = 0; i < issueCount; i++) {
        issues.push({
          id: `issue-${i}`,
          title: `Issue ${i}`,
          description: `Description for issue ${i}`,
          status: statuses[i % statuses.length],
          priority: priorities[i % priorities.length],
          project_id: `project-${i % projectCount}`,
          assignee_id: users[i % users.length],
          created_at: new Date(),
          updated_at: new Date(),
        })
      }

      // Generate comments
      for (let i = 0; i < commentCount; i++) {
        comments.push({
          id: `comment-${i}`,
          content: `Comment ${i} on issue ${i % issueCount}`,
          issue_id: `issue-${i % issueCount}`,
          author_id: users[i % users.length],
          created_at: new Date(),
        })
      }

      return { projects, issues, comments }
    },
    {
      "benchmark.project_count": projectCount,
      "benchmark.issue_count": issueCount,
      "benchmark.comment_count": commentCount,
    }
  )
}

/**
 * Create TanStack DB collections with local-only configuration for testing
 * @param projects - Array of project objects
 * @param issues - Array of issue objects
 * @param comments - Array of comment objects
 * @returns Object containing the three collections
 */
function createCollections(
  projects: Array<Project>,
  issues: Array<Issue>,
  comments: Array<Comment>
): Collections {
  return withSpan(
    "create-collections",
    () => {
      const autoIndex = "off" // 'eager' or 'off'
      const projectsCollection = createCollection({
        ...localOnlyCollectionOptions({
          id: `projects`,
          getKey: (project) => project.id,
          schema: projectSchema,
          initialData: projects,
        }),
        autoIndex,
      })

      const issuesCollection = createCollection({
        ...localOnlyCollectionOptions({
          id: `issues`,
          getKey: (issue) => issue.id,
          schema: issueSchema,
          initialData: issues,
        }),
        autoIndex,
      })

      const commentsCollection = createCollection({
        ...localOnlyCollectionOptions({
          id: `comments`,
          getKey: (comment) => comment.id,
          schema: commentSchema,
          initialData: comments,
        }),
        autoIndex,
      })

      return { projectsCollection, issuesCollection, commentsCollection }
    },
    {
      "benchmark.projects_count": projects.length,
      "benchmark.issues_count": issues.length,
      "benchmark.comments_count": comments.length,
    }
  )
}

/**
 * Create a complex query that joins all three collections
 * @param projectsCollection - Projects collection
 * @param issuesCollection - Issues collection
 * @param commentsCollection - Comments collection
 * @returns Live query collection
 */
function createDenormalizedQuery(
  projectsCollection: Collection<Project, string>,
  issuesCollection: Collection<Issue, string>,
  commentsCollection: Collection<Comment, string>
) {
  return withSpan(
    "create-denormalized-query",
    () => {
      return createLiveQueryCollection({
        query: (q) =>
          q
            .from({ i: issuesCollection })
            .leftJoin({ p: projectsCollection }, ({ p, i }) =>
              eq(i.project_id, p.id)
            )
            .leftJoin({ c: commentsCollection }, ({ i, c }) =>
              eq(c.issue_id, i.id)
            )
            .select(({ p, i, c }) => ({
              project_id: p?.id,
              project_name: p?.name,
              project_description: p?.description,
              issue_id: i.id,
              issue_title: i.title,
              issue_status: i.status,
              issue_priority: i.priority,
              comment_id: c?.id,
              comment_content: c?.content,
              comment_author: c?.author_id,
            })),
        startSync: false,
      })
    },
    {
      "benchmark.query_type": "complex_join",
      "benchmark.join_count": 2,
    }
  )
}

/**
 * Benchmark the initial load performance for a given dataset size
 * @param projectCount - Number of projects
 * @param issueCount - Number of issues
 * @param commentCount - Number of comments
 * @param iterations - Number of benchmark iterations
 * @returns Benchmark results with timing statistics
 */
async function benchmarkInitialLoad(
  projectCount: number,
  issueCount: number,
  commentCount: number,
  iterations: number = 5
): Promise<BenchmarkResult> {
  return withSpanAsync(
    "benchmark-initial-load",
    async () => {
      console.log(`\n🚀 Benchmarking initial load with:`)
      console.log(`   Projects: ${projectCount}`)
      console.log(`   Issues: ${issueCount}`)
      console.log(`   Comments: ${commentCount}`)
      console.log(`   Iterations: ${iterations}`)

      const times: Array<number> = []

      for (let i = 0; i < iterations; i++) {
        console.log(`\n   Iteration ${i + 1}/${iterations}...`)

        await withSpanAsync(
          "benchmark-iteration",
          async () => {
            // Generate fresh data for each iteration
            const { projects, issues, comments } = generateTestData(
              projectCount,
              issueCount,
              commentCount
            )

            // Create collections
            const { projectsCollection, issuesCollection, commentsCollection } =
              createCollections(projects, issues, comments)

            // Wait for all collections to be ready
            await withSpanAsync(
              "wait-for-collections-ready",
              async () => {
                await Promise.all([
                  projectsCollection.stateWhenReady(),
                  issuesCollection.stateWhenReady(),
                  commentsCollection.stateWhenReady(),
                ])
              },
              {
                "benchmark.collections_count": 3,
              }
            )

            // Create the complex query
            const query = createDenormalizedQuery(
              projectsCollection,
              issuesCollection,
              commentsCollection
            )

            // Benchmark the prefetch operation
            const startTime = performance.now()

            // Start initial run of the query
            await withSpanAsync(
              "query-preload",
              async () => {
                await query.preload()
              },
              {
                "benchmark.query_type": "complex_join",
              }
            )

            const endTime = performance.now()
            const duration = endTime - startTime

            times.push(duration)

            console.log(`     Query ready in: ${duration.toFixed(2)}ms`)
            console.log(`     Result count: ${query.size}`)

            // Clean up - local-only collections don't need stopSync
            // The collections will be garbage collected automatically
          },
          {
            "benchmark.iteration": i + 1,
            "benchmark.total_iterations": iterations,
          }
        )
      }

      // Calculate statistics
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length
      const minTime = Math.min(...times)
      const maxTime = Math.max(...times)
      const stdDev = Math.sqrt(
        times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) /
          times.length
      )

      console.log(`\n📊 Results:`)
      console.log(`   Average time: ${avgTime.toFixed(2)}ms`)
      console.log(`   Min time: ${minTime.toFixed(2)}ms`)
      console.log(`   Max time: ${maxTime.toFixed(2)}ms`)
      console.log(`   Std Dev: ${stdDev.toFixed(2)}ms`)

      return {
        projectCount,
        issueCount,
        commentCount,
        avgTime,
        minTime,
        maxTime,
        stdDev,
        times,
      }
    },
    {
      "benchmark.project_count": projectCount,
      "benchmark.issue_count": issueCount,
      "benchmark.comment_count": commentCount,
      "benchmark.iterations": iterations,
    }
  )
}

/**
 * Parse command line arguments
 */
function parseArgs(): { interactive: boolean; help: boolean; tracing: boolean } {
  const args = process.argv.slice(2)
  return {
    interactive: args.includes('--interactive') || args.includes('-i'),
    help: args.includes('--help') || args.includes('-h'),
    tracing: !args.includes('--no-tracing')
  }
}

/**
 * Display help information
 */
function displayHelp(): void {
  console.log(`🔥 TanStack DB Initial Load Benchmark`)
  console.log(`=====================================`)
  console.log(``)
  console.log(`Usage: node initial-load.ts [options]`)
  console.log(``)
  console.log(`Options:`)
  console.log(`  -i, --interactive    Run in interactive mode (press Enter to run benchmarks)`)
  console.log(`  --no-tracing         Disable OpenTelemetry/Honeycomb tracing for faster runs`)
  console.log(`  -h, --help          Show this help message`)
  console.log(``)
  console.log(`Examples:`)
  console.log(`  node initial-load.ts                    # Run benchmarks once with tracing`)
  console.log(`  node initial-load.ts --interactive      # Run in interactive mode with tracing`)
  console.log(`  node initial-load.ts --no-tracing       # Run benchmarks without tracing`)
  console.log(`  node initial-load.ts -i --no-tracing    # Interactive mode without tracing`)
}

/**
 * Wait for user to press Enter
 */
function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    rl.question('Press Enter to run benchmarks (or Ctrl+C to exit)... ', () => {
      rl.close()
      resolve()
    })
  })
}

/**
 * Run benchmarks in interactive mode
 * @param enableTracing - Whether to enable tracing or not
 */
async function runInteractiveBenchmarks(enableTracing: boolean = true): Promise<void> {
  console.log(`🔥 TanStack DB Initial Load Benchmark - Interactive Mode`)
  console.log(`======================================================`)
  console.log(``)
  console.log(`In interactive mode, benchmarks will run each time you press Enter.`)
  console.log(`Use Ctrl+C to exit at any time.`)
  console.log(``)

  let runCount = 0

  while (true) {
    try {
      await waitForEnter()
      runCount++
      
      console.log(`\n🚀 Starting benchmark run #${runCount}`)
      console.log(`${'='.repeat(40)}`)
      
      await runSingleBenchmarkSet(enableTracing)
      
      console.log(`\n✅ Benchmark run #${runCount} completed!`)
      console.log(``)
    } catch (error) {
      if (error instanceof Error && error.message.includes('SIGINT')) {
        console.log(`\n👋 Exiting interactive mode...`)
        break
      }
      console.error(`❌ Error during benchmark run #${runCount}:`, error)
    }
  }
}

/**
 * Run a single set of benchmarks (extracted from runBenchmarks)
 * @param enableTracing - Whether to enable tracing or not
 */
async function runSingleBenchmarkSet(enableTracing: boolean = true): Promise<void> {
  const runBenchmarkLogic = async () => {
    const benchmarks: Array<BenchmarkResult> = []

    const iterations = 1

    // Small dataset
    benchmarks.push(await benchmarkInitialLoad(10, 50, 200, iterations))

    // // Medium dataset
    // benchmarks.push(await benchmarkInitialLoad(50, 250, 1000, iterations))

    // // Large dataset
    // benchmarks.push(await benchmarkInitialLoad(100, 500, 2000, iterations))

    // // Very large dataset
    // benchmarks.push(await benchmarkInitialLoad(200, 1000, 5000, iterations))

    // Summary
    console.log(`\n🎯 Benchmark Summary`)
    console.log(`====================`)
    console.log(`Dataset Size | Projects | Issues | Comments | Avg Time (ms)`)
    console.log(`-------------|----------|-------|----------|--------------`)

    benchmarks.forEach((benchmark, index) => {
      const size = [`Small`, `Medium`, `Large`, `Very Large`][index]
      console.log(
        `${size.padEnd(12)} | ${benchmark.projectCount.toString().padStart(8)} | ${benchmark.issueCount.toString().padStart(6)} | ${benchmark.commentCount.toString().padStart(9)} | ${benchmark.avgTime.toFixed(2).padStart(12)}`
      )
    })

    // Flush any remaining traces only if tracing is enabled
    if (enableTracing) {
      console.log("🔄 Flushing traces to Honeycomb...")
      await new Promise((resolve) => setTimeout(resolve, 2000)) // Reduced flush time for interactive mode
      console.log("✅ Traces flushed")
    }
  }

  if (enableTracing) {
    return withSpanAsync(
      "tanstack-db-benchmark-execution",
      async () => {
        await withSpanAsync(
          "run-benchmarks",
          runBenchmarkLogic,
          {
            "benchmark.total_datasets": 4,
          }
        )
      },
      {
        "benchmark.type": "tanstack-db-initial-load",
        "benchmark.version": "1.0.0",
      }
    )
  } else {
    // Run without tracing spans
    return runBenchmarkLogic()
  }
}

/**
 * Main benchmark execution function (non-interactive)
 * @param enableTracing - Whether to enable tracing or not
 */
async function runBenchmarks(enableTracing: boolean = true): Promise<void> {
  console.log(`🔥 TanStack DB Initial Load Benchmark`)
  console.log(`=====================================`)

  // Run a single benchmark set and then exit
  await runSingleBenchmarkSet(enableTracing)
  
  console.log(`\n✅ Benchmark completed!`)
}

// Export functions for potential external use
export {
  generateTestData,
  createCollections,
  createDenormalizedQuery as createComplexQuery,
  benchmarkInitialLoad,
  runBenchmarks,
  runInteractiveBenchmarks,
}

/**
 * Main execution logic with command-line argument handling
 */
async function main(): Promise<void> {
  const { interactive, help, tracing } = parseArgs()
  
  if (help) {
    displayHelp()
    return
  }
  
  // Initialize tracing once at the start
  await initializeTracing(tracing)
  
  if (interactive) {
    await runInteractiveBenchmarks(tracing)
  } else {
    await runBenchmarks(tracing)
  }
}

// Run the benchmarks if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}
