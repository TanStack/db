# TodoMVC audit follow-up

The recorded interaction gaps are now fixed: URL/history/reload filtering,
initial and continued input focus, empty/edit/clear control visibility, counter
markup, hover/focus delete controls, and nonblocking writes. The text limit is
removed. PGlite now persists to disk by default; two-process reopen is tested.

See [the implementation stocktake](./IMPLEMENTATION.md) for the current API,
validation, and limits. No implicit mutation queue remains. Deliberately
out-of-order writes to the same row remain a known race.

Current evidence: `parity-green.log`, `parity-todomvc.log`,
`todomvc-audit-after.json`, and `parity-persistence.log`. The original snapshot
below is retained as the loss ledger, not a list of still-open bugs. Template
styling/storage conventions and untested browser/platform behavior remain
explicit differences.

---

# TodoMVC loss audit

The main CRUD flows work. This is not full TodoMVC parity: routing, focus,
control visibility, and durable storage differ. The mixed checkbox indicator
is now fixed; the other findings below are recorded, not silently marked done.

Baseline: [TodoMVC application specification](https://github.com/tastejs/todomvc/blob/master/app-spec.md),
reviewed 2026-09-10. Scope includes every functionality section, with submission
conventions and prototype-specific tradeoffs listed separately. No upstream
conformance-suite or cross-browser certification is claimed.

## Behavior ledger

| Area | Result in this app | Evidence |
|---|---|---|
| Empty list | **Gap:** toolbar and summary remain visible. | Audit browser snapshot `empty`. |
| Initial focus | **Gap:** new-task input is not focused after loading. | `empty.focused: false`. |
| New task | **Pass:** Enter trims, creates, clears input; whitespace creates nothing. Creation ordering is covered. | Audit assertions; TodoMVC ordering test. |
| Continued entry | **Loss:** focus is lost after adding; typing the next task needs another click. | `focusAfterAdd: false`; pending input disabling. |
| Toggle all | **Pass:** all checked/all unchecked, individual changes, empty and clear-completed states. **Fixed:** mixed completion now sets the native indeterminate property. | Mixed-state regression, including rollback and filtered views. |
| Individual completion | **Pass:** checkbox changes persist; completed row styling and active-filter removal work. | TodoMVC test; `.completed` CSS. |
| Start editing | **Partial:** double-click focuses the editor with existing text. Checkbox and delete controls remain visible; no editing class is set. | `editing` snapshot. |
| Finish editing | **Pass:** Enter/blur save, trimming, empty deletion, Escape discards. Reload discards an uncommitted editor. | TodoMVC test and audit assertions. |
| Delete control | **Difference:** always visible rather than appearing on hover. | `deleteVisibleWithoutHover: true`. |
| Counter | **Partial:** correct active count and pluralization; no strong element around the number. | TodoMVC count assertion; `counterStrong: 0`. |
| Clear completed | **Partial:** deletes only completed rows; remains visible but disabled when unavailable. | TodoMVC test; `empty.clearVisible: true`. |
| Persistence | **Deliberate substitution with a durability loss:** server PGlite survives browser reload, but its in-memory instance does not survive restart. No localStorage backing. Editing state is transient. | Reload tests; `new PGlite()` in database.server.ts. No destructive restart test performed. |
| Filter semantics | **Pass:** local DB predicates; optimistic completion immediately changes membership, with no filter RPC. | Delayed-write and RPC-count assertions. |
| Filter routing | **Gap:** buttons do not change URL, a direct completed hash still selects All, and reload resets the selection. Browser history cannot restore filter changes. | `filterURL`, `hashRouteSelected`, `filterAfterReload`; component state-only implementation. |

## Other differences and limits

- **Pending-write throughput:** all write controls are disabled while one request
  persists. This avoids overlapping actions but loses normal rapid entry and
  independent row interaction during network latency. The `saving` guard also
  ignores a second action in that interval. Source-confirmed, not load-tested.
- **Text limit:** creation and editing impose 200 characters. This is an added
  prototype constraint rather than TodoMVC behavior.
- **Presentation:** the notebook design, task-label buttons, DOM classes, and
  footer differ from the upstream template. The app omits todomvc-common and
  todomvc-app-css. These are submission/style differences, not missing CRUD.
- **Structure/tooling:** a README and package manifest exist; React/TypeScript,
  Vite, and component-local endpoint declarations follow this prototype's design.
  They do not follow the upstream template's file layout or no-preprocessor rule.
- **Schema/storage conventions:** text/createdAt and fixture user scope extend or
  differ from the conventional TodoMVC row shape and storage key.
- **Browser support:** exercised in Chrome only. Other browsers remain unverified.
- **Prototype additions:** server validation, rollback, transaction acknowledgement,
  and isolated fixture users have tests, but are not a substitute for TodoMVC parity.

## Why earlier tests missed these losses

The earlier suite always clicked/focused inputs itself, selected filters through
buttons, and asserted row membership. It did not check initial or restored focus,
URL/history state, hidden controls, or the native indeterminate property. Reload
coverage checked rows rather than the selected filter. Thus “browser tests pass”
was narrower than “TodoMVC parity.”

The new mixed-state assertions fail before the fix and pass afterward. They cover
partial completion, all complete, all active, clearing completed, and rejection
rollback. The audit script records the other gaps without asserting that they
are correct behavior. Future fixes should turn each observation into an expected
behavior assertion; a successful audit script is not a parity pass.

Recommended next fixes: filter URL/history/reload behavior; input focus and
repeat entry; empty/edit/clear control visibility. Keep storage and styling
choices explicit rather than replacing the endpoint/PGlite design merely to
match the reference.

## Reproduction and receipts

Run from this directory against the ordinary dev server (these reset fixture data):

```sh
node tests/todomvc.mjs
node tests/todomvc-audit.mjs
```

- `evidence/mixed-red.log`: missing mixed indicator reproduced.
- `evidence/mixed-green.log`: full UI regression passes with mixed-state assertions.
- `evidence/todomvc-audit.json`: browser observations behind the gap ledger.
- `evidence/mixed-types.log`, `mixed-compiler.log`, `mixed-build.log`: TypeScript,
  eight compiler checks, and production build pass. The new mixed-state behavior
  was browser-tested in development; the production build was checked, not rerun
  in a production browser this turn.
