---
instrument: donor-perturb
mode: sighted-analogy-search
run: 18
title: "Formal-systems donor pass for TanStack Trust"
question: "What mechanisms from Datalog/Prolog, SAT/SMT, TLA+/Alloy, and formal provenance can sharpen the TanStack Trust RFC without transferring domain authority into the base?"
researched_at: 2026-09-16
status: complete
---

# Formal-systems donor pass for TanStack Trust

## Operation boundary

This is the user-selected **sighted** continuation of the Donor Perturbation
Rig. The home design was visible throughout: TanStack Trust's domain/base/
workflow/interface/consumer seams, its AND/OR argument routes, applicability,
challenge and repair semantics, and the selected O2 ownership outline. It is
therefore an analogy search, not a blind donor perturbation. Home vocabulary
shaped both source choice and mapping, and the same analyst inspected and
mapped the sources. Correlation and confirmation risk remain high.

The pass adds four donor families to the earlier survey. ATMS, Carneades,
Assurance 2.0, PROV, and Lean are overlap controls, not new donors. No
architecture, solver dependency, rule language, status model, or roadmap is
selected here.

Fit labels have a narrow meaning:

- **solid:** the donor relation directly matches an already supported home
  relation; it does not establish implementation value.
- **plausible:** the relation is coherent and bounded, but is not tested in the
  prototype.
- **reach:** the transfer needs an additional semantic or operational premise.

## Bounded readout

| Donor | Mechanism retained | Strongest transfer | Main boundary |
| --- | --- | --- | --- |
| D11 — Datalog/Soufflé | Facts and recursive rules derive relations; proof trees explain tuples | AND within a rule and OR across rules make argument routes executable and inspectable `[fit: solid]` | Entailment is only relative to supplied facts and rules; ordinary positive derivation does not model applicability, defeaters, or repair |
| D12 — SAT/SMT/Z3 | `sat` yields a model, `unsat` can yield a core, and `unknown` remains a distinct result | A domain check can search for counterexamples or inconsistent declarations and return a structured witness `[fit: plausible]` | The encoding is a domain-owned trust root; solver state is not durable evidence history |
| D13 — TLA+/Alloy | Precise state/relational models are checked for properties; tools return examples or counterexamples under declared bounds | Model checking is a domain check form whose trace, scope, model, and property can become an observation `[fit: solid]` | A property of the model is not automatically a property of the implementation; Alloy's result is bounded by scope |
| D14 — provenance semirings | Addition records alternative derivations; multiplication records joint use; polynomials retain how inputs contributed | Route expressions can expose shared premises and distinguish alternative from conjunctive support `[fit: solid]` | Positive provenance has no general, semantics-free treatment of negation/difference; coefficients are not trust or independence |

## D11 — Datalog and Soufflé

### Source mechanism in its own terms

Soufflé describes Datalog as a declarative logic-based query language for
recursive queries. In the tutorial's transitive-closure example, extensional
`edge` facts and two `reachable` rules derive the output relation. A rule body
joins jointly required tuples; multiple rules can derive the same relation.
Pure Datalog has a finite universe and excludes functors, while Soufflé's
practical arithmetic extensions can make programs nonterminating. [S15]

Soufflé's provenance mode explains a derived tuple with a proof tree. It
computes explanations lazily, retains a producing rule and minimal proof-tree
height for a tuple, and can interactively explain non-existence only after a
person chooses a rule and values for free variables. The documentation says an
automatic explanation of non-existence is not technically feasible in that
interface. [S16]

This pass inspected Datalog through Soufflé. It did not inspect Prolog's search
order, cuts, negation-as-failure, tabling, or other operational behavior, so the
family label does not license a transfer from those Prolog mechanisms.

### Mappings

1. **Rule bodies → jointly required premises `[fit: solid]`.** A Datalog rule
   head follows from all atoms in its body. This is the same structural
   distinction TanStack Trust already makes inside one support route.
