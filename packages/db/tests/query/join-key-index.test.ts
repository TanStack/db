import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'

/**
 * Lazy joins on a collection's primary key should load through the implicit
 * key index instead of falling back to a full collection scan, without the
 * user having to create an explicit index on the key field.
 */

type Team = { id: string; name: string }
type Member = { id: string; teamId: string }

const sampleTeams: Array<Team> = [
  { id: `t1`, name: `Team One` },
  { id: `t2`, name: `Team Two` },
  { id: `t3`, name: `Team Three` },
]

const sampleMembers: Array<Member> = [
  { id: `m1`, teamId: `t1` },
  { id: `m2`, teamId: `t1` },
  { id: `m3`, teamId: `t2` },
]

describe(`lazy join on the primary key without an explicit index`, () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, `warn`).mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const indexWarnings = () =>
    warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes(`Join requires an index`))

  const makeTeamsCollection = () =>
    createCollection(
      mockSyncCollectionOptions<Team>({
        id: `key-join-teams`,
        getKey: (r) => r.id,
        autoIndex: `off`,
        initialData: sampleTeams,
      }),
    )

  const makeMembersCollection = () =>
    createCollection(
      mockSyncCollectionOptions<Member>({
        id: `key-join-members`,
        getKey: (r) => r.id,
        autoIndex: `off`,
        initialData: sampleMembers,
      }),
    )

  test(`loads through the key index and does not warn`, () => {
    const teams = makeTeamsCollection()
    const members = makeMembersCollection()

    const joined = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ member: members })
          .join({ team: teams }, ({ member, team }) =>
            eq(team.id, member.teamId),
          )
          .select(({ member, team }) => ({
            memberId: member.id,
            teamName: team.name,
          })),
    })

    expect(
      joined.toArray
        .map(stripVirtualProps)
        .sort((a, b) => a.memberId.localeCompare(b.memberId)),
    ).toEqual([
      { memberId: `m1`, teamName: `Team One` },
      { memberId: `m2`, teamName: `Team One` },
      { memberId: `m3`, teamName: `Team Two` },
    ])

    expect(indexWarnings()).toEqual([])
  })

  test(`serves join keys that appear after the initial load`, () => {
    const teams = makeTeamsCollection()
    const members = makeMembersCollection()

    const joined = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ member: members })
          .join({ team: teams }, ({ member, team }) =>
            eq(team.id, member.teamId),
          )
          .select(({ member, team }) => ({
            memberId: member.id,
            teamName: team.name,
          })),
    })

    // `t3` is not referenced by the initial members, so it was not part of
    // the initial lazy snapshot. A new member pointing at it must trigger an
    // index-served load for that key.
    members.utils.begin()
    members.utils.write({
      type: `insert`,
      value: { id: `m4`, teamId: `t3` },
    })
    members.utils.commit()

    expect(
      joined.toArray.map(stripVirtualProps).find((r) => r.memberId === `m4`),
    ).toEqual({
      memberId: `m4`,
      teamName: `Team Three`,
    })

    expect(indexWarnings()).toEqual([])
  })

  test(`still warns when the joined collection has a computed key`, () => {
    const teams = createCollection(
      mockSyncCollectionOptions<Team>({
        id: `key-join-teams-computed`,
        // Computed key: cannot be introspected into a key index.
        getKey: (r) => `team:${r.id}`,
        autoIndex: `off`,
        initialData: sampleTeams,
      }),
    )
    const members = makeMembersCollection()

    const joined = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ member: members })
          .join({ team: teams }, ({ member, team }) =>
            eq(team.id, member.teamId),
          )
          .select(({ member, team }) => ({
            memberId: member.id,
            teamName: team.name,
          })),
    })

    // Data still flows via the full-load fallback.
    expect(joined.toArray).toHaveLength(3)
    expect(
      indexWarnings().filter((m) => m.includes(`key-join-teams-computed`)),
    ).not.toEqual([])
  })
})
