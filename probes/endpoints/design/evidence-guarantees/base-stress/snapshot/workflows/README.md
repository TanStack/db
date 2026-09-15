# Claim and checker authoring workflows

These procedures ship beside the base prototype. They adapt the useful operations
of the Field Lab to authoring programming checks; they do not require the Field
Lab plugin. No named instrument is automatically launched. A human or agent can
follow the bounded steps and keep the resulting artifacts in its claim package.

Use [Design a check](design-check.md) for a new claim or checker,
[Maintain evidence](maintain-evidence.md) to establish existing claims for an
application, and [Repair a rule](repair-rule.md) after a counterexample or a
change in the required guarantee.

The base and the authoring process do different jobs. The base can check rule
applications. The process helps authors discover whether the rules deserve to be
trusted. Completing the process does not make sampled tests a universal proof.

Package output should include:

- A versioned claim definition: law, subject, parameters, conditions and scope.
- The checker/admission rule and declared trusted inputs.
- Counterexamples, reference/oracle, replay format and sensitivity controls.
- Human-readable failures: the unmet premise, applicable next steps and limits.
- Relevant context/freshness requirements and migration notes when rules change.
- The reasoning for the chosen acceptance standard and unresolved challenges.

These are content requirements, not a final persistence schema. Severity and
consumer permission stay in project policy. No authoring workflow silently
changes them or changes application code.