2. **Multiple producing rules → alternative routes `[fit: solid]`.** Several
   rules can derive the same tuple without turning their bodies into one large
   conjunction. This supports preserving route structure instead of treating
   `gaps` as the argument.
3. **Proof and non-proof explanation → agent inspection `[fit: plausible]`.** A
   queryable proof tree is a concrete donor for `explain`; guided negative
   explanation is a donor for asking which attempted route and missing premise
   matter. Soufflé's minimal-height tree is not a reason to discard TanStack
   Trust's other live routes.
4. **A general Datalog engine in the base `[fit: reach]`.** Rules would still
   need typed applicability, contradiction, temporal authority, and repair
   semantics. The donor does not show that a rule engine is cheaper or safer
   than the bounded kernel.

### Analogy boundary and frozen negative case

The mechanism derives consequences from the facts and rules it is given. It
does not establish that a fact is current, that a rule is an adequate domain
standard, or that a proof tree corresponds to reality.

**Nearby negative case (frozen):** an old observation remains present as a
fact after its context revision expires. A positive Datalog rule can still
derive `supported(claim)` unless applicability is represented and evaluated by
additional semantics. The derivation is valid relative to its database and
still wrong as a current Trust assessment. This is where the transfer must
fail.

### Overlap control

ATMS already contributes alternative assumption sets; Carneades already
separates statements, arguments, and proof standards. Datalog's incremental
addition is executable rule evaluation plus a query/proof interface. It does
not replace Carneades-style pro/con arguments or Assurance 2.0 defeaters.

## D12 — SAT/SMT and Z3

### Source mechanism in its own terms

Z3 checks satisfiability of logical formulas over supported theories. Its
official guide defines `sat` as the existence of an interpretation satisfying
the asserted formulas, `unsat` as no such interpretation, and `unknown` as the
solver being unable to determine either. After `sat`, `get-model` retrieves an
interpretation. `push` and `pop` create and revert scopes in the solver's
assertion stack. [S17]

*Programming Z3* shows tracked assumptions and unsatisfiable cores: after an
`unsat` result, a core is a subset of assumptions sufficient for
unsatisfiability. It explicitly notes that cores are not minimal by default.
The same source describes incremental checking and models for satisfiable
assertions. [S18]

### Mappings

1. **Model → generated counterexample witness `[fit: plausible]`.** A domain
   author can encode a proposed law plus the negation of the desired property;
   a satisfying model can supply a small case for a checker or design review.
   The model is a generated witness, not a production observation.
2. **Unsat core → conflicting-declaration witness `[fit: plausible]`.** A core
   can identify a sufficient subset of assumptions behind inconsistency in a
   domain package. It does not determine which assumption should be changed,
   and it must not be described as minimal unless separately minimized.
3. **`unknown` → unresolved check result `[fit: solid]`.** The solver's own
   result vocabulary supports preserving inability to decide rather than
   coercing it to pass or fail. The home status still needs to state what was
   unresolved and under which check contract.
4. **SMT as the base assessment semantics `[fit: reach]`.** The current base
   mostly evaluates explicit finite routes. A generic solver would add an
   encoding language, theory selection, resource limits, and explanation
   obligations without resolving domain meaning or applicability.

### Analogy boundary and frozen negative case

SAT/SMT establishes a property of an asserted formula in a particular logical
theory. The person or package that encoded the formula still owns the
correspondence to the software domain. `push`/`pop` is ephemeral solver-state
management, not an append-only historical record, provenance trail, or repair
certificate.

**Nearby negative case (frozen):** an Endpoints encoding omits external writes
and asks whether a skip is safe. Z3 returns `unsat` for the encoded
counterexample query. That supports only the encoded closed world. It cannot
support the production claim that no external writer can invalidate the skip.
This is where the transfer must fail.

### Overlap control

Lean already supplied the small-kernel analogy. An SMT model or core adds
automated witness generation under a decidable/heuristic solver interface; it
does not add proof-assistant-style assurance that the domain encoding means
what its author intends. Assurance 2.0's challenges also survive an `unsat`
result when they target the encoding-to-domain inference.

