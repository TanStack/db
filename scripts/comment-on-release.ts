#!/usr/bin/env node

// Temporary local copy of TanStack/config's comment-on-release action (MIT).
// Copyright (c) 2021-present Tanner Linsley; see ../LICENSE.
// Upstream: e4b48f16568324f76f467aa4c2aac2f05db632c3, .github/comment-on-release/.
// Includes the full-version/anchor repair from KyleAMathews/config d855eba.
// Return to the shared action after that repair is available upstream.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

interface PublishedPackage {
  name: string
  version: string
}

interface PRInfo {
  number: number
  packages: Array<{ name: string; pkgPath: string; version: string }>
}

interface IssueInfo {
  number: number
  prs: Set<number>
  packages: Array<{ name: string; pkgPath: string; version: string }>
}

/**
 * Parse CHANGELOG.md to extract PR numbers from the latest version entry
 */
function extractPRsFromChangelog(
  changelogPath: string,
  version: string,
): Array<number> {
  try {
    const content = readFileSync(changelogPath, 'utf-8')
    const lines = content.split('\n')

    let inTargetVersion = false
    let foundVersion = false
    const prNumbers = new Set<number>()

    for (const line of lines) {
      // Match the complete version, including prerelease and build suffixes.
      if (line.startsWith('## ')) {
        if (line.slice(3).trim() === version) {
          inTargetVersion = true
          foundVersion = true
        } else if (inTargetVersion) {
          // We've moved to the next section, stop processing.
          break
        }
      }

      // Extract PR numbers from links like [#302](https://github.com/TanStack/config/pull/302)
      if (inTargetVersion) {
        const prMatches = line.matchAll(
          /\[#(\d+)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+\)/g,
        )
        for (const match of prMatches) {
          prNumbers.add(parseInt(match[1], 10))
        }
      }
    }

    if (!foundVersion) {
      console.warn(
        `Warning: Could not find version ${version} in ${changelogPath}`,
      )
    }

    return Array.from(prNumbers)
  } catch (error) {
    console.error(`Error reading changelog at ${changelogPath}:`, error)
    return []
  }
}

/**
 * Group PRs by their numbers and collect all packages they contributed to
 */
function groupPRsByNumber(
  publishedPackages: Array<PublishedPackage>,
): Map<number, PRInfo> {
  const prMap = new Map<number, PRInfo>()

  for (const pkg of publishedPackages) {
    const pkgPath = `packages/${pkg.name.replace('@tanstack/', '')}`
    const changelogPath = resolve(process.cwd(), pkgPath, 'CHANGELOG.md')

    const prNumbers = extractPRsFromChangelog(changelogPath, pkg.version)

    for (const prNumber of prNumbers) {
      if (!prMap.has(prNumber)) {
        prMap.set(prNumber, { number: prNumber, packages: [] })
      }
      prMap.get(prNumber)!.packages.push({
        name: pkg.name,
        pkgPath: pkgPath,
        version: pkg.version,
      })
    }
  }

  return prMap
}

/**
 * Check if we've already commented on a PR/issue to avoid duplicates
 */
function hasExistingComment(number: number, type: 'pr' | 'issue'): boolean {
  try {
    const result = execSync(
      `gh api repos/\${GITHUB_REPOSITORY}/issues/${number}/comments --jq '[.[] | select(.body | contains("has been released!"))] | length'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const count = parseInt(result.trim(), 10)
    return count > 0
  } catch {
    console.warn(
      `Warning: Could not check existing comments for ${type} #${number}`,
    )
    return false
  }
}

/**
 * Find issues that a PR closes/fixes using GitHub's GraphQL API
 */
function findLinkedIssues(prNumber: number, repository: string): Array<number> {
  const [owner, repo] = repository.split('/')
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 10) {
            nodes {
              number
            }
          }
        }
      }
    }
  `

  try {
    const result = execSync(
      `gh api graphql -f query='${query}' -F owner='${owner}' -F repo='${repo}' -F pr=${prNumber} --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const issueNumbers = result
      .trim()
      .split('\n')
      .filter((line) => line)
      .map((line) => parseInt(line, 10))

    if (issueNumbers.length > 0) {
      console.log(
        `  PR #${prNumber} links to issues: ${issueNumbers.join(', ')}`,
      )
    }

    return issueNumbers
  } catch {
    return []
  }
}

/**
 * Post a comment on a GitHub PR using gh CLI
 */
