#!/usr/bin/env node

// Temporary local copy of TanStack/config's comment-on-release action (MIT).
// Copyright (c) 2021-present Tanner Linsley; see ../LICENSE.
// Upstream: e4b48f16568324f76f467aa4c2aac2f05db632c3, .github/comment-on-release/.
// Includes the full-version/anchor repair from KyleAMathews/config d855eba.
// Return to the shared action after that repair is available upstream.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

interface PublishedPackage {
  name: string
  version: string
}

interface ReleasedPackage {
  name: string
  pkgPath: string
  version: string
  anchor: string
}

interface PRInfo {
  number: number
  packages: Array<ReleasedPackage>
}

interface IssueInfo {
  url: string
  prs: Set<number>
  packages: Array<ReleasedPackage>
}

/**
 * Parse CHANGELOG.md to extract PR numbers from the latest version entry
 */
function extractPRsFromChangelog(
  changelogPath: string,
  version: string,
  repository: string,
): { prNumbers: Array<number>; anchor: string } {
  try {
    const content = readFileSync(changelogPath, 'utf-8')
    const lines = content.split('\n')

    let inTargetVersion = false
    let foundVersion = false
    const prNumbers = new Set<number>()
    const anchors = new Set<string>()
    let anchor = ''

    for (const line of lines) {
      // Match the complete version, including prerelease and build suffixes.
      if (line.startsWith('## ')) {
        const heading = line.slice(3).trim()
        const base = heading.toLowerCase().replace(/[.+]/g, '')
        let headingAnchor = base
        let suffix = 0
        // GitHub reserves each heading's ID across the whole document, including
        // IDs allocated as suffixes of an earlier colliding version.
        while (anchors.has(headingAnchor)) headingAnchor = `${base}-${++suffix}`
        anchors.add(headingAnchor)
        if (heading === version) {
          anchor = headingAnchor
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
          /\[#\d+\]\(https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)\)/g,
        )
        for (const match of prMatches) {
          if (match[1]!.toLowerCase() === repository.toLowerCase())
            prNumbers.add(parseInt(match[2]!, 10))
        }
      }
    }

    if (!foundVersion) {
      console.warn(
        `Warning: Could not find version ${version} in ${changelogPath}`,
      )
    }

    return { prNumbers: Array.from(prNumbers), anchor }
  } catch (error) {
    console.error(`Error reading changelog at ${changelogPath}:`, error)
    return { prNumbers: [], anchor: '' }
  }
}

/**
 * Group PRs by their numbers and collect all packages they contributed to
 */
function groupPRsByNumber(
  publishedPackages: Array<PublishedPackage>,
  repository: string,
): Map<number, PRInfo> {
  const prMap = new Map<number, PRInfo>()

  for (const pkg of publishedPackages) {
    const pkgPath = `packages/${pkg.name.replace('@tanstack/', '')}`
    const changelogPath = resolve(process.cwd(), pkgPath, 'CHANGELOG.md')

    const { prNumbers, anchor } = extractPRsFromChangelog(
      changelogPath,
      pkg.version,
      repository,
    )

    for (const prNumber of prNumbers) {
      if (!prMap.has(prNumber)) {
        prMap.set(prNumber, { number: prNumber, packages: [] })
      }
      prMap.get(prNumber)!.packages.push({
        name: pkg.name,
        pkgPath: pkgPath,
        version: pkg.version,
        anchor,
      })
    }
  }

  return prMap
}

/**
 * Check if we've already commented on a PR/issue to avoid duplicates
 */
function hasExistingComment(url: string): boolean {
  try {
    const result = execFileSync(
      'gh',
      [
        'api',
        `repos${new URL(url).pathname}/comments`,
        '--paginate',
        '--jq',
        '[.[] | select(.body | contains("has been released!"))] | length',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    return result.split('\n').some((count) => parseInt(count, 10) > 0)
  } catch (error) {
    console.warn(
      `Warning: Could not check existing comments for ${url}; attempting to post anyway:`,
      error,
    )
    return false
  }
}

/**
 * Find issues that a PR closes/fixes using GitHub's GraphQL API
 */
function findLinkedIssues(prNumber: number, repository: string): Array<string> {
  const [owner, repo] = repository.split('/')
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          closingIssuesReferences(first: 10) {
            nodes {
              url
            }
          }
        }
      }
    }
  `

  try {
    const result = execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `pr=${prNumber}`,
        '--jq',
        '.data.repository.pullRequest.closingIssuesReferences.nodes[].url',
      ],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const issueUrls = result
      .trim()
      .split('\n')
      .filter((line) => line)

    if (issueUrls.length > 0) {
      console.log(`  PR #${prNumber} links to issues: ${issueUrls.join(', ')}`)
    }

    return issueUrls
  } catch (error) {
    console.warn(
      `Warning: Could not find linked issues for PR #${prNumber}:`,
      error,
    )
    return []
  }
}

