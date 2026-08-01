# CR-001 — Scoring model, finding labelling, and finding-detail UX

**Raised:** 30 Jul 2026 · **Extended:** 31 Jul 2026 (D-CR8 – D-CR12) · **Status:** ✅ Accepted · **Author:** Group 16
**Affects:** SRS · SAD · Backend Analysis Engine doc · Release Roadmap · Data-model decisions · Frontend plans · data contract
**Release impact:** all changes land in **v1.0**. One feature (custom scoring sliders) is **pulled forward from v1.1**; nothing is pushed out.

> **Why this file exists.** Twelve decisions were taken over two sessions, and several of them contradict what the deliverables said the day before. A reader who opens the SRS in September needs to know *why* the formula changed, not just that it did. This is the record of that reasoning. Each decision below states the problem, the decision, and the rationale — so any of them can be defended in the viva or reversed on purpose rather than by accident.
>
> **D-CR1 – D-CR7** were taken on 30 Jul and change *how a finding is scored and presented*. **D-CR8 – D-CR11** were taken on 31 Jul and resolve a contradiction that only became visible **because** of D-CR6: once the profile is editable at any moment, a *stored* score is a bug waiting to happen. **D-CR12** closes the long-open D5 by reading the actual SATD dataset, and amends D-CR4. They belong in one record because each set exists only as a consequence of the previous one.

---

## Summary

| # | Decision | Was | Now |
|---|---|---|---|
| **D-CR1** | Severity is system-owned | Undefined — used everywhere, assigned nowhere | Fixed per rule in the **rule register**, at design time |
| **D-CR2** | SATD severity | Flat `Medium` for every SATD finding | Derived from a **comment-marker regex table** (High / Medium / Low) |
| **D-CR3** | `Source` enum | `rule \| satd \| security \| ml-risk` | **`rule \| satd`** — two detectors, two values |
| **D-CR4** | Scoring profile shape | 4 mixed-axis weights + `w_ml` | **Category weights + one trust slider `s`**; `w_ml` removed *(weight count fixed at **6** by D-CR12)* |
| **D-CR5** | Risk model in scoring | Additive term in `file_debt` only | **Multiplier** on `finding_priority`; additive term removed |
| **D-CR6** | Profile presets | Presets only (sliders were v1.1) | **Presets + sliders, both in v1.0**; presets seed the sliders |
| **D-CR7** | Finding-detail UX | Slide-over panel over a blurred dashboard | **In-place detail region** + file-tree highlight + persistent finding list |
| **D-CR8** | A profile change is **not** a scan and creates **no** snapshot | Implied but never stated | Stated normatively (FR-20) |
| **D-CR9** | Scores are **derived**, not stored | FR-21 stored `health_score`, `grade`, `delta`, per-file debt | Stored = findings and risk (facts). Derived = every score (opinion) |
| **D-CR10** | The trend chart uses **one lens** | "read from stored snapshots" — ambiguous | All points recomputed under the **currently active** profile, and the chart is labelled with it |
| **D-CR11** | Optional aggregate cache | — | Two precomputed sums per `(category, source)` group keep profile switching instant as history grows |
| **D-CR12** | SATD taxonomy — **closes D5** | 5 categories, unverified against the CSV | **6 categories** — `defect` added on dataset evidence; labels normalised via a documented 1:1 mapping |

**Net formula change:**

```
BEFORE
finding_priority = base_points × category_weight × churn_factor
file_debt        = Σ finding_priority + w_ml × (risk_score × 10)

AFTER
finding_priority = base_points × category_weight × source_trust × churn_factor × risk_factor
file_debt        = Σ finding_priority                     ← additive risk term removed
```

**Net storage change (D-CR9):** the database stores the **findings**; every **score** is derived on read under the active profile.

---

## D-CR1 · Severity is system-owned, defined in the rule register

**Problem.** `severity` was load-bearing — it produced `base_points`, it drove the Refactor-First badge, and the critical-security visibility floor was defined in terms of it — but **no document said where it came from**. The backend doc explained `category` assignment in detail (§4) and never mentioned severity. SRS FR-8 listed the fields a rule finding records and omitted it.

**Decision.** Severity is a **fixed property of the rule that fired**, written by the team into the rule register at design time. It is:

- ❌ **not** user-configurable (that is what the category weights are for)
- ❌ **not** ML-predicted (see D-CR2)
- ✅ decided once, per rule, in a table under version control

