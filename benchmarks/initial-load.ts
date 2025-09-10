// Load environment variables from .env file
import { config } from "dotenv"
config()

import { performance } from "node:perf_hooks"
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
 */
async function initializeTracing(): Promise<void> {
  try {
    console.log("🔍 Initializing Honeycomb tracing...")
    const honeycombTracer = await setupHoneycombFromEnv()
    setTracingEnabled(true)
    addTracer(honeycombTracer)
    console.log("✅ Honeycomb tracing initialized successfully")
  } catch (error) {
    console.warn("⚠️  Failed to initialize Honeycomb tracing:", error)
    console.log("📊 Running benchmarks without tracing...")
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
  return withSpan("generate-test-data", () => {
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
  }, {
    "benchmark.project_count": projectCount,
    "benchmark.issue_count": issueCount,
    "benchmark.comment_count": commentCount,
  })
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
  return withSpan("create-collections", () => {
    const autoIndex = 'eager'
    const projectsCollection = createCollection({
      ...localOnlyCollectionOptions({
        id: `projects`,
        getKey: (project) => project.id,
        schema: projectSchema,
        initialData: projects,
      }),
      autoIndex
    })

    const issuesCollection = createCollection({
      ...localOnlyCollectionOptions({
        id: `issues`,
        getKey: (issue) => issue.id,
        schema: issueSchema,
        initialData: issues,
      }),
      autoIndex
    })

    const commentsCollection = createCollection({
      ...localOnlyCollectionOptions({
        id: `comments`,
        getKey: (comment) => comment.id,
        schema: commentSchema,
        initialData: comments,
      }),
      autoIndex
    })

    return { projectsCollection, issuesCollection, commentsCollection }
  }, {
    "benchmark.projects_count": projects.length,
    "benchmark.issues_count": issues.length,
    "benchmark.comments_count": comments.length,
  })
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
  return withSpan("create-denormalized-query", () => {
    return createLiveQueryCollection({
      query: (q) =>
        q
          .from({ i: issuesCollection })
          .leftJoin({ p: projectsCollection }, ({ p, i }) =>
            eq(i.project_id, p.id)
          )
          .leftJoin({ c: commentsCollection }, ({ i, c }) => eq(c.issue_id, i.id))
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
  }, {
    "benchmark.query_type": "complex_join",
    "benchmark.join_count": 2,
  })
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
  return withSpanAsync("benchmark-initial-load", async () => {
    console.log(`\n🚀 Benchmarking initial load with:`)
    console.log(`   Projects: ${projectCount}`)
    console.log(`   Issues: ${issueCount}`)
    console.log(`   Comments: ${commentCount}`)
    console.log(`   Iterations: ${iterations}`)

    const times: Array<number> = []

    for (let i = 0; i < iterations; i++) {
      console.log(`\n   Iteration ${i + 1}/${iterations}...`)

      await withSpanAsync("benchmark-iteration", async () => {
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
        await withSpanAsync("wait-for-collections-ready", async () => {
          await Promise.all([
            projectsCollection.stateWhenReady(),
            issuesCollection.stateWhenReady(),
            commentsCollection.stateWhenReady(),
          ])
        }, {
          "benchmark.collections_count": 3,
        })

        // Create the complex query
        const query = createDenormalizedQuery(
          projectsCollection,
          issuesCollection,
          commentsCollection
        )

        // Benchmark the prefetch operation
        const startTime = performance.now()

        // Start initial run of the query
        await withSpanAsync("query-preload", async () => {
          await query.preload()
        }, {
          "benchmark.query_type": "complex_join",
        })

        const endTime = performance.now()
        const duration = endTime - startTime

        times.push(duration)

        console.log(`     Query ready in: ${duration.toFixed(2)}ms`)
        console.log(`     Result count: ${query.size}`)

        // Clean up - local-only collections don't need stopSync
        // The collections will be garbage collected automatically
      }, {
        "benchmark.iteration": i + 1,
        "benchmark.total_iterations": iterations,
      })
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
  }, {
    "benchmark.project_count": projectCount,
    "benchmark.issue_count": issueCount,
    "benchmark.comment_count": commentCount,
    "benchmark.iterations": iterations,
  })
}

/**
 * Main benchmark execution function
 */
async function runBenchmarks(): Promise<void> {
  return withSpanAsync("run-benchmarks", async () => {
    console.log(`🔥 TanStack DB Initial Load Benchmark`)
    console.log(`=====================================`)

    // Initialize tracing
    await initializeTracing()

    const benchmarks: Array<BenchmarkResult> = []

    // Small dataset
    benchmarks.push(await benchmarkInitialLoad(10, 50, 200))

    // Medium dataset
    benchmarks.push(await benchmarkInitialLoad(50, 250, 1000))

    // Large dataset
    benchmarks.push(await benchmarkInitialLoad(100, 500, 2000))

    // Very large dataset
    benchmarks.push(await benchmarkInitialLoad(200, 1000, 5000))

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

    console.log(`\n✅ Benchmark completed!`)
    
    // Flush any remaining traces
    console.log("🔄 Flushing traces to Honeycomb...")
    await new Promise(resolve => setTimeout(resolve, 2000)) // Give time for traces to be sent
    console.log("✅ Traces flushed")
  }, {
    "benchmark.total_datasets": 4,
  })
}

// Export functions for potential external use
export {
  generateTestData,
  createCollections,
  createDenormalizedQuery as createComplexQuery,
  benchmarkInitialLoad,
  runBenchmarks,
}

// Run the benchmarks if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runBenchmarks().catch(console.error)
}
