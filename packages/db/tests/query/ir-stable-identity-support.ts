// Shared query fixtures for the stable identity tests. The law and its
// oracle are owned by ir-stable-identity-oracle.test.ts; these helpers only
// build query IRs and the production identity of a projected expression.
import { CollectionImpl } from '../../src/collection/index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import { eq } from '../../src/query/builder/functions.js'
import { getQueryIdentity } from '../../src/query/ir-stable-identity.js'
import {
  CollectionRef,
  Func,
  IncludesSubquery,
  PropRef,
  QueryRef,
  UnionAll,
  Value,
} from '../../src/query/ir.js'
import { includesRuntime } from '../../src/query/live/includes-runtime.js'
import type { BasicExpression, QueryIR } from '../../src/query/ir.js'

export interface User {
  id: number
  name: string
  email?: string | null
  active: boolean
  age: number
  salary: number
  status: `active` | `inactive`
  teamId: string
  departmentId: number | null
  createdAt: Date
  profile?: {
    skills: Array<string>
    experience: {
      years: number
    }
  }
  blob?: Uint8Array
  largeViewCount?: bigint
}

export function getProjectedExpressionIdentity(
  expression: BasicExpression,
): string {
  return getQueryIdentity({
    ...getQueryIR(new Query().from({ user: usersCollection })),
    select: { value: expression },
  })
}

export interface Post {
  id: number
  userId: number
  title: string
  published: boolean
  views: number
  createdAt: Date
}

export const usersCollection = new CollectionImpl<User>({
  id: `users`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

export const postsCollection = new CollectionImpl<Post>({
  id: `posts`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

export function createProfileValueQuery(value: unknown): QueryIR {
  return {
    ...getQueryIR(new Query().from({ user: usersCollection })),
    where: [
      new Func<boolean>(`eq`, [
        new PropRef([`user`, `profile`]),
        new Value(value),
      ]),
    ],
  }
}

export function createAlphaRenamedJoinQuery(
  userAlias: string,
  postAlias: string,
): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      userAlias,
    ),
    join: [
      {
        type: `inner`,
        from: new CollectionRef(
          postsCollection as unknown as ConstructorParameters<
            typeof CollectionRef
          >[0],
          postAlias,
        ),
        on: new Func('eq', [
          new PropRef([userAlias, `id`]),
          new PropRef([postAlias, `userId`]),
        ]),
      },
    ],
    where: [
      new Func(`eq`, [new PropRef([postAlias, `published`]), new Value(true)]),
    ],
    select: {
      userId: new PropRef([userAlias, `id`]),
      postTitle: new PropRef([postAlias, `title`]),
    },
    orderBy: [
      {
        expression: new PropRef([postAlias, `createdAt`]),
        compareOptions: { direction: `desc`, nulls: `last` },
      },
    ],
  }
}

export function createAlphaRenamedImplicitJoinQuery(
  userAlias: string,
  postAlias: string,
): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      userAlias,
    ),
    join: [
      {
        type: `inner`,
        from: new CollectionRef(
          postsCollection as unknown as ConstructorParameters<
            typeof CollectionRef
          >[0],
          postAlias,
        ),
        on: new Func('eq', [
          new PropRef([userAlias, `id`]),
          new PropRef([postAlias, `userId`]),
        ]),
      },
    ],
  }
}

export function createProjectedExpressionQuery(
  expression: BasicExpression,
): QueryIR {
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      `user`,
    ),
    select: { value: expression },
  }
}

export function createAlphaRenamedNestedQuery(
  innerAlias: string,
  outerAlias: string,
): QueryIR {
  const inner: QueryIR = {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      innerAlias,
    ),
    select: {
      id: new PropRef([innerAlias, `id`]),
      status: new PropRef([innerAlias, `status`]),
    },
  }
  return {
    from: new QueryRef(inner, outerAlias),
    where: [
      new Func(`eq`, [
        new PropRef([outerAlias, `status`]),
        new Value(`active`),
      ]),
    ],
    select: { id: new PropRef([outerAlias, `id`]) },
  }
}

export function createUnionDerivedNestedQuery(outerAlias: string): QueryIR {
  const users = new Query()
    .from({ user: usersCollection })
    .select(({ user }) => ({ id: user.id, kind: user.status }))
  const posts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ id: post.id, kind: post.title }))
  const union = new Query()
    .unionAll(users, posts)
    .where(({ kind }) => eq(kind, `active`))

  return getQueryIR(
    new Query().from({ [outerAlias]: union } as Record<string, typeof union>),
  )
}

export function createUnionDerivedNestedOutputQuery(
  outerAlias: string,
): QueryIR {
  const users = new Query()
    .from({ user: usersCollection })
    .select(({ user }) => ({ profile: { id: user.id } }))
  const posts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ profile: { id: post.id } }))
  const union = new Query()
    .unionAll(users, posts)
    .where(({ profile }) => eq(profile.id, 1))

  return getQueryIR(
    new Query().from({ [outerAlias]: union } as Record<string, typeof union>),
  )
}

export function createUnionDerivedIncludesQuery(parentAlias: string): QueryIR {
  const firstPosts = new Query()
    .from({ post: postsCollection })
    .select(({ post }) => ({ id: post.id, userId: post.userId }))
  const secondPosts = new Query()
    .from({ otherPost: postsCollection })
    .select(({ otherPost }) => ({
      id: otherPost.id,
      userId: otherPost.userId,
    }))
  const childQuery = getQueryIR(new Query().unionAll(firstPosts, secondPosts))
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([`userId`]),
    `posts`,
    includesRuntime,
    undefined,
    undefined,
    `array`,
  )

  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}

export function createCorrelatedUnionIncludesQuery(
  parentAlias: string,
): QueryIR {
  const createBranch = (childAlias: string): QueryIR => ({
    from: new CollectionRef(
      postsCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      childAlias,
    ),
    select: {
      profile: { id: new PropRef([childAlias, `id`]) },
      userId: new PropRef([childAlias, `userId`]),
      parentAge: new PropRef([parentAlias, `age`]),
    },
  })
  const childQuery: QueryIR = {
    from: new UnionAll([createBranch(`firstPost`), createBranch(`secondPost`)]),
    where: [new Func(`eq`, [new PropRef([`profile`, `id`]), new Value(1)])],
  }
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([`userId`]),
    `posts`,
    includesRuntime,
    undefined,
    [new PropRef([parentAlias, `age`])],
    `array`,
  )

  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}

export function createAlphaRenamedIncludesQuery(
  parentAlias: string,
  childAlias: string,
): QueryIR {
  const childQuery: QueryIR = {
    from: new CollectionRef(
      postsCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      childAlias,
    ),
    select: {
      id: new PropRef([childAlias, `id`]),
      title: new PropRef([childAlias, `title`]),
    },
  }
  const posts = new IncludesSubquery(
    childQuery,
    new PropRef([parentAlias, `id`]),
    new PropRef([childAlias, `userId`]),
    `posts`,
    includesRuntime,
    [
      new Func(`eq`, [
        new PropRef([parentAlias, `status`]),
        new Value(`active`),
      ]),
    ],
    [new PropRef([parentAlias, `id`])],
    `array`,
  )
  return {
    from: new CollectionRef(
      usersCollection as unknown as ConstructorParameters<
        typeof CollectionRef
      >[0],
      parentAlias,
    ),
    select: {
      id: new PropRef([parentAlias, `id`]),
      posts,
    },
  }
}