The rule register for v1.0:

| `ruleId` | category | severity | base_points |
|---|---|---|---|
| `hardcoded-secret` | security | **Critical** | 8 |
| `sql-concat` | security | **High** | 5 |
| `dangerous-eval` | security | **High** | 5 |
| `complex-function` (CCN > 15) | code-design | **Medium** | 3 |
| `long-method` (> 80 NLOC) | code-design | **Medium** | 3 |
| `deep-nesting` (> 4) | code-design | **Medium** | 3 |
| `duplicate-block` | code-design | **Low** | 1 |
| `large-file` (> 800 NLOC) | code-design | **Low** | 1 |

**Rationale.** Severity and weight answer different questions, and merging them destroys both:

| | Question | Owner |
|---|---|---|
| `severity` | *How bad is this kind of problem?* | The system — the same answer for every team |
| `category_weight` | *How much does this team care about that type?* | The user — different per team |

A leaked API key is Critical regardless of anyone's sprint pressure. What a team may legitimately change is how far up the list it appears. Keeping severity system-owned is also what makes the **visibility floor real**: `hardcoded-secret = Critical` is a constant no profile setting can reach.

**Rejected alternative — user-settable severity per debt type.** It is mathematically the same lever as `category_weight` (both multiply into the same product), so the profile would have become non-identifiable — many different settings producing identical rankings, with no way for a user to tell what they had changed. It would also have let a user set security to Low and defeat FR-24.

---

## D-CR2 · SATD severity comes from a comment-marker regex table

**Problem.** Every SATD finding was assigned `Medium`. That is arbitrary: `# FIXME: auth check is bypassed` and `# TODO: rename this variable` are not equally bad, and a flat constant says they are.

**Decision.** After the classifier decides a comment *is* debt and assigns its category, a deterministic regex over the comment text assigns severity:

| Severity | Pattern (case-insensitive, word-boundary) | base_points |
|---|---|---|
| **High** | `\b(FIXME\|BUG\|XXX\|BROKEN\|DO\s*NOT\s*(SHIP\|MERGE))\b` | 5 |
| **Medium** | `\b(TODO\|HACK\|TEMP\|TEMPORARY\|WORKAROUND\|KLUDGE\|REFACTOR)\b` | 3 |
| **Low** | `\b(NOTE\|REVIEW\|NIT\|IDEA\|QUESTION\|MAYBE)\b` | 1 |
| **Medium** *(default)* | no marker matched — the classifier caught it from prose alone | 3 |

Evaluation order is **High → Medium → Low**; the highest match wins, so `# FIXME: TODO later` is High. Patterns match anywhere in the comment, not only at the start.

**Rationale.** The three tiers encode a real distinction: `FIXME`/`BUG`/`BROKEN` mean *something is wrong*; `TODO`/`HACK` mean *it works but it is ugly*; `NOTE`/`NIT` mean *for your information*. The mechanism is the same one already used for rules — a small hand-written table — so it is explainable line by line and needs no additional model.

**Why the model does not predict severity.** A supervised model can only predict what its training data labels. The Li et al. SATD dataset labels **categories**, not severities; there is no answer key for severity, so it cannot be learned. The enum is instead held in a documented 1:1 mapping with the dataset labels (D-CR12).

**A no-marker match is still a finding.** The classifier catching *"this whole module is a mess, sorry"* with no marker keyword is precisely why ML-1 exists rather than a plain regex scan. Those default to Medium.

---

## D-CR3 · `Source` collapses to `rule | satd`

**Problem.** The enum had four values, two of which were unsound:

- **`security` duplicated the category.** Security patterns run *inside* the rule engine — SRS FR-8 and backend §3.1 both say so explicitly. So a security finding was always `source: "security"` **and** `category: "security"`: the same word on both axes, perfectly correlated. That contradicts the §4 principle that source and category are orthogonal.
- **`ml-risk` was a value nothing could hold.** FR-10 states the risk score is *not* a line item; it lives on `FileScore`, not on `Finding`. No fixture ever used it, because no finding can ever have it.

**Decision.**

```ts
export type Source = "rule" | "satd";   // the only two producers of findings
```

Nothing is lost:

| Question | Now answered by |
|---|---|
| "Is this a security issue?" | `category === "security"` |
| "How bug-prone is this file?" | `FileScore.riskScore` (+ the file badge) |
| "Which rule fired, and by what mechanism?" | `ruleId` — the rule register in SRS Appendix C.1 |

