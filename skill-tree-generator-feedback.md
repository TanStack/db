# Intent Meta Skill Feedback

## Domain Discovery

- What worked well: Structured interview process produced high-quality failure modes; maintainer insights surfaced critical agent-specific mistakes (draft proxy, API hallucination) that docs wouldn't catch
- What was confusing or missing: Initial domain boundaries needed revision (sync-connectivity was too broad, offline needed separation, meta-framework was missing). The lightweight vs full path decision could use clearer heuristics.
- Suggestions for improvement: Add guidance for when to split vs merge domains during review; the "revisit if no tensions found" heuristic is good but domain size/breadth heuristics would help too
- Overall rating: good

## Tree Generator

- What worked well: Per-framework decomposition rule caught our monolithic framework-integration domain; monorepo layout guidance (skills inside packages, package field in tree) is clear; reference file heuristics (subsystems, dense API surfaces) drove the right structure
- What was confusing or missing: The spec now covers monorepo layout well (v3.0 improvements from our earlier feedback). The skill_tree.yaml format is clean and sufficient for the generate-skill step.
- Suggestions for improvement: Consider adding a "composition skill placement" heuristic — for monorepos, it's unclear which package should own a composition skill (we put meta-framework in packages/db but it could arguably be repo-level)
- Overall rating: good

## Generate Skill

- What worked well: Source-driven generation produced accurate, verifiable skill files; cross-reference validation ensures a cohesive skill graph; parallel agent generation of the 3 largest skills (collection-setup refs, live-queries, mutations) cut wall-clock time significantly; the frontmatter format (name, description, type, requires, sources) is clean and sufficient for agent consumption
- What was confusing or missing: The overview/index skill (db-core/SKILL.md) doesn't fit the "must have Setup + Common Mistakes" template — needs a type-based exemption for index skills; composition skills like meta-framework span multiple frameworks making a single "Setup" section awkward (resolved with numbered steps + per-framework subsections); no guidance on whether reference files need frontmatter
- Suggestions for improvement: Add a "type: index" skill type exemption from structural requirements; provide a reference file template (frontmatter optional vs required); add guidance for skills that span multiple frameworks (like meta-framework) — should they have one Setup per framework or a unified Setup?
- Overall rating: good

## Context (optional)

- Library: @tanstack/db v0.5.30
- Repo: https://github.com/TanStack/db
- Docs: https://tanstack.com/db
- Notes: Monorepo with 15 packages. 7 domains → 12 skills (4 core sub-skills + 5 framework + meta-framework + custom-adapter + offline). Previous scaffolding rounds (v2.0) identified gaps now addressed in v3.0 spec.
