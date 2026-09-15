#!/usr/bin/env bash
# Full pipeline: [photo ->] audio -> frames -> mp4.   ./make.sh [photo.jpg] [seed=7] [width=1920] [tabs=5]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PHOTO=${1:-}; SEED=${2:-7}; WIDTH=${3:-1920}; TABS=${4:-5}
if [ -n "$PHOTO" ]; then "$HERE/portrait.sh" "$PHOTO"; fi
if [ -f audio.mjs ]; then node audio.mjs track.wav; else echo "no audio.mjs, video will be silent"; fi
rm -rf frames && node "$HERE/render.mjs" frames "$SEED" "$WIDTH" "$TABS"
"$HERE/build.sh" out.mp4