**Rationale.** FR-15 already described the list as *"the top **rule/SATD** findings"* — two sources, stated in the requirements a year before the enum was written. Collapsing to two also makes the trust slider (D-CR4) coherent: it has two ends **because there are exactly two sources**, so the slider spans the whole axis rather than part of it.

**UI consequence.** The finding card shows the `source` chip **only for SATD** findings; `rule` is the default and needs no chip. A SATD row therefore carries three chips (category · severity · SATD), a rule row two.

---

## D-CR4 · Profile = 5 category weights + one trust slider; `w_ml` removed

**Problem.** The weight vector did not match the formula it fed. The formula said `category_weight`, indexed by category. The contract shipped `{ security, codeDesign, satd, duplication }` — which mixes three different axes:

- `security`, `codeDesign` — categories ✅
- `satd` — a **source**, not a category ❌
- `duplication` — a **rule**, not a category ❌

and omitted three real categories entirely (`requirement`, `documentation`, `test`). A documentation-category SATD finding had no defined weight. Presets hid this; sliders would have exposed it directly to the user as a control that does nothing.

**Decision.** Two separate controls, each on one axis:

```
category_weight[category]        # 6 sliders — security · code-design · defect · requirement · documentation · test
s ∈ [0, 1], default 0.5          # 1 slider — "rules ←→ model"

rule_trust = 0.5 + s             # 0.5 … 1.5
ml_trust   = 1.5 − s             # 1.5 … 0.5

source_trust(finding) =
    1.0          if finding.category == "security"     ← never de-weighted (FR-24)
    rule_trust   if finding.source == "rule"
    ml_trust     if finding.source == "satd"
```

`w_ml` is **removed** as a separate control and folded into `ml_trust` (see D-CR5).

**Rationale.** The two questions are genuinely different and both are legitimate:

- *"Which type of debt matters to us?"* → the six category sliders
- *"How much do we trust the model versus the rules?"* → the trust slider

The trust slider is a single degree of freedom, which is exactly right: for ranking purposes only the **ratio** between the two sources matters. Mapping it so that `s = 0.5` gives 1.0 to both means the default position changes nothing, and neither end ever reaches zero — so no slider position can silently suppress a finding.

**Security is excluded from the trust multiplier, keyed on `category`.** All security detection is deterministic, so without this exclusion the "trust the model" end of the slider would quietly halve the priority of every security finding — an inversion nobody would intend. Keying the exclusion on category rather than source also keeps it correct if decision D5 turns out to yield a security-like SATD label.

**Profile is now 6 numbers.** Down from 7 (4 weights + `w_ml` + the two missing categories that would have been needed).

---

## D-CR5 · Risk model multiplies priority; the additive term is removed

**Problem — a contradiction between two requirements.** FR-10 stated the risk score *"boosts ranking"*. FR-11's formula never used it. Ranking was therefore identical for a Medium finding in a 0.95-risk file and the same finding in a 0.05-risk file — the promise in FR-10 was not implemented by FR-11.

**Decision.** Risk becomes a per-file multiplier, structurally identical to churn:

```
risk_factor(file) = 1 + ml_trust × risk_score        # 1.0 – 2.5
```

and the additive `+ w_ml × (risk_score × 10)` term is **removed from `file_debt`**:

```
file_debt = Σ finding_priority (open findings only)
```

**Rationale.**

1. **It fixes the contradiction** — risk now actually moves findings up the list.
2. **A multiplier is the right shape.** Churn is already a per-file 0–1-derived signal applied to every finding in that file; risk is the same kind of thing and deserves the same treatment. An additive term would have shifted a Low finding as much as a Critical one, which is blunt; a multiplier scales proportionally.
3. **The additive term had to go, or risk would be counted twice** — once inside every finding's priority and once again at file level.
4. **Removing it also removes a bad UX outcome.** With the additive term, a file could be tinted red purely by risk and then open to an **empty** detail panel — *"this file is red because the model feels uneasy"*, which is exactly the un-actionable noise the product exists to avoid. Every point of debt now traces to a finding a user can click.

**Accepted consequence.** A risky file with **zero findings** now scores zero debt and shows green. ML-2 can amplify files that already have findings but can no longer surface a file on its own. Mitigation: the `risk 0.78` badge stays on the file row and in the tree (FR-10 already required it), so risk remains **visible as its own signal** without inventing debt. Two honest signals are preferred to one blended number. Objective 5 is unaffected — the model is still evaluated on its own precision / recall / F1 / AUC.

