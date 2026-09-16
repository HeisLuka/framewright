#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-framewright-node-canvas:e09}"
SOAK_VIDEOS="${SOAK_VIDEOS:-100}"
WIDTH="${WIDTH:-1080}"
PRESET="${PRESET:-veryfast}"
CRF="${CRF:-22}"
OUT="${OUT:-artifacts/e09-provider}"
HOURLY_USD="${HOURLY_USD:-}"
PROVIDER="${PROVIDER:-provider}"

mkdir -p "$OUT"
OUT_ABS="$(cd "$OUT" && pwd)"

uname -a > "$OUT/uname.txt" || true
lscpu > "$OUT/lscpu.txt" || true
free -b > "$OUT/memory.txt" || true

docker build -f Dockerfile.node-canvas-worker -t "$IMAGE" .
docker image inspect "$IMAGE" > "$OUT/image-inspect.json"

docker run --rm \
  -v "$OUT_ABS:/app/artifacts/e09-provider" \
  "$IMAGE" sh -lc "
    node .agents/skills/framewright/scripts/make-e08-fixtures.mjs examples/book-ad-v0/generated-e08 &&
    node .agents/skills/framewright/scripts/prepare-pinned-font-template.mjs examples/book-ad-v0/index.html examples/book-ad-v0/index-e08.html &&
    SOAK_VIDEOS=$SOAK_VIDEOS \
    HTML=examples/book-ad-v0/index-e08.html \
    MANIFEST=examples/book-ad-v0/generated-e08/manifest.json \
    REPORT=artifacts/e09-provider/soak.json \
    WIDTH=$WIDTH PRESET=$PRESET CRF=$CRF \
    node .agents/skills/framewright/scripts/node-canvas-soak.mjs
  "

if [[ -n "$HOURLY_USD" ]]; then
  docker run --rm \
    -v "$OUT_ABS:/app/artifacts/e09-provider" \
    "$IMAGE" \
    node .agents/skills/framewright/scripts/e09-cost-model.mjs \
      artifacts/e09-provider/soak.json "$HOURLY_USD" "$PROVIDER" \
      | tee "$OUT/cost.json"
fi

echo "E09 provider benchmark complete: $OUT"