## D13 — TLA+ and Alloy

### Source mechanism in its own terms

Lamport describes a TLA+ model as a description of some aspect of a system for
some purpose, never a completely accurate description of the real system. A
behavior is a sequence of states; a step is a pair of consecutive states; an
initial condition and next-state relation define the possible behaviors of a
state machine. TLA+ properties include invariants over every state of every
possible behavior and liveness properties saying that something eventually
happens. [S19]

The official TLA+ tools page describes TLC as an explicit-state model checker
for executable TLA+ specifications that checks safety and liveness. It
describes Apalache separately as a symbolic checker for bounded executions and
inductive invariants under finite-data assumptions. [S20]

Alloy's Analyzer can `run` a predicate to find a satisfying example and
`check` an assertion to find a counterexample. Its documentation states that
all Alloy models are bounded and that a wrong scope can hide a model. Dynamic
models have an additional step bound unless an unbounded SMT-backed form is
chosen. [S21] The Alloy tutorial calls Alloy a lightweight relational modeling
language with automatic analysis and visualization of solutions and
counterexamples. [S22]

### Mappings

1. **Model check → domain-owned check form `[fit: solid]`.** A domain package
   can declare a model, property, tool, configuration, and scope. The base can
   record the run and its result without owning the model's meaning.
2. **Counterexample trace/instance → observation and challenge `[fit: solid]`.**
   A violating state trace or Alloy instance is a concrete witness that can
   challenge the modeled claim and be retained for exact replay or regression.
3. **Model purpose and bounds → explicit applicability/omissions
   `[fit: plausible]`.** The check contract can record which aspect was
   modeled, finite bounds, fairness assumptions, and omitted environment. This
   sharpens the domain/base handoff but does not solve applicability ownership.
4. **Model checking as generic Trust semantics `[fit: reach]`.** TLA+ and Alloy
   describe systems in their own formal languages. They do not supply one
   domain-independent meaning for Trust claims, consumer permission, or
   implementation conformance.

### Analogy boundary and frozen negative case

A counterexample is evidence about the model and property that produced it.
Treating it as evidence about code additionally needs a supported refinement,
translation, instrumentation, or conformance relation. Absence of a
counterexample is bounded by the model and, in Alloy, the declared scope.

**Nearby negative case (frozen):** an Alloy check reports no counterexample at
scope three, while the first violating topology requires four nodes. Recording
the run as green is accurate; upgrading it to an unbounded domain guarantee is
not. The scope must remain attached to the observation, and the transfer fails
outside it.

### Overlap control

PROV can say which model, configuration, tool, and agent produced the trace;
it cannot make the trace's abstraction adequate. Lean can check a proof in a
formal system; TLA+/Alloy contribute behavior exploration and concrete
counterexamples. Existing Oracle guidance already requires declared reach,
fault controls, and replay; model checking is another check form under that
contract, not a superior tier.

## D14 — provenance semirings

### Source mechanism in its own terms

Green, Karvounarakis, and Tannen model tuples as annotated `K`-relations. In
positive relational algebra, union and projection add annotations, while join
multiplies them. With provenance polynomials over input-tuple identifiers, a
sum records different derivations and a product records inputs jointly used by
one derivation. The coefficients retain derivation multiplicity. A semiring
homomorphism can evaluate the same symbolic provenance into another annotation
semiring. For recursive Datalog, potentially infinite derivation trees require
fixed points and formal power series; cycles can produce infinitely many
derivations. [S23]

The later difference-limit paper shows that this generality has a sharp
boundary. Provenance semirings work for positive query languages, but no
one-size-fits-all extension to relational difference satisfies all of the
selected expected equivalence axioms for every useful semiring. The authors
say the appropriate semantics depends on the application and desired axioms.
[S24]

### Mappings