**Known correlation, accepted.** CCN feeds both the `complex-function` rule *and* ML-2's feature vector, so the same evidence softly compounds. The multiplier is bounded at 2.5×, and removing product metrics from ML-2 would cripple a model designed to combine product and process signals. The bound also gives a useful guarantee: the maximum combined boost is `churn 2.0 × risk 2.5 = 5×`, which is **less than the 8× spread between Low (1) and Critical (8)** — so within a category, ML can nudge the ordering but can never push a Low finding above a Critical one.

**Calibration note.** `file_debt` has changed scale — a term was removed and a multiplier of up to 2.5× added. **`k` must be recalibrated** on the golden repositories; the previous value is not valid.

---

## D-CR6 · Custom sliders move to v1.0; presets are retained

**Decision.** Both ship in v1.0. The three presets — **Balanced** (default), **Security-first**, **Delivery-speed** — become **seed values** that populate the sliders, with a **Reset to preset** action. Selecting a preset is one click; dragging from there is optional.

| Profile | security | code-design | defect | requirement | documentation | test | `s` |
|---|---|---|---|---|---|---|---|
| **Balanced** (default) | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.5 |
| **Security-first** | 3.0 | 1.0 | 1.2 | 0.8 | 0.5 | 1.0 | 0.5 |
| **Delivery-speed** | 1.5 | 1.2 | 1.5 | 0.8 | 0.5 | 0.5 | 0.7 |

*(The `defect` column was added by **D-CR12**. Security-first raises it modestly because an admitted known defect is a latent failure; Delivery-speed raises it further because known bugs are what actually block shipping.)*

**Rationale for pulling sliders forward.** The cost is far lower than it looks, because every layer below the UI already supports it: `SCORE_PROFILE` already stores `jsonb weights` and `is_preset`; the contract already carries a full weight vector; and scoring is already a pure function over stored findings, so re-scoring on change already works. What was missing is the slider controls, a save action, one endpoint, and value clamping.

**Rationale for keeping the presets.** Three reasons, any one sufficient:

1. **Something must be the default.** "Balanced" is not really a preset — it is the initial state of every new workspace. It cannot be deleted, only renamed.
2. **The demo depends on it.** The product's clearest 30-second demonstration is *"same findings, different lens, no rescan"* — one click from Balanced to Security-first, and the leaked key jumps to #1. With sliders alone that becomes "let me drag six controls to particular values first."
3. **It is the anti-SonarQube position.** Opening a configuration screen with six raw numeric sliders and no guidance is the experience the product is differentiating against, and it works directly against usability requirements U-1 and U-2.

**Clamping.** Category weights are clamped to **0.1 – 3.0** and `s` to **0 – 1**. `repo_health` is calibrated against `k`; unbounded weights would let a user drive every repository to grade E and make the health score meaningless.

**The visibility floor becomes code, not prose.** With presets only, "critical security findings are never suppressed" was safe by construction. Once a user can drag the security weight to 0.1, it must be **implemented**: critical security findings are pinned into the visible list regardless of computed priority (FR-24).

---

## D-CR7 · Finding detail renders in place, not as a slide-over

**Problem.** The slide-over covers the dashboard and blurs it. During triage — reading many findings in sequence — that means the file tree is unusable, moving to the next finding costs a close-and-reopen, and the panel is too narrow to render a code snippet without wrapping.

**Decision.** Selecting a finding switches the dashboard into a **detail mode** in place:

| Region | Dashboard mode | Detail mode |
|---|---|---|
| Left / main | Overall Health card + trend chart | **Finding detail** — evidence, reason, `file:line:symbol`, room for the snippet ([v1.1]) |
| Right | Hotspot file tree | Hotspot file tree — **auto-expanded and highlighting the finding's file** |
| Bottom | *(part of the left column)* | **Refactor-First list, shrunk** — swap between findings without closing |

Closing the finding restores the health card and trend chart, and the list returns to its full position.

**Rationale.** This is the standard **master–detail** pattern (mail clients, IDEs, GitHub PR review) and it is the right shape for "read many items in sequence", which is what triage is. It also adds spatial context a slide-over structurally cannot: seeing *where* the finding lives while reading it. Practically, it is what makes the [v1.1] code snippet viable — a snippet in a narrow overlay wraps and becomes unreadable; in the main region it renders properly.

