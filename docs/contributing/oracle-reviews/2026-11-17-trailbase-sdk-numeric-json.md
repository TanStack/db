# TrailBase SDK numeric JSON receiving defect

The installed `trailbase@0.14.3` JavaScript SDK rejects a legal finite JSON
number before the Collection adapter receives it. This is separate from the
adapter's mutation-confirmation defect and does not authorize narrowing the
shared JSON fidelity domain.

The smallest SSE witness is an empty complete list followed by one insert
whose `value` is `Number.MAX_VALUE`. The shared eager receiver expects that
row, but records none. A direct SDK list and a direct SDK SSE reader both
reject with:

```text
SyntaxError: Cannot convert 1.7976931348623157e+308 to a BigInt
```

The SDK's `parseJSON` reviver checks `Number.isInteger(value)` and
`!Number.isSafeInteger(value)` before converting `context.source` to BigInt.
`Number.MAX_VALUE` satisfies those numeric tests, while its legal JSON exponent
spelling is not a legal BigInt constructor argument. JSON number syntax permits
that exponent. The same issue affects other integral doubles encoded with an
exponent; SSE and list transport share this reviver.

The relevant upstream source is
[`crates/assets/js/client/src/json.ts`](https://github.com/trailbaseio/trailbase/blob/f7a68cdf409597ac3c33a22ba1b41f3a3acd41f7/crates/assets/js/client/src/json.ts).
The file's most recent change is `3f52065452cd3dcc557365f93f032e4aa9d3f6d7`.
Its faulty predicate matches the installed distribution. The accompanying
[proposed patch](2026-11-17-trailbase-sdk-json-integer-lexeme.patch) adds a lexical
integer-token guard before BigInt conversion. Exponent and decimal tokens keep
their parsed Number representation, while unsafe integer tokens retain the
existing exact BigInt conversion. No adapter fallback or installed-package edit
is part of the proposal.

Evidence on unchanged adapter production and installed SDK:

- Shared eager receiver: **134 passed, two semantic failures**, each caused by
  this numeric parsing defect. Both fixed and random campaigns reach the
  intended public-row/status comparison, rather than failing test setup.
- Direct SDK list and SSE probes reproduce the exact SyntaxError. Logs are
  `.review-2377/trailbase-sdk-precise-probes.log`; the scratch probe source is
  retained beside it as `.test.ts.txt`.
- A copied SDK distribution with only the proposed predicate change, supplied
  through an isolated Vite alias, passes **136/136** shared eager checks. This
  includes complete fixed-seed and fresh 600-history campaigns and their
  generated reach and value calibrations. Log:
  `.review-2377/trailbase-sdk-eager-json-proposal.log`. The actual dependency
  directory and lockfile are untouched.

The proposal has no upstream commit, publication, deployment or dependency
upgrade. The ordinary installed-SDK receiver intentionally remains RED until
the SDK release supplies a repair. No live TrailBase service, arbitrary split
SSE frames or every numeric representation is established. This evidence also
does not prove the SDK's unsafe-integer/REAL typing policy universally correct;
it isolates the exponent token that currently throws.