async function commentOnPR(pr: PRInfo, repository: string): Promise<void> {
  const { number, packages } = pr

  // Check for duplicate comments
  if (hasExistingComment(number, 'pr')) {
    console.log(`↷ Already commented on PR #${number}, skipping`)
    return
  }

  // Build the comment body
  let comment = `🎉 This PR has been released!\n\n`

  for (const pkg of packages) {
    // Link to the package's changelog and version anchor
    const changelogUrl = `https://github.com/${repository}/blob/main/${pkg.pkgPath}/CHANGELOG.md#${pkg.version.toLowerCase().replace(/[.+]/g, '')}`
    comment += `- [${pkg.name}@${pkg.version}](${changelogUrl})\n`
  }

  comment += `\nThank you for your contribution!`

  try {
    // Use gh CLI to post the comment
    execSync(`gh pr comment ${number} --body '${comment.replace(/'/g, '"')}'`, {
      stdio: 'inherit',
    })
    console.log(`✓ Commented on PR #${number}`)
  } catch (error) {
    console.error(`✗ Failed to comment on PR #${number}:`, error)
  }
}

/**
 * Post a comment on a GitHub issue using gh CLI
 */
async function commentOnIssue(
  issue: IssueInfo,
  repository: string,
): Promise<void> {
  const { number, prs, packages } = issue

  // Check for duplicate comments
  if (hasExistingComment(number, 'issue')) {
    console.log(`↷ Already commented on issue #${number}, skipping`)
    return
  }

  const prLinks = Array.from(prs)
    .map((pr) => `#${pr}`)
    .join(', ')
  const prWord = prs.size === 1 ? 'PR' : 'PRs'

  // Build the comment body
  let comment = `🎉 The ${prWord} fixing this issue (${prLinks}) has been released!\n\n`

  for (const pkg of packages) {
    // Link to the package's changelog and version anchor
    const changelogUrl = `https://github.com/${repository}/blob/main/${pkg.pkgPath}/CHANGELOG.md#${pkg.version.toLowerCase().replace(/[.+]/g, '')}`
    comment += `- [${pkg.name}@${pkg.version}](${changelogUrl})\n`
  }

  comment += `\nThank you for reporting!`

  try {
    // Use gh CLI to post the comment
    execSync(
      `gh issue comment ${number} --body '${comment.replace(/'/g, '"')}'`,
      { stdio: 'inherit' },
    )
    console.log(`✓ Commented on issue #${number}`)
  } catch (error) {
    console.error(`✗ Failed to comment on issue #${number}:`, error)
  }
}

/**
 * Main function
 */
async function main() {
  // Read published packages from environment variable (set by GitHub Actions)
  const publishedPackagesJson = process.env.PUBLISHED_PACKAGES
  const repository = process.env.REPOSITORY || process.env.GITHUB_REPOSITORY

  if (!publishedPackagesJson) {
    console.log('No packages were published. Skipping PR comments.')
    return
  }

  if (!repository) {
    console.log('Repository is missing. Skipping PR comments.')
    return
  }

  let publishedPackages: Array<PublishedPackage>
  try {
    publishedPackages = JSON.parse(publishedPackagesJson)
  } catch (error) {
    console.error('Failed to parse PUBLISHED_PACKAGES:', error)
    process.exit(1)
  }

  if (publishedPackages.length === 0) {
    console.log('No packages were published. Skipping PR comments.')
    return
  }

  console.log(`Processing ${publishedPackages.length} published package(s)...`)

  // Group PRs by number
  const prMap = groupPRsByNumber(publishedPackages)

  if (prMap.size === 0) {
    console.log('No PRs found in CHANGELOGs. Nothing to comment on.')
    return
  }

  console.log(`Found ${prMap.size} PR(s) to comment on...`)

  // Collect issues linked to PRs
  const issueMap = new Map<number, IssueInfo>()

  // Comment on each PR and collect linked issues
  for (const pr of prMap.values()) {
    await commentOnPR(pr, repository)

    // Find issues that this PR closes/fixes
    const linkedIssues = findLinkedIssues(pr.number, repository)
    for (const issueNumber of linkedIssues) {
      if (!issueMap.has(issueNumber)) {
        issueMap.set(issueNumber, {
          number: issueNumber,
          prs: new Set(),
          packages: [],
        })
      }
      const issueInfo = issueMap.get(issueNumber)!
      issueInfo.prs.add(pr.number)

      // Merge packages, avoiding duplicates
      for (const pkg of pr.packages) {
        if (
          !issueInfo.packages.some(
            (p) => p.name === pkg.name && p.version === pkg.version,
          )
        ) {
          issueInfo.packages.push(pkg)
        }
      }
    }
  }

  if (issueMap.size > 0) {
    console.log(`\nFound ${issueMap.size} linked issue(s) to comment on...`)

    // Comment on each linked issue
    for (const issue of issueMap.values()) {
      await commentOnIssue(issue, repository)
    }
  }

  console.log('\n✓ Done!')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