**Timing rationale — do it now.** The backend does not exist yet and the test suite is small, so this is the cheapest moment this change will ever have. The seam is already in place: `DashboardView` already holds `selectedFinding` and `detailOpen`, and the detail panel is already a standalone tested component. Only its container changes.

**Scope guardrails.** This is a **layout change, not a feature expansion**:

- v1.0 stays **view-only** — accept / resolve / false-positive remain [v1.1]
- the code snippet remains [v1.1]; v1.0 builds the space for it
- the same `FindingDetailPanel` component is reused

**Costs accepted.** Two layout states to build and test instead of one; the tree must auto-expand and scroll to reveal the selected file; the selected finding needs to live in the URL (`?finding=<fingerprint>`) so refresh and the back button behave; and the 1280 px minimum viewport (U-13) needs a deliberate breakpoint plan. FR-14b [v2] (hover a node to re-scope the trend chart) has nowhere to render while detail mode is open — noted for v2, no action now.

---

## D-CR8 · A profile change is not a scan

> *Taken 31 Jul 2026. This decision and the three that follow exist because of D-CR6: once the profile is editable at any moment, questions that never arose under fixed presets have to be answered.*

Changing a weight, dragging the trust slider, or picking a preset **re-scores stored findings in place**. The user does not press Scan, no worker runs, no clone happens, and **no new snapshot row is written**.

**Why a snapshot would be wrong.** A snapshot is keyed by commit SHA — it is the record of *what the code was at that commit*. A profile is not a commit. If a profile change wrote a snapshot, the trend chart would show a step on a day when **nobody touched the code**: the line would read *"our codebase got worse"* when it actually means *"we changed our mind about what matters."* That destroys `delta` (FR-12) and the trend (FR-14) — the two features the append-only store exists to serve.

**One SHA, one snapshot.** The Scan button responds to code changes only.

---

## D-CR9 · Findings are stored; scores are derived

**Problem — a direct contradiction between two requirements.** FR-20 says a profile change re-scores instantly with no re-scan. FR-21 said the snapshot *stores* "the health score, per-file scores… and category breakdown". Both cannot be true: with an editable profile, a stored score is either **stale** the moment a weight changes, or must be **updated** — and updating breaks the append-only immutability that DB-3 and the trend chart depend on. The contradiction was dormant only while profiles were fixed presets.

**Decision.**

> **Store the facts. Derive the opinions. Never store an opinion as if it were a fact.**

This is the same line already drawn between `severity` (system-owned fact) and `category_weight` (user-owned opinion) in D-CR1 — applied one level up.

| | Kind | Treatment |
|---|---|---|
| `FINDING` rows — file, line, symbol, `source`, `category`, `severity`, evidence, reason | **Fact** about a commit | **Stored**, immutable |
| `FILE_SCORE.risk_score` — ML-2's output at that SHA · `churn_factor` — measured from the commit-anchored window | **Fact** (fixed inputs, fixed output) | **Stored** |
| `commit_sha`, `scanned_at`, `finding_count`, `model_version` | **Fact** | **Stored** |
| `priority`, `file_debt`, `health_score`, `grade`, `delta`, tree tint, category breakdown | **Opinion** under a profile | **Derived on read** |

**Performance is not a concern at v1.0 scale.** Scoring is a pure weighted sum over stored rows — a few thousand multiply-adds for a full 20-scan history. This does not violate P-2 ("no computation on read"), whose intent is *no re-analysis and no re-scan on read*; a weighted sum over already-stored rows is not analysis.

**Denormalised columns are permitted as a cache**, not as the source of truth. If `SCAN.health_score` is kept to make the Projects-list hint fast, it shall be stamped with the profile that produced it and recomputed whenever the active profile differs.

---

## D-CR10 · The trend chart shows one lens at a time

**Every point on the trend chart shall be computed under the currently active profile.**

- Switching to Security-first redraws the **entire** history under Security-first.
- The line then means: *"under this lens, this is how our health has moved."*
- Every point is comparable with every other point.

**Mixing profiles along one line is prohibited.** A chart whose third point used Balanced and whose seventh used Security-first compares nothing to nothing — the reader cannot tell whether a movement was a code change or a settings change.

