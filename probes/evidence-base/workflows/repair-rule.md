# Repair a claim or checker

Input: a reported counterexample, failed sensitivity control, or changed claim.
Output: a versioned repair with explicit applicability and retained history.

1. Preserve the original law, inputs, context, observed failure and relevant rule
   versions. Determine whether the report is a speculative challenge, application
   bug, checker bug, generator gap or operational failure. Do not dismiss a
   counterexample merely because the producer is also under investigation.
2. Reproduce it against the relevant boundary. Shrink while preserving the same
   violation. Trace why the existing checker or oracle failed to detect it; name
   the missing law, generator dimension, adapter observation or false assumption.
3. Repair the application, rule, checker or generator as warranted. A rule change
   needs its own version and a stated effect on dependent arguments. A narrower
   claim retains the original unresolved requirement. A different strategy gets
   its own argument rather than inheriting the old result.
4. Rerun the original failure and broader applicable oracle/sensitivity controls.
   A passing execution resolves only the failure it actually exercised. Record
   the resolution explicitly; keep the earlier observation intact.
   Invoke the replay check after the failure has been recorded. A delayed earlier
   pass or another observation in the failing batch cannot substitute for that
   execution. Keep resolution history and recheck its applicability after later
   context changes; a stale repair observation does not permanently clear a failure.
5. Reassess affected compatible uses. For a relevant contradiction to an admitted
   Endpoints optimization, the consumer falls back while investigation proceeds.
   This does not repair already-open clients or establish a general missing-
   evidence policy. The current prototype only reports support; production
   consumer enforcement is not implemented.

If changed versions cannot be matched safely, retain that uncertainty. Do not
invent a generic newest-result-wins rule. End with repaired scope, test outcomes,
remaining challenges and any authoring work still required.
