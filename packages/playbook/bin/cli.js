#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const skillsDir = join(__dirname, '..', 'skills')

function listSkills(dir, prefix = '') {
  const items = readdirSync(dir)

  for (const item of items) {
    const itemPath = join(dir, item)
    const stat = statSync(itemPath)

    if (!stat.isDirectory()) continue

    const skillPath = join(itemPath, 'SKILL.md')
    try {
      const content = readFileSync(skillPath, 'utf-8')
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      const descMatch = content.match(/description:\s*\|?\s*\n?\s*(.+)/m)

      const name = nameMatch?.[1] || item
      const desc = descMatch?.[1]?.trim() || 'No description'

      console.log(`${prefix}${name}`)
      console.log(`${prefix}  ${desc}`)
      console.log()
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
      // No SKILL.md, check subdirectories
    }

    listSkills(itemPath, prefix + '  ')
  }
}

function showSkill(skillName) {
  const parts = skillName.split('/')
  let searchDir = skillsDir

  for (const part of parts) {
    const items = readdirSync(searchDir)
    const match = items.find(
      (item) =>
        item.toLowerCase() === part.toLowerCase() ||
        item.toLowerCase().replace(/-/g, '') ===
          part.toLowerCase().replace(/-/g, ''),
    )

    if (match) {
      searchDir = join(searchDir, match)
    } else {
      console.error(`Skill not found: ${skillName}`)
      process.exit(1)
    }
  }

  const skillPath = join(searchDir, 'SKILL.md')
  try {
    const content = readFileSync(skillPath, 'utf-8')
    console.log(content)
  } catch {
    console.error(`SKILL.md not found in: ${searchDir}`)
    process.exit(1)
  }
}

const args = process.argv.slice(2)
const command = args[0]

switch (command) {
  case 'list':
    console.log('TanStack Playbook\n')
    listSkills(skillsDir)
    break

  case 'show':
    if (!args[1]) {
      console.error('Usage: db-playbook show <skill-name>')
      console.error('Example: db-playbook show tanstack-db/live-queries')
      process.exit(1)
    }
    showSkill(args[1])
    break

  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(`TanStack Playbook CLI

Usage:
  db-playbook list              List all available skills
  db-playbook show <skill>      Show a specific skill
  db-playbook help              Show this help message

Examples:
  db-playbook list
  db-playbook show tanstack-db
  db-playbook show tanstack-db/live-queries
  db-playbook show tanstack-db/mutations
`)
    break

  default:
    console.error(`Unknown command: ${command}`)
    console.log(`Run 'db-playbook help' for usage information.`)
    process.exit(1)
}