**The chart shall be labelled with the active profile** (e.g. *"Health trend · Security-first"*). Without the label, the shape changing after a profile switch reads as a bug; with it, the cause is visible. The same labelling applies to any exported or screenshotted figure.

`delta` (FR-12) stays meaningful because both snapshots in the comparison are scored under the same active profile.

---

## D-CR11 · Optional aggregate cache — keeping it instant

Recomputation is already cheap, but it can be made near-free, because the priority formula is multiplicative and the profile factors are **constant within a `(category, source)` group**. There are at most 5 × 2 = **10 groups**.

Per snapshot, store two sums per group:

```
A[c,s] = Σ (base_points × churn_factor)
B[c,s] = Σ (base_points × churn_factor × risk_score)

file/repo debt under any profile
      = Σ over groups   category_weight[c] × source_trust[s] × (A[c,s] + ml_trust × B[c,s])
```

This is **exact, not an approximation**: `category_weight` and `source_trust` factor straight out of the sum, and `risk_factor = 1 + ml_trust × risk_score` splits cleanly into the `A` and `B` halves. Re-scoring a whole trend becomes a couple of hundred multiply-adds and stays correct while a user drags a slider.

These aggregates are **derived from stored findings** and may be rebuilt at any time, so they are a cache and not a second source of truth. Build this only if the read path actually becomes slow.

---

## D-CR12 · The SATD taxonomy, confirmed against the dataset — **closes D5**

> *Taken 31 Jul 2026, after the dataset was cloned into `apps/ml/data/raw/satd-different-sources-data/`. D5 — "confirm the category labels against the CSV" — has been open since the SRS was first drafted and was the last item blocking the first migration. It is now closed on evidence rather than on assumption.*

### What the data actually says

`satd-dataset-code_comments.csv` — **62,275 labelled comments**, the only source v1.0 infers on (D-CR2, FR-9.1):

| `classification` in the CSV | count | share of all comments | share of debt |
|---|---|---|---|
| `non_debt` | 58,204 | 93.46 % | — |
| `code/design_debt` | 2,703 | 4.34 % | 66.4 % |
| `requirement_debt` | 757 | 1.22 % | 18.6 % |
| **`defect_debt`** | **472** | **0.76 %** | **11.6 %** |
| `test_debt` | 85 | 0.14 % | 2.1 % |
| `documentation_debt` | 54 | 0.09 % | 1.3 % |

### Three findings

**1. There is a sixth category we did not have: `defect_debt`.** A developer admitting a *known bug* — the dataset's own example: `// FIXME formatters are not thread-safe`. It is **not** in the four types the Li et al. paper headlines (code/design, requirement, documentation, test), but it **is** in the comments data, with **472 labelled instances — more than `test` and `documentation` combined**. Dropping it would discard the third-largest debt class and leave real defect admissions unclassifiable.

*It is also distinct from ML-2.* The risk model predicts **future** bug-proneness from metrics; `defect` debt is a developer **admitting a current, known** defect in prose. Different evidence, different mechanism, both useful.

**2. `non_debt` is the negative class, not a category.** It is the output of FR-9's first decision — *is this comment debt at all?* — and must never appear in the `Category` enum or as a slider.

**3. The four sources do not share a taxonomy.** This is new, hard evidence for FR-9.1:

| Source | Label set |
|---|---|
| **code comments** | `code/design_debt` · `requirement_debt` · **`defect_debt`** · `test_debt` · `documentation_debt` |
| commit messages | `code_debt` · `design_debt` *(split!)* · `documentation_debt` · `test_debt` · `build_debt` · `requirement_debt` · `architecture_debt` |
| issues | same as commits, **plus** `defect_debt` |
| pull requests | same as commits, **plus** `defect_debt` |

Comments merge code and design into one label; the other three split them and add `architecture_debt` and `build_debt` that comments never use, and only comments/issues/PRs carry `defect_debt`. So training on all four sources is not merely a data-volume decision — it would require **reconciling three different taxonomies** onto one output space, and would leave `architecture_debt` and `build_debt` with no home in the product enum. FR-9.1's comments-only inference scope was already justified on three grounds; this is a fourth, and the most concrete.

**Consequence — v1.0 trains on the comments file alone.** `satd-dataset-code_comments.csv` only; the commit-message, issue and pull-request CSVs are **not used in v1.0**. 62,275 labelled comments (4,071 of them debt) is a workable corpus on its own, and training on the same distribution the model will serve removes train/serve skew entirely — held-out comments become a genuine test set rather than a proxy for one. Normative in **FR-9.1**.

