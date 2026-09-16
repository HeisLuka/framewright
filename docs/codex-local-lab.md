# Local Codex lab for the NEwBOO Video Factory

This is the operator guide for running Codex locally as a creative engineer against the
NEwBOO book-video factory.

The goal is not to let an agent invent a second renderer. The useful loop is:

```text
authoritative local context
  -> creative proposal / reusable code change
  -> canonical validation and compilation
  -> canonical local render queue
  -> physical MP4 + QA/provenance
  -> visual inspection and comparison
  -> iterate in the local branch
```

The first operator is expected to be a developer using a local checkout. No Docker, web UI,
multi-user auth, or cloud queue is required for this stage.

## 1. Start from the actual factory branch

`main` is not the current research/factory baseline. Clone the repository and explicitly
switch to `lab/framewright-research`:

```bash
git clone https://github.com/HeisLuka/nightwill.git
cd nightwill
git fetch origin
git switch --track origin/lab/framewright-research
npm install
npm run doctor
```

If the tracking branch already exists locally:

```bash
git switch lab/framewright-research
git pull --ff-only
```

For autonomous Codex work, prefer a separate worktree so the canonical checkout stays clean:

```bash
git worktree add ../nightwill-codex -b codex/local-lab lab/framewright-research
cd ../nightwill-codex
```

Do not give Codex a standing instruction to merge or push into `lab/framewright-research`.
The lab branch is a proposal surface; promotion remains an explicit review action.

## 2. Local state

Keep operator-only inputs and experiment state outside versioned source:

```text
.codex-lab/
  contexts/       authoritative ContextPack / CopyLanguage snapshots for dogfood
  jobs/           briefs, ingress JSON, campaign requests
  results/        comparison notes or local pointers to rendered results
```

`.codex-lab/` is gitignored. The render worker keeps its own runtime state in
`.local-render-queue/`, which is also gitignored.

For initial dogfood it is fine to supply ContextPack and CopyLanguage as local JSON files.
A live adapter from the `newboo` backend is a later integration. Do not compensate for a
missing backend adapter by fabricating facts inside a creative proposal.

## 3. The canonical creative boundary

C35 is the single user-side LLM ingress. A model may author a candidate, but server-owned
context remains authority:

```text
ContextPack (+ CopyLanguage where required)
  -> newboo-creative-ingress-v1
  -> C35
       trusted_atoms
       verified_composition
       external_copy_review_required
  -> immutable creative program / C27 NarrativePlan
```

The three modes deliberately have different trust semantics:

- `trusted_atoms`: choose server-owned creative atoms. Deterministically publication-trusted
  after validation.
- `verified_composition`: choose server-owned fact surface forms and rhetorical templates.
  Deterministically publication-trusted after validation.
- `external_copy_review_required`: literal external copy is allowed for preview, but remains
  review-required until an exact trusted approval exists.

A successful render does not upgrade creative trust.

Run the deterministic ingress contract suite with:

```bash
npm run check:creative-ingress
```

## 4. NORMAL mode

Use NORMAL mode when the current factory already has the primitives needed for the idea.
Codex should primarily change:

- CreativeIngress choices;
- narrative/presentation parameters;
- selected trusted atoms/forms/templates;
- seeds, allowed presentation systems, pacing choices, or other existing bounded controls.

The expected loop is:

```text
context
  -> candidate ingress
  -> validate / compile
  -> materialize canonical campaign request
  -> render
  -> inspect
  -> revise candidate
```

Do not create a book-specific HTML fork just to avoid an existing contract.

## 5. EXPERIMENT mode

Use EXPERIMENT mode when the current capability set cannot express the useful idea.
Codex may change reusable code such as:

- scene recipes or presets;
- choreography and presentation devices;
- compiler lowering;
- reusable visual primitives;
- bounded renderer behavior when the renderer itself is genuinely the experiment.

Every experiment should leave enough evidence to answer “what became reusable?” rather than
only “did this one video look good?”. A practical local shape is:

```text
.codex-lab/jobs/<experiment>/
  brief.json
  baseline.json
  candidate.json
  notes.md
```

Physical outputs stay in the render queue/result directories and should not be committed.
The branch/PR should contain the reusable code change and a concise evidence report, not MP4
blobs.

Before proposing promotion, verify:

1. publication truth/provenance boundaries were not weakened;
2. the changed creative was physically rendered and visually inspected;
3. runtime QA passed;
4. a baseline/candidate comparison exists when the change claims an improvement;
5. performance claims have measurements, not intuition;
6. the change is reusable across more than one hard-coded book fixture;
7. deterministic identity/replay behavior still holds where the contract requires it.

## 6. Physical factory commands

The stable local worker is I07 around the canonical I03/FAST executor.

Validate queue mechanics:

```bash
npm run check:i07
```

Enqueue a canonical C19 campaign request:

```bash
npm run local:enqueue -- --request <campaign.json> --workspace .
```

Process one job:

```bash
npm run local:worker -- --workspace . --once
```

Run continuously:

```bash
npm run local:worker -- --workspace .
```

Retry a failed job explicitly:

```bash
npm run local:worker -- --workspace . --retry lrj_<sha256> --once
```

For a direct single invocation without the queue wrapper:

```bash
npm run factory:run -- \
  --request <campaign.json> \
  --out-dir <run-dir> \
  --artifact-dir <canonical-cache-dir>
```

I07 job IDs are content-addressed from the exact campaign-request bytes. Re-enqueuing the
same successful request resolves to the same `done` job rather than creating a new physical
attempt.

## 7. Where to inspect results

With the default local queue, the useful result paths are:

```text
.local-render-queue/results/<job_id>/
  delivery-package.json
  run.json
  canonical-artifacts.json
  receipts/<render_spec_id>.json
  video/<render_spec_id>.mp4

.local-render-queue/done/<job_id>/attempts/
  0001.json
```

For creative work, inspect the MP4 or representative rendered frames. For contract/runtime
work, also inspect the receipt, canonical manifest, and exact identities involved.

## 8. What Codex must not do automatically

- Do not mutate or invent authoritative product facts to rescue an idea.
- Do not relabel intent/click/save as completed reading.
- Do not silently change a review-required creative into publication-trusted content.
- Do not bypass the canonical factory and call a private alternate render path for the final
  result.
- Do not weaken semantic/QA gates because a candidate is aesthetically promising.
- Do not merge or push to the shared canonical branch without an explicit promotion action.
- Do not commit MP4/WAV/frame dumps, private source material, secrets, or `.codex-lab/` state.

## 9. A useful first Codex instruction

A first dogfood task can be as simple as:

> Work in NEwBOO NORMAL mode. Use only the supplied authoritative ContextPack. Produce three
> materially different creative candidates for this book, render all of them through the
> canonical local factory, inspect the outputs, and iterate once on the strongest structural
> idea. Do not change publication truth. If the current primitive set cannot express the idea,
> stop treating it as NORMAL mode and propose a reusable EXPERIMENT-mode primitive instead.

That gives the agent freedom where it is useful while keeping the factory/truth boundary
stable.
