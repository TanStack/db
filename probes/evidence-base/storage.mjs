import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { EvidenceBase, identity } from './kernel.ts'

export const STORE_FORMAT = 'evidence-store/v1'

function checksum(state) {
  return createHash('sha256').update(identity(state)).digest('hex')
}

export function encodeStore(base, packageId) {
  if (!packageId) throw new Error('Evidence store requires a package ID')
  const state = base.exportState()
  return {
    format: STORE_FORMAT,
    package: packageId,
    checksum: checksum(state),
    state,
  }
}

export function decodeStore(value, rules, expectedPackage) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.format !== STORE_FORMAT ||
    typeof value.package !== 'string' ||
    typeof value.checksum !== 'string' ||
    !value.state
  )
    throw new Error('Invalid evidence store envelope')
  if (expectedPackage && value.package !== expectedPackage)
    throw new Error(
      `Evidence package mismatch: ${value.package} !== ${expectedPackage}`,
    )
  if (checksum(value.state) !== value.checksum)
    throw new Error('Evidence store checksum mismatch')
  return EvidenceBase.fromState(rules, value.state)
}

export async function loadStore(path, rules, options = {}) {
  const absolute = resolve(path)
  try {
    const value = JSON.parse(await readFile(absolute, 'utf8'))
    return decodeStore(value, rules, options.package)
  } catch (error) {
    if (error?.code === 'ENOENT' && options.create)
      return new EvidenceBase(rules)
    throw error
  }
}

export async function saveStore(path, base, packageId) {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(
    temporary,
    JSON.stringify(encodeStore(base, packageId), null, 2) + '\n',
    {
      mode: 0o600,
    },
  )
  await rename(temporary, absolute)
  return absolute
}