### Decision — the `Category` enum, frozen

Six values. Five come from the comments dataset; `security` is rule-engine-only and never predicted.

| `Category` (product) | Dataset label | Assigned by |
|---|---|---|
| `code-design` | `code/design_debt` | ML-1 **and** rule engine |
| `requirement` | `requirement_debt` | ML-1 |
| `defect` | `defect_debt` | ML-1 |
| `documentation` | `documentation_debt` | ML-1 |
| `test` | `test_debt` | ML-1 |
| `security` | *(none — not in the dataset)* | Rule engine only |

**Why normalise the strings rather than copy them verbatim.** The requirement is a **1:1 mapping**, not identical spelling — a deterministic rename cannot affect trainability, because the model is trained on the CSV's own strings and the mapping is applied to its output. Verbatim labels would put a `/` into a value that has to survive URLs, CSS class names and filter parameters, would carry a redundant `_debt` suffix on every category, and would leave `security` as the only value not following the pattern. The mapping table above is the single normative conversion and belongs in the ML service's post-processing step.

### Consequences

- **The profile has six category weights, not five** (amends D-CR4). Preset table updated in FR-20.
- **Severe class imbalance must be reported, not hidden.** `documentation` (54) and `test` (85) are under 0.15 % of comments each. Per-class precision / recall / F1 are mandatory in FR-25; a single averaged figure would conceal near-total failure on two classes. The paper's headline **F1 = 0.611** is for its own four-type task across four sources and is **not** a like-for-like baseline for a six-category, comments-only classifier.
- **Licence resolved: MIT** (© 2022 Yikun Li). Permissive, commercial use permitted, attribution required — so the non-commercial concern recorded against L-3 does not apply to *this* dataset. It applies to the separate Technical Debt Dataset, which v1.0 does not use.
- **D5 is closed.** The enum can be frozen and the first migration can proceed.

---

## The resulting model

```
churn_factor(file) = 1 + min(commits_90d, 20) / 20         # 1.0 – 2.0
                     # 90d measured back from the SCANNED COMMIT'S committer date,
                     # never from wall-clock now().  (Decision D6, 27 Jul 2026)

risk_factor(file)  = 1 + ml_trust × risk_score             # 1.0 – 2.5

finding_priority   = base_points(severity)        ← system: the rule register (D-CR1, D-CR2)
                   × category_weight[category]    ← user:   6 sliders        (D-CR4, D-CR12)
                   × source_trust(finding)        ← user:   trust slider     (D-CR4)
                   × churn_factor(file)           ← evidence: how hot
                   × risk_factor(file)            ← model:  how bug-prone    (D-CR5)

file_debt          = Σ finding_priority (open findings only)
repo_health        = 100 × (1 − min(1, Σ file_debt / (k × KLOC)))   # k RECALIBRATED
grade              = A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E < 40
```

Every term has exactly one owner and exactly one job, and nothing is counted twice.

### Worked example (re-run under the new model)

`payments/payment_service.py` — NLOC 420, max CCN 18, 14 commits in the 90-day window → `churn_factor = 1.7`. ML-2 risk = 0.78.

| # | source | finding | category | severity | base |
|---|---|---|---|---|---|
| F1 | rule | `complex-function` — `charge()` CCN 18 > 15 | code-design | Medium | 3 |
| F2 | rule | `long-method` — `charge()` is 95 NLOC | code-design | Medium | 3 |
| F3 | satd | `# TODO: temporary hack until v2 ships` → marker `TODO` | code-design | Medium | 3 |
| F4 | rule | `hardcoded-secret` — Stripe API key | security | Critical | 8 |

**Balanced** (all weights 1.0, `s = 0.5` → `rule_trust = ml_trust = 1.0`, `risk_factor = 1.78`):

| | calculation | priority |
|---|---|---|
| F1 | 3 × 1.0 × 1.0 × 1.7 × 1.78 | **9.08** |
| F2 | 3 × 1.0 × 1.0 × 1.7 × 1.78 | **9.08** |
| F3 | 3 × 1.0 × 1.0 × 1.7 × 1.78 | **9.08** |
| F4 | 8 × 1.0 × **1.0** × 1.7 × 1.78 | **24.21** |

`file_debt = 51.45`

