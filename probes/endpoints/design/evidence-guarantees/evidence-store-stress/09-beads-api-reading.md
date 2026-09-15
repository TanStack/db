# Beads API: supplied-source reading

Kyle supplied https://github.com/gastownhall/beads during the Guide-word review
as a possible evidence API or inspiration. Read on 2026-09-15 from the repository's
live main branch; links are not pinned to a commit. This is a documentation and
source reading, not an integration test or a decision to adopt Beads.

## Observed interfaces

The [CLI reference](https://github.com/gastownhall/beads/blob/main/docs/CLI_REFERENCE.md)
provides `bd ready --json --explain`, `bd show`, comments, notes, dependency
links, queries and explicit close/reopen commands. Dependency links include
`validates`, `supersedes` and `discovered-from`. Notes can be appended separately
from status updates. These are useful operations to examine for our agent-facing
workflow.

The [data model](https://github.com/gastownhall/beads/blob/main/internal/types/types.go)
has JSON metadata on issues, metadata on relationships, comments with authors and
timestamps, and events with old/new values. `validates` is a reference relation;
`AffectsReadyWork` handles only the blocking relation types. A named validation
edge does not itself implement our claim-specific assessment.

The [Go API](https://github.com/gastownhall/beads/blob/main/beads.go) exposes
dependent queries and an event feed. It also exposes atomic task claiming,
version-checked updates and guarded closure. These could help concurrent agents
avoid overwriting work; they do not establish the correctness of the evidence.

The [README](https://github.com/gastownhall/beads#readme) describes Dolt-backed
storage, embedded/server modes and remote synchronization. Adoption would include
that storage choice. It also advertises compaction of closed tasks, which needs
separate examination before using it for evidence history we must retain.

## Candidate correspondences for review

These are possible mappings, not established Beads semantics or chosen APIs:

| Our operation | Relevant Beads pattern |
| --- | --- |
| Show the next useful investigation and its prerequisites | Ready-work query with an explanation |
| Preserve an inconclusive attempt | Add a comment without changing task state |
| Reuse one helper claim across endpoints | Shared record with incoming/outgoing typed links |
| Attach a result or source analysis to a claim | Separate record linked to the claim, with structured metadata |
| Retain a superseded result | Explicit relation to a later record |
| Find affected claims after a change | Query dependents |

The remaining Endpoints-specific work includes subject/dependency fingerprints,
expiry, claim scope, rubric assessment, automatic oracle reporting and the
deferred check-level policy. Graph storage could hold these facts, but a task's
closed status or a `validates` link must not silently stand in for that assessment.
That distinction follows our review decisions rather than a Beads feature claim.

Kyle subsequently clarified that we would not use Beads itself (R21). It remains
API inspiration only; store integration is no longer an open option. The remaining
design question is which interface patterns serve our claims, evidence and
investigations. We will need our own versioning and retention semantics.
No package was installed and no Beads commands were executed.
