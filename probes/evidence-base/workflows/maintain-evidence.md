# Establish and maintain evidence

Input: a requested claim, registered rules and the current application context.
Output: applicable evidence and an argument, or a precise unresolved requirement.

1. Ask the base for the claim's support, gaps and challenges. Reuse compatible
   shared premises instead of investigating each caller separately. Do not treat
   a warning or permitted optimization as evidence that its claim is established.
   Read the structured routes: premises within one route are jointly required;
   other routes are alternatives. A flat gap inventory is not a completion plan.
2. Choose one supported evidence route for the missing premise. State the scope
   it can establish and what it will leave open. If the problem is missing
   behavior rather than missing knowledge, make the authorized code repair;
   another certificate cannot supply behavior that does not exist.
3. Capture relevant code, data, method, configuration, environment and external
   dependencies. Use freshness/expiry requirements defined by the package. The
   prototype requires explicit context advances; hashes alone cannot renew an
   old test after code reversion.
4. Run the check through the runner or submit an honestly labeled inspection
   under its rubric. Automatic failures are reported by the runner. Operational
   failures stay in CI. Preserve separate observations from the same run.
5. Propose the argument and reassess the original claim. Keep any uncovered
   remainder and counterexample visible. An inconclusive note does not close the
   investigation. Project policy, not this workflow, determines permitted use.
6. On a rubric-only change, reassess still-applicable evidence first. On a relevant
   context change, obtain fresh evidence. On a counterexample, follow the repair
   workflow; a newer unrelated green run is insufficient.
   Freshness applies to resolution evidence too. In the epoch prototype, advancing
   context reopens the need for current original-case replay even if history has
   an earlier valid resolution.

Stop with the exact missing premise when no registered method can establish it.
That is input to designing or repairing a check, not permission to self-certify.