**Security-first** (`security = 3.0`, `s = 0.5`): F4 → 8 × 3.0 × 1.0 × 1.7 × 1.78 = **72.62**, the others unchanged. `file_debt = 99.86`, and F4 is unambiguously the #1 Refactor-First item.

**Trust-the-rules** (`s = 1.0` → `rule_trust = 1.5`, `ml_trust = 0.5`, `risk_factor = 1.39`): F1 → **10.63**, F3 (SATD) → **3.54**, F4 → **18.90**. The self-admitted TODO drops below the measured rule findings — which is exactly what a team that says "we trust the rules more than the model" is asking for.

Same findings in all three cases. **Detection is profile-independent; only scoring reads the profile** — so switching profiles re-ranks in milliseconds from stored findings and never triggers a rescan.

---

## Documents updated by this CR

| Document | Sections |
|---|---|
| `docs/Deliverables/Software_Requirements_Specification.md` | §1.3 glossary · FR-8 · FR-8.1 (new) · FR-9 · FR-9.2 (new) · FR-10 · FR-11 · FR-15 · FR-17 · FR-18 · FR-20 · FR-24 · §3.9.1 · Appendix C · **FR-12 · FR-14 · FR-21 (rewritten) · DB-1 · DB-3 · DB-8 (new)** *(D-CR8 – D-CR11)* |
| `docs/Deliverables/Software_Requirements_Specification.docx` | Regenerated from the same content |
| `docs/Deliverables/Software_Architecture_Document.md` | §5.2 domain model · §6.1 · §9 data view *(incl. the `SCAN` / `FILE_SCORE` column split for D-CR9)* · §11 quality |
| `docs/Project Management & Planning/code-sage_backend-analysis-engine.md` | §3.1 · §3.2 · §4 · §6 · §7.1 · §7.2 · §8 · **new §7.3** *(D-CR8 – D-CR11)* |
| `docs/Project Management & Planning/release-roadmap.md` | §2 v1.0 scope · §3 v1.1 · §6 feature gates · §7.1 closed decisions |
| `docs/Project Management & Planning/data-model-decisions.md` | D-1 enum freeze · new D-4 profile shape · **new D-5 store-facts-not-scores** |
| `docs/Project Management & Planning/frontend_build_stepbystep.md` | Phase overview + **new Phase 10.5** (phases 0–10 untouched — already complete) |
| `docs/Project Management & Planning/frontend_prototype_plan.md` | §2.2 layout · §2.3 interaction contracts · §6.1 contract |
| `README.md`, `apps/web/README.md` | Status and data-layer notes |

**Not updated by this CR:** `Software_Requirements_Specification_JP.docx` (under separate authorship).

## Code changes required — not yet applied

These are specified here and scheduled as **Phase 10.5** in the frontend build guide. No source file has been modified by this CR.

| File | Change |
|---|---|
| `apps/web/src/lib/types/index.ts` | `Source` → `"rule" \| "satd"`; `ScoreProfile.weights` → 5 category keys; `wMl` → `trust` (`s`) |
| `apps/web/src/lib/mocks/fixtures.ts` | `source: "security"` → `"rule"`; re-key the three preset profiles |
| `apps/web/src/components/dashboard/refactor-first-list.test.tsx` | Two fixture rows use `source: "security"` |
| `apps/web/src/components/dashboard/finding-detail-panel.tsx` | Source chip rendered only when `source === "satd"` |
| `apps/web/src/components/dashboard/dashboard-view.tsx` | Detail mode replaces the health/chart region (D-CR7) |
| `apps/web/src/components/dashboard/file-tree/file-tree.tsx` | Auto-expand and highlight the selected finding's file |
| `apps/web/src/app/(app)/profiles/page.tsx` | Six sliders + preset seeds + reset |

---

## Open items this CR does **not** close

- **`k` recalibration.** Required by D-CR5; do it on the golden repositories before quoting any health score.
- **Splitting the trust slider.** One dial currently governs both ML-1 (SATD findings) and ML-2 (risk). The two models have different accuracies, so separate dials are a reasonable **[v1.1]** option if users ask for it. Not built now — one dial suits the low-configuration positioning.

---

*CR-001 accepted 30 Jul 2026 (D-CR1 – D-CR7); extended 31 Jul 2026 (D-CR8 – D-CR12). Any reversal of D-CR1 through D-CR12 should be recorded as a new CR rather than by editing this file.*
