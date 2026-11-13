#!/usr/bin/env node
// Reports slow PR CI jobs. It never fails: hard timeouts in pr.yml catch hangs,
// and this report measures cost against the budget (10 minutes per job, 15 for
// the workflow). Over-budget jobs and workflows get a ::warning:: annotation.
// With a writable token on a pull request, the report also keeps one comment
// per PR on the tracking issue "Slow CI triage" (label `slow-ci`), which an
// agent triages into cost-cut PRs. A run within budget updates an existing
// comment to say so, so the comment never reports an older run.
//
// Environment: GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN (for gh), and
// optionally PR_NUMBER, ISSUE_WRITABLE ('true' only for same-repo pull
// requests), GITHUB_STEP_SUMMARY, RUN_URL.
// Local check: `node scripts/ci-budget-report.mjs --jobs-file <jobs.jsonl>`
// reads jobs in the `gh api .../jobs --jq '.jobs[]'` shape and skips gh.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const JOB_BUDGET_MINUTES = 10
export const WORKFLOW_BUDGET_MINUTES = 15
export const ISSUE_TITLE = `Slow CI triage`
export const ISSUE_LABEL = `slow-ci`
// The report job is excluded from its own measurement.
const REPORT_JOB = `Slow CI budget`

const minutes = (job) =>
  (Date.parse(job.completed_at) - Date.parse(job.started_at)) / 60_000

export function measure(jobs) {
  const measured = jobs.filter(
    (job) =>
      job.name !== REPORT_JOB &&
      job.started_at &&
      job.completed_at &&
      job.conclusion !== `skipped` &&
      job.conclusion !== `cancelled`,
  )
  const jobRows = measured
    .map((job) => ({
      name: job.name,
      minutes: minutes(job),
      url: job.html_url,
    }))
    .sort((a, b) => b.minutes - a.minutes)
  const workflowMinutes =
    measured.length === 0
      ? 0
      : (Math.max(...measured.map((job) => Date.parse(job.completed_at))) -
          Math.min(...measured.map((job) => Date.parse(job.started_at)))) /
        60_000
  return {
    jobs: jobRows,
    over: jobRows.filter((job) => job.minutes > JOB_BUDGET_MINUTES),
    workflowMinutes,
    workflowOver: workflowMinutes > WORKFLOW_BUDGET_MINUTES,
  }
}

const fmt = (value) => `${value.toFixed(1)}m`

export function annotations(result) {
  const lines = result.over.map(
    (job) =>
      `::warning title=Slow CI job::${job.name} took ${fmt(job.minutes)} (budget ${JOB_BUDGET_MINUTES}m)`,
  )
  if (result.workflowOver)
    lines.push(
      `::warning title=Slow CI workflow::PR workflow took ${fmt(result.workflowMinutes)} (budget ${WORKFLOW_BUDGET_MINUTES}m)`,
    )
  return lines
}

