#!/usr/bin/env node
// Reports slow PR CI jobs. It never fails: hard timeouts in pr.yml catch hangs,
// and this report measures cost against the budget (10 minutes per job, 15 for
// the workflow). Over-budget jobs and workflows get a ::warning:: annotation.
// With a writable token on a pull request, the report also updates one comment
// per PR on the tracking issue "Slow CI triage" (label `slow-ci`), which an
// agent triages into cost-cut PRs.
//
// Environment: GITHUB_REPOSITORY, GITHUB_RUN_ID, GH_TOKEN (for gh), and
// optionally PR_NUMBER, ISSUE_WRITABLE ('true' only for same-repo pull
// requests), GITHUB_STEP_SUMMARY, RUN_URL.
// Local check: `node scripts/ci-budget-report.mjs --jobs-file <jobs.jsonl>`
// reads jobs in the `gh api .../jobs --jq '.jobs[]'` shape and skips gh.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
      job.conclusion !== `skipped`,
  )
  const jobRows = measured
    .map((job) => ({ name: job.name, minutes: minutes(job), url: job.html_url }))
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
    .map((job) => `- ${job.name}: ${fmt(job.minutes)} (budget ${JOB_BUDGET_MINUTES}m)`)
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
    `The budget is reported, not enforced. Timeouts in pr.yml catch hangs only.`,
  ].join(`\n`)
}

// The issue step only talks to GitHub through gh. A failure in it becomes a
// warning, so the workflow stays green.
function gh(args, input) {
  return execFileSync(`gh`, args, {
    encoding: `utf8`,
    input,
    stdio: [input === undefined ? `ignore` : `pipe`, `pipe`, `pipe`],
  })
}

function findOrCreateIssue(repo) {
  const issues = JSON.parse(
    gh([`issue`, `list`, `--repo`, repo, `--label`, ISSUE_LABEL, `--state`, `all`, `--limit`, `100`, `--json`, `number,title`]),
  )
  const existing = issues.find((issue) => issue.title === ISSUE_TITLE)
  if (existing) return existing.number
  gh([`label`, `create`, ISSUE_LABEL, `--repo`, repo, `--color`, `B60205`, `--description`, `CI jobs over the budget`, `--force`])
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

function upsertComment(repo, issueNumber, prNumber, body) {
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
    gh([`api`, `-X`, `PATCH`, `repos/${repo}/issues/comments/${id}`, `-F`, `body=@${file}`])
    return `updated`
  }
  gh([`api`, `-X`, `POST`, `repos/${repo}/issues/${issueNumber}/comments`, `-F`, `body=@${file}`])
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
  return gh([`api`, `--paginate`, `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, `--jq`, `.jobs[]`])
    .split(`\n`)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function main(args) {
  const result = measure(loadJobs(args))
  for (const line of annotations(result)) console.log(line)
  const runUrl = process.env.RUN_URL ?? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const prNumber = process.env.PR_NUMBER
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result, { runUrl, prNumber }))
  const offending = result.over.length > 0 || result.workflowOver
  if (!offending || !prNumber || process.env.ISSUE_WRITABLE !== `true`) return
  try {
    const repo = process.env.GITHUB_REPOSITORY
    const issue = findOrCreateIssue(repo)
    const action = upsertComment(repo, issue, prNumber, commentBody(result, { runUrl, prNumber }))
    console.log(`Slow CI triage issue #${issue}: ${action} the comment for PR #${prNumber}`)
  } catch (error) {
    console.log(`::warning title=Slow CI triage::could not update the issue: ${String(error.message).split(`\n`)[0]}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
