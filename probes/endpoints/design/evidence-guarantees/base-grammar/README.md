# A reusable base for programming evidence

Exploratory Design Grammar, September 15, 2026. The preservation list is
provisional, normalized from the source and the user's explicit requirements.
This is not an exact-equivalence or independent validation result.

## What this tells us

The reusable part is an argument checker and evidence history. Domain packages
define which claims can be made, which observations support them, and which
inference steps are acceptable. The base checks those steps, keeps their
dependencies, and explains what is missing or contradicted.

Six candidate building blocks account for the selected source: a claim, an
observation, a registered rule, an argument applying that rule, an applicability
condition, and a challenge. Runs supply shared provenance; tasks can be derived
from gaps. Neither needs to become another source of authority.

The key relation is **alternatives within obligations**. A goal may require three
premises, each with several acceptable ways to establish it. Strong support for
one premise cannot replace another. Shared premises remain shared across callers.

## What it changes

- A claim can exist before any evidence. The system can explain the missing work
  without confusing an unknown claim with a demonstrated bug.
- One run can report several observations. Agreement, fewer reads and latency
  stay separate; the package must say which observation supports which claim.
- A relevant counterexample remains visible until an applicable resolution
  addresses it. A newer unrelated pass cannot clear it. Returning to earlier code
  does not renew an old test result.
- Claim/check authoring workflows sit beside the base. They help people design
  and attack the semantic rules that the base cannot justify on its own.

Three adjacent forms fit this grammar: deterministic certificate admission,
scoped empirical admission, and rubric-assessed source inspection. They are
different sources of support, not a universal weak-to-strong ranking.

For example, an Endpoints package can define an inference from complete effect
and dependency bounds plus disjointness to a refresh-exclusion claim. It must
state the external-write, completion and other conditions under which that
inference holds. The base does not invent or prove those database assumptions.

## What it does not tell us

Registered semantic rules are a trust boundary. This grammar supplies no proof
that arbitrary checker code, a rubric, or an oracle is sound. Empirical agreement
retains its campaign scope; it does not silently become a universal theorem.
Support also remains separate from project permission and severity. No missing-
evidence veto or priority order has been selected.

Reconstruction accounted for the selected source relations, except that hidden
semantic dependencies remain undiscovered. Removing each of the six primitives,
five relations and ten rules exposed a named loss in a same-analyst conceptual
check. These are not runtime tests. The grammar excludes unsupported certification
edges and unrelated-pass repair by construction; an unsound registered rule can
still admit a false conclusion.

Independent range is **untested**. The source is an existing research arrangement,
not a deployed base system. The Endpoints examples helped construct it and cannot
validate its generality. Claim equivalence, cross-version contradiction matching,
complete context capture, policy and enforcement against an agent controlling the
host remain unresolved. The graph-shaped source and decomposition may also hide
human judgment and the cost of authoring good rules.

## Supporting layers

- [Model](model.json): primitives, rules, overlaps, provisional preservation
  properties, adjacent forms and unresolved conflicts.
- [Evidence](evidence.json): reconstruction, exclusions, range status and losses.
- [Process](process.json): all ablations, rejected extra primitives and the
  brief-to-model support map.
- [Frozen source](source.md) and [hash manifest](freeze.json).

The analytical layers were frozen before this brief was written. Prototype
decisions and test outcomes belong in separate artifacts, not retroactive edits
to this grammar.
