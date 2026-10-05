# Contributing

## Questions

If you have questions about implementation details, help, or support, please use our dedicated community forum at [GitHub Discussions](https://github.com/TanStack/db/discussions). **PLEASE NOTE:** If you choose to open an issue for your question instead, your issue may be closed and redirected to the forum.

## Reporting issues

If you have found what you think is a bug, please [file an issue](https://github.com/TanStack/db/issues/new/choose). **PLEASE NOTE:** Issues that are identified as implementation questions or non-issues may be closed and redirected to [GitHub Discussions](https://github.com/TanStack/db/discussions).

## Suggesting new features

If you are here to suggest a feature, first create an issue if it does not already exist. From there, we can discuss use cases for the feature and how it could be implemented.

## Development

If you have been assigned to fix an issue or develop a new feature, please follow these steps to get started:

- Fork this repository.
- Use the Node.js version mentioned in `.nvmrc`.

  ```bash
  nvm use
  ```

- Enable [Corepack](https://nodejs.org/api/corepack.html) so the [pnpm](https://pnpm.io/) version mentioned in `package.json` is used.

  ```bash
  corepack enable
  ```

- Install dependencies.

  ```bash
  pnpm install
  ```

- Build all packages.

  ```bash
  pnpm build
  ```

- Run tests.

  ```bash
  pnpm test
  ```

- Run linting.

  ```bash
  pnpm lint
  ```

- Implement your changes and tests in the relevant package or example.
- Document your changes in the appropriate doc page.
- Git stage your required changes and commit them.
- Submit a PR for review.

### Editing the docs locally and previewing changes

The documentation for all TanStack projects is hosted on [tanstack.com](https://tanstack.com), which is a TanStack Start application (https://github.com/TanStack/tanstack.com). You need to run this app locally to preview your changes in the `TanStack/db` docs.

> [!NOTE]
> The website fetches doc pages from GitHub in production, and searches for them at `../db/docs` in development. Your local clone of `TanStack/db` needs to be in the same directory as the local clone of `TanStack/tanstack.com`.

You can follow these steps to set up the docs for local development:

1. Make a new directory called `tanstack`.

```sh
mkdir tanstack
```

2. Enter that directory and clone the [`TanStack/db`](https://github.com/TanStack/db) and [`TanStack/tanstack.com`](https://github.com/TanStack/tanstack.com) repos.

```sh
cd tanstack
git clone git@github.com:TanStack/db.git
# We probably don't need all the branches and commit history
# from the `tanstack.com` repo, so let's just create a shallow
# clone of the latest version of the `main` branch.
# Read more about shallow clones here:
# https://github.blog/2020-12-21-get-up-to-speed-with-partial-clone-and-shallow-clone/#user-content-shallow-clones
git clone git@github.com:TanStack/tanstack.com.git --depth=1 --single-branch --branch=main
```

> [!NOTE]
> Your `tanstack` directory should look like this:
>
> ```text
> tanstack/
>    |
>    +-- db/ (<-- this directory cannot be called anything else!)
>    |
>    +-- tanstack.com/
> ```

3. Enter the `tanstack/tanstack.com` directory, install the dependencies, and run the app in dev mode.

```sh
cd tanstack.com
pnpm i
# The app will run on http://localhost:3000 by default
pnpm dev
```

4. Visit http://localhost:3000/db/latest/docs/overview in the browser and see the changes you make in `tanstack/db/docs` there.

> [!WARNING]
> You will need to update `docs/config.json` if you add a new documentation page.

### Running examples

- Make sure you've installed dependencies in the repo's root directory.

  ```bash
  pnpm install
  ```

- If you want to run an example against your local changes, run the relevant package build/watch command from the repo root if needed. Otherwise, examples may run against the latest published TanStack DB release.

- Run the example from the selected example directory.

  ```bash
  pnpm dev
  ```

#### Note on standalone execution

If you want to run an example without installing dependencies for the whole repo, follow the instructions from the example's README.md file. It will then run against the latest TanStack DB release.

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to automate releases. If your PR should release a new package version (patch, minor, or major), please run `pnpm changeset` and commit the generated file. If your PR affects docs, examples, styles, etc., you probably don't need to generate a changeset.

## Pull requests

Maintainers merge pull requests by squashing all commits and editing the commit message if necessary using the GitHub user interface.

Use an appropriate commit type. Be especially careful with breaking changes.

## Releases

For each new commit added to `main`, a GitHub Workflow is triggered which runs the [Changesets Action](https://github.com/changesets/action). This generates a preview PR showing the impact of all changesets. When this PR is merged, the package will be published to npm.