1. **Multiplication and addition → AND/OR route expression `[fit: solid]`.** A
   monomial can represent jointly required premises; a polynomial sum can
   retain alternative derivations. This is an explanatory algebra for the
   route structure already present in the base grammar.
2. **Common factor → shared-dependency exposure `[fit: solid]`.** The expression
   `a*b + a*c` makes `a` visible as a premise shared by both apparent
   alternatives. That can expose a common comparator, fixture assumption, or
   analyzer dependency without assigning confidence.
3. **Symbolic expression → multiple projections `[fit: plausible]`.** One
   retained expression could be projected to dependency presence, route count,
   or another justified annotation interpretation. Each projection needs its
   own algebra and domain warrant; the homomorphism theorem does not make
   arbitrary Trust statuses valid semirings.
4. **Semiring evaluation → full Trust assessment `[fit: reach]`.** Challenge,
   negative evidence, expiry, repair authority, and consumer permission are not
   positive query provenance. Forcing them into `+` and `*` would conceal the
   very distinctions TanStack Trust is meant to preserve.

### Analogy boundary and frozen negative case

How-provenance records how an output follows from annotated inputs under a
specified query language. It does not assess the truth, freshness,
independence, or adequacy of those inputs. A coefficient counts derivations; it
is not a confidence score.

**Nearby negative case (frozen):** ten derivations all reuse the same flawed
comparator. Their provenance polynomial has a larger coefficient, but the
evidence is not ten independent confirmations. A retained challenge against
the shared comparator must survive. More strongly, a claim whose state depends
on subtracting a defeated or expired route lies beyond the universal positive
semiring transfer documented by S23/S24. This is where the transfer must fail.

### Overlap control

ATMS already distinguishes alternative minimal assumption sets. Provenance
polynomials add algebraic retention of **how** inputs combine, including common
factors and derivation multiplicity. PROV records production history among
entities, activities, and agents; semiring provenance records computational
lineage through a query. Neither subsumes the other. Carneades and Assurance
2.0 remain necessary controls for con arguments and retained defeaters.

## What genuinely changes the O2 readout

These are source-supported outline effects, not architecture selections:

1. **Domain-owner section:** admit formal models and solver encodings as domain
   artifacts. A model-based check contract must retain its purpose, modeled
   aspect, property, assumptions, bound/scope, tool configuration, and any
   claimed model-to-code correspondence. The base cannot infer those fields.
2. **Base-owner section:** proof trees, models, cores, and counterexample traces
   are typed observations or explanations. They strengthen witnesses without
   changing who owns their semantics. Preserve every applicable route and
   common dependency; do not default to a minimal proof tree or scalar count.
3. **Workflow section:** a generated model or trace can seed a retained
   counterexample and later replay. Repair still needs a causally later check of
   the same violation under the current contract; solver scope reset is not
   repair history.
4. **Interface section:** `explain` should make joint premises, alternatives,
   common dependencies, bounds, and unresolved solver outcomes inspectable.
   Soufflé's guided negative explanation is a useful interaction donor, not a
   requirement to expose a Datalog language.
5. **Borrowed-mechanisms section:** add these four families with their frozen
   failures. The sources support formal check forms and richer explanations;
   they do not support installing a theorem prover inside the generic base.

No donor resolves applicability ownership/cardinality, checker soundness,
semantic equivalence, consumer severity, or fallback. The strongest common
result is an ownership boundary: formal machinery can make a domain claim much
more explicit and its failure much easier to inspect, while the domain still
owns the encoding and the consumer still owns permission.

## Sources and coverage limits

