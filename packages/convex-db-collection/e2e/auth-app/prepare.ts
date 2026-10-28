import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fetching and verifying the pinned public checkout belongs to test setup. */
export async function prepareAuthApp(checkout: string): Promise<string> {
  const runtime = fileURLToPath(new URL(`./runtime`, import.meta.url))
  await rm(runtime, { recursive: true, force: true })
  const destination = join(runtime, `convex`)
  await mkdir(destination, { recursive: true })
  for (const source of [
    `messages.ts`,
    `schema.ts`,
    `auth.config.ts`,
    `http.ts`,
    `tsconfig.json`,
    `lib`,
  ])
    await cp(join(checkout, `convex`, source), join(destination, source), {
      recursive: true,
    })
  const upstream = await readFile(join(checkout, `convex`, `auth.ts`), `utf8`)
  if (
    !upstream.includes(
      `import GitHub from "@auth/core/providers/github";\nimport Resend from "@auth/core/providers/resend";`,
    ) ||
    !upstream.includes(`providers: [GitHub, Resend],`)
  )
    throw new Error(`Pinned upstream auth provider configuration changed`)
  const auth = upstream
    .replace(
      `import GitHub from "@auth/core/providers/github";\nimport Resend from "@auth/core/providers/resend";`,
      `import { Anonymous } from "@convex-dev/auth/providers/Anonymous";`,
    )
    .replace(`providers: [GitHub, Resend],`, `providers: [Anonymous],`)
  if (auth === upstream || !auth.includes(`providers: [Anonymous],`))
    throw new Error(`Pinned upstream auth provider configuration changed`)
  await writeFile(join(destination, `auth.ts`), auth)
  await writeFile(
    join(runtime, `package.json`),
    JSON.stringify({
      private: true,
      type: `module`,
      dependencies: { convex: `^1.47.0` },
    }),
  )
  return runtime
}