export function summaryMarkdown(result, { runUrl, prNumber }) {
  const rows = result.jobs
    .map(
      (job) =>
        `| ${job.name} | ${fmt(job.minutes)} | ${job.minutes > JOB_BUDGET_MINUTES ? `over` : `ok`} |`,
    )
    .join(`\n`)
  return [
    `## Slow CI budget`,
    ``,
    `Run: ${runUrl}${prNumber ? ` (PR #${prNumber})` : ``}`,
    `Workflow: ${fmt(result.workflowMinutes)} (budget ${WORKFLOW_BUDGET_MINUTES}m)${result.workflowOver ? ` over` : ``}`,
    ``,
    `| Job | Time | Budget ${JOB_BUDGET_MINUTES}m |`,
    `| --- | --- | --- |`,
    rows,
    ``,
  ].join(`\n`)
}

export function commentMarker(prNumber) {
  return `<!-- ci-budget:pr=${prNumber} -->`
}

export function commentBody(result, { runUrl, prNumber }) {
  const rows = result.over
    .map(
      (job) =>
        `- ${job.name}: ${fmt(job.minutes)} (budget ${JOB_BUDGET_MINUTES}m)`,
    )
    .join(`\n`)
  const workflow = result.workflowOver
    ? `\n- Whole workflow: ${fmt(result.workflowMinutes)} (budget ${WORKFLOW_BUDGET_MINUTES}m)`
    : ``
  return [
    commentMarker(prNumber),
    `PR #${prNumber}, latest run: ${runUrl}`,
    ``,
    `Over budget in this run:`,
    rows + workflow,
    ``,
    `The 15-minute workflow figure covers only the jobs that the budget job waits on, not preview, size, build or the E2E workflow.`,
    `The budget is reported, not enforced. Timeouts in pr.yml catch hangs only.`,
  ].join(`\n`)
}

export function withinBudgetBody({ runUrl, prNumber }) {
  return [
    commentMarker(prNumber),
    `PR #${prNumber}, latest run: ${runUrl}`,
    ``,
    `Within budget in this run: no job over ${JOB_BUDGET_MINUTES} minutes, and the workflow under ${WORKFLOW_BUDGET_MINUTES}.`,
    ``,
    `The budget is reported, not enforced. Timeouts in pr.yml catch hangs only.`,
  ].join(`\n`)
}

// The issue step only talks to GitHub through gh. Any failure in it, or in
// reading the jobs, becomes a warning, so the workflow never goes red.
function gh(args, input) {
  return execFileSync(`gh`, args, {
    encoding: `utf8`,
    input,
    stdio: [input === undefined ? `ignore` : `pipe`, `pipe`, `pipe`],
  })
}

function findIssue(repo) {
  const issues = JSON.parse(
    gh([
      `issue`,
      `list`,
      `--repo`,
      repo,
      `--label`,
      ISSUE_LABEL,
      `--state`,
      `all`,
      `--limit`,
      `100`,
      `--json`,
      `number,title`,
    ]),
  )
  return issues.find((issue) => issue.title === ISSUE_TITLE)?.number ?? null
}

function createIssue(repo) {
  gh([
    `label`,
    `create`,
    ISSUE_LABEL,
    `--repo`,
    repo,
    `--color`,
    `B60205`,
    `--description`,
    `CI jobs over the budget`,
    `--force`,
  ])
  const url = gh([
    `issue`,
    `create`,
    `--repo`,
    repo,
    `--title`,
    ISSUE_TITLE,
    `--label`,
    ISSUE_LABEL,
    `--body`,
    `One comment per PR lists the PR CI jobs over the 10-minute budget, or the whole workflow over 15 minutes, from its latest run. The budget is reported, not enforced. Triage the comments into cost-cut PRs.`,
  ]).trim()
  return Number(url.split(`/`).pop())
}

// Updates the PR's comment, or creates it when `create` is set. Returns the
// action taken, or `absent` when there is no comment and none is created.
function upsertComment(repo, issueNumber, prNumber, body, { create }) {
  const file = join(tmpdir(), `ci-budget-comment-${prNumber}.md`)
  writeFileSync(file, body)
  const marker = commentMarker(prNumber)
  const found = gh([
    `api`,
    `repos/${repo}/issues/${issueNumber}/comments`,
    `--paginate`,
    `--jq`,
    `.[] | select(.body | contains("${marker}")) | .id`,
  ]).trim()
  const id = found.split(`\n`)[0]
  if (id) {
    gh([
      `api`,
      `-X`,
      `PATCH`,
      `repos/${repo}/issues/comments/${id}`,
      `-F`,
      `body=@${file}`,
    ])
    return `updated`
  }
  if (!create) return `absent`
  gh([
    `api`,
    `-X`,
    `POST`,
    `repos/${repo}/issues/${issueNumber}/comments`,
    `-F`,
    `body=@${file}`,
  ])
  return `created`
}

function loadJobs(args) {
  const index = args.indexOf(`--jobs-file`)
  if (index !== -1) {
    return readFileSync(args[index + 1], `utf8`)
      .split(`\n`)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  return gh([
    `api`,
    `--paginate`,
    `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
    `--jq`,
    `.jobs[]`,
  ])
    .split(`\n`)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function firstLine(error) {
  return String(error?.message ?? error)
    .split(`\n`)[0]
    .slice(0, 300)
}

function main(args) {
  let result
  try {
    result = measure(loadJobs(args))
  } catch (error) {
    console.log(
      `::warning title=Slow CI budget::could not read job durations: ${firstLine(error)}`,
    )
    return
  }
  for (const line of annotations(result)) console.log(line)
  const runUrl =
    process.env.RUN_URL ??
    `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const prNumber = process.env.PR_NUMBER
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      summaryMarkdown(result, { runUrl, prNumber }),
    )
  if (!prNumber || process.env.ISSUE_WRITABLE !== `true`) return
  const offending = result.over.length > 0 || result.workflowOver
  try {
    const repo = process.env.GITHUB_REPOSITORY
    const issue = offending
      ? (findIssue(repo) ?? createIssue(repo))
      : findIssue(repo)
    if (issue === null) return
    const action = upsertComment(
      repo,
      issue,
      prNumber,
      offending
        ? commentBody(result, { runUrl, prNumber })
        : withinBudgetBody({ runUrl, prNumber }),
      { create: offending },
    )
    console.log(
      `Slow CI triage issue #${issue}: ${action} the comment for PR #${prNumber}`,
    )
  } catch (error) {
    console.log(
      `::warning title=Slow CI triage::could not update the issue: ${firstLine(error)}`,
    )
  }
}

// Only the workflow and the local check run main: a module import does not.
// pathToFileURL keeps the check correct for paths that need URL encoding.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.log(
      `::warning title=Slow CI budget::report failed: ${firstLine(error)}`,
    )
  }
}