/**
 * Post a comment on a GitHub PR using gh CLI
 */
async function commentOnPR(pr: PRInfo, repository: string): Promise<void> {
  const { number, packages } = pr

  // Check for duplicate comments
  if (hasExistingComment(`https://github.com/${repository}/issues/${number}`)) {
    console.log(`↷ Already commented on PR #${number}, skipping`)
    return
  }

  // Build the comment body
  let comment = `🎉 This PR has been released!\n\n`

  for (const pkg of packages) {
    // Link to the package's changelog and version anchor
    const changelogUrl = `https://github.com/${repository}/blob/main/${pkg.pkgPath}/CHANGELOG.md#${pkg.anchor}`
    comment += `- [${pkg.name}@${pkg.version}](${changelogUrl})\n`
  }

  comment += `\nThank you for your contribution!`

  try {
    // Use gh CLI to post the comment
    execFileSync('gh', ['pr', 'comment', String(number), '--body', comment], {
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
  const { url, prs, packages } = issue

  // Check for duplicate comments
  if (hasExistingComment(url)) {
    console.log(`↷ Already commented on ${url}, skipping`)
    return
  }

  const prLinks = Array.from(prs)
    .map((pr) => `https://github.com/${repository}/pull/${pr}`)
    .join(', ')
  const prWord = prs.size === 1 ? 'PR' : 'PRs'

  // Build the comment body
  let comment = `🎉 The ${prWord} fixing this issue (${prLinks}) has been released!\n\n`

  for (const pkg of packages) {
    // Link to the package's changelog and version anchor
    const changelogUrl = `https://github.com/${repository}/blob/main/${pkg.pkgPath}/CHANGELOG.md#${pkg.anchor}`
    comment += `- [${pkg.name}@${pkg.version}](${changelogUrl})\n`
  }

  comment += `\nThank you for reporting!`

  try {
    // Use gh CLI to post the comment
    execFileSync('gh', ['issue', 'comment', url, '--body', comment], {
      stdio: 'inherit',
    })
    console.log(`✓ Commented on ${url}`)
  } catch (error) {
    console.error(`✗ Failed to comment on ${url}:`, error)
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
  const prMap = groupPRsByNumber(publishedPackages, repository)

  if (prMap.size === 0) {
    console.log('No PRs found in CHANGELOGs. Nothing to comment on.')
    return
  }

  console.log(`Found ${prMap.size} PR(s) to comment on...`)

  // Collect issues linked to PRs
  const issueMap = new Map<string, IssueInfo>()

  // Comment on each PR and collect linked issues
  for (const pr of prMap.values()) {
    await commentOnPR(pr, repository)

    // Find issues that this PR closes/fixes
    const linkedIssues = findLinkedIssues(pr.number, repository)
    for (const issueUrl of linkedIssues) {
      if (!issueMap.has(issueUrl)) {
        issueMap.set(issueUrl, {
          url: issueUrl,
          prs: new Set(),
          packages: [],
        })
      }
      const issueInfo = issueMap.get(issueUrl)!
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
