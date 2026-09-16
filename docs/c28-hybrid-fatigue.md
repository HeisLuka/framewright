# C28 hybrid catalog-fatigue scout

## Why this pass exists

The semantic-only C28 v2 policy is preserved as negative visual evidence. Canonical run `35150707502` improved symbolic diversity sharply but failed its predeclared sampled-visual gate: mean recent visual distance ratio was `0.9631`, so recent catalog frames became about 3.7% more similar on that oracle even though semantic tags were more diverse. This pass does not reinterpret that run as a success.

## Changed axis

Keep the same bounded six already-valid creative alternatives per book and the same non-rerankable book constraints. The selector now uses a cheap low-resolution preview only after a semantic shortlist is formed:

1. Compute the existing semantic recent-window penalty.
2. Keep candidates within `2.5` penalty points of the best semantic candidate.
3. Render two 135 px-wide preview checkpoints (`30%`, `70%`) for those bounded candidates.
4. Pick the shortlisted candidate maximizing `0.7 * nearest recent visual distance + 0.3 * mean recent visual distance`.
5. Validate the final sequence with a separate 270 px / three-checkpoint (`16%`, `50%`, `84%`) luminance-gradient oracle, not with the preview feature alone.

The preview signature is deterministic and cacheable at catalog-planning time. It is not added to the video render critical path in this experiment.

## Predeclared gates

The hybrid policy passes only if all are true:

- validation mean recent visual-distance ratio vs naive is at least `1.05`;
- validation nearest-recent mean-distance ratio vs naive is at least `1.05`;
- sampled C26 safe-zone violations are zero;
- duration, platform, palette-family and cover-composition constraints are unchanged;
- hybrid semantic unique-signature ratio retains at least 90% of the semantic-only policy;
- hybrid mean semantic recent-window overlap is no more than `1.10x` the semantic-only optimum;
- preview generation costs at most `600 ms/book` on the CI reference runner;
- replay from the same cached preview features selects the same candidates.

If these gates fail, do not keep tuning weights on this fixture. Close the current bounded hybrid approach and leave catalog fatigue as a live-data / broader-creative-axis problem instead of manufacturing an offline win.

## Scope

This is an offline structural/perceptual scout. It does not claim retention, CTR, virality, or sales lift. C27 narrative semantics are now canonical, but this pass deliberately does not add more axes after seeing the visual failure; the question is narrower: can a cheap perceptual signal repair the specific semantic-vs-visible-diversity mismatch without sacrificing the already-earned semantic diversity or factory economics?