- <a id="s15"></a>**S15 —** [Soufflé tutorial: Introduction to Datalog](https://souffle-lang.github.io/tutorial), official project documentation, accessed 16 September 2026. **Used for:** declarative recursive rules, finite pure-Datalog range, practical nontermination boundary. **Limit:** mutable implementation documentation; not a Prolog semantics source.
- <a id="s16"></a>**S16 —** [Soufflé provenance](https://souffle-lang.github.io/provenance), official project documentation, accessed 16 September 2026. **Used for:** lazy proof trees, minimal-height explanations, guided negation explanation. **Limit:** one implementation's interface; no usability or completeness evaluation.
- <a id="s17"></a>**S17 —** [Z3 Guide: Basic Commands](https://microsoft.github.io/z3guide/docs/logic/basiccommands/), Microsoft Z3 documentation, accessed 16 September 2026. **Used for:** `sat`/`unsat`/`unknown`, models, scopes. **Limit:** command semantics only; no guarantee about a user's encoding.
- <a id="s18"></a>**S18 —** [Programming Z3](https://theory.stanford.edu/~nikolaj/programmingz3.html), Nikolaj Bjørner, Leonardo de Moura, Lev Nachmanson, and Christoph Wintersteiger, technical tutorial, accessed 16 September 2026. **Used for:** tracked assumptions, unsat cores, minimality caveat, incrementality, models. **Limit:** tutorial rather than a solver-soundness audit; no Trust integration run.
- <a id="s19"></a>**S19 —** [A High-Level View of TLA+](https://lamport.azurewebsites.net/tla/high-level-view.html), Leslie Lamport, last modified 10 August 2021. **Used for:** model purpose/boundary, behaviors, Init/Next, invariance and liveness. **Limit:** first-party explanation; no project-specific model was checked.
- <a id="s20"></a>**S20 —** [TLA+ tools](https://lamport.azurewebsites.net/tla/tools.html), official TLA+ site, accessed 16 September 2026. **Used for:** TLC and Apalache checking range. **Limit:** tool overview, not an independent capability evaluation.
- <a id="s21"></a>**S21 —** [Alloy documentation: Commands](https://alloy.readthedocs.io/en/latest/language/commands.html), Alloy documentation, accessed 16 September 2026. **Used for:** `run`, `check`, counterexamples, scope and step bounds. **Limit:** mutable documentation; no Analyzer execution in this pass.
- <a id="s22"></a>**S22 —** [Tutorial for Alloy Analyzer 4.0](https://alloytools.org/tutorials/online/), Rob Seater and Greg Dennis, updated for Alloy 4 by Daniel Le Berre and Felix Chang, accessed 16 September 2026. **Used for:** lightweight modeling, automatic analysis, solution/counterexample visualization. **Limit:** historical tutorial; current commands are taken from S21.
- <a id="s23"></a>**S23 —** [Provenance Semirings](https://repository.upenn.edu/db_research/19), Todd J. Green, Grigoris Karvounarakis, and Val Tannen, PODS 2007, author-posted full paper inspected. [DOI](https://doi.org/10.1145/1265530.1265535). **Used for:** `K`-relations, addition/multiplication, polynomials, homomorphisms, Datalog fixed points and cycle/infinite-derivation boundary. **Limit:** positive relational algebra/Datalog theory; no empirical evidence-system evaluation.
- <a id="s24"></a>**S24 —** [On the Limitations of Provenance for Queries With Difference](https://arxiv.org/abs/1105.2255), Yael Amsterdamer, Daniel Deutch, and Val Tannen, TAPP 2011, full paper inspected. **Used for:** failure of a universal extension to difference and application-relative axiom choice. **Limit:** database query provenance; contradiction and repair in TanStack Trust are only a nearby transfer boundary.

## Stop condition and remaining unmeasured

Each named family now has a primary or official basis, at least one mapped
mechanism, an explicit boundary, and a frozen nearby negative case. Additional
formal-system search would broaden coverage rather than discriminate these
transfers, so this run stops here.

Nothing was implemented or executed against TanStack Trust. Unmeasured are
encoding error rates, authoring cost, solver performance, agent comprehension,
counterexample replay effectiveness, and whether algebraic route explanations
improve maintenance. The source set is English-language, documentation-heavy,
and selected with the home architecture in view. This operation may therefore
have made the ownership seam look more inevitable and formalization more useful
than a blind or field-comparative pass would.
