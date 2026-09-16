## Intent

Mode: `NORMAL` / `EXPERIMENT` / infrastructure-contract

What reusable problem does this change address?

## Truth / provenance

- Authoritative facts / ContextPack involved:
- Creative trust class:
- Publication-trust impact:
- Any new claim surface or wording authority:

## Baseline

What is the current behavior or artifact being compared against?

## Candidate

What changed, and why is it reusable rather than a one-off fixture patch?

## Physical evidence

- Rendered artifact / CI artifact:
- QA / semantic checks:
- Visual inspection performed:
- Runtime / memory measurements, if this PR makes a performance claim:
- Deterministic replay / identity evidence, if applicable:

## Promotion checklist

- [ ] No publication-truth or provenance boundary is bypassed.
- [ ] No review-required creative is silently promoted to publication-trusted.
- [ ] Physical/rendered output was inspected when the change affects visuals.
- [ ] Existing canonical factory paths are reused unless replacing one is the explicit experiment.
- [ ] Reusable capability is separated from book-specific fixture data.
- [ ] No MP4/WAV/frame dumps, private source material, secrets, or local agent state are committed.
- [ ] This PR does not automatically publish external content or merge itself into the shared lab.
