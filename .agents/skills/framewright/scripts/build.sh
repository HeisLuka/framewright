#!/usr/bin/env bash
# Assemble PNG frames (+ optional WAV) into an MP4.
#   ./build.sh [out.mp4] [frames_dir=frames] [track=track.wav]
# Env: CRF=22, FPS=30, MAXRATE=14M, BUFSIZE=28M, PRESET=slow, VIDEO_CODEC=libx264
set -euo pipefail
OUT=${1:-out.mp4}; DIR=${2:-frames}; TRACK=${3:-track.wav}
CRF=${CRF:-22}; FPS=${FPS:-30}; MAXRATE=${MAXRATE:-14M}; BUFSIZE=${BUFSIZE:-28M}
PRESET=${PRESET:-slow}; VIDEO_CODEC=${VIDEO_CODEC:-libx264}; AUDIO_BITRATE=${AUDIO_BITRATE:-192k}
command -v ffmpeg >/dev/null || { echo "ffmpeg not found, run scripts/doctor.sh --install"; exit 1; }
ls "$DIR"/f00000.png >/dev/null 2>&1 || { echo "no frames in $DIR (expected f00000.png ...)"; exit 1; }
V=(-c:v "$VIDEO_CODEC" -preset "$PRESET" -crf "$CRF" -maxrate "$MAXRATE" -bufsize "$BUFSIZE" -pix_fmt yuv420p -movflags +faststart)
if [ -f "$TRACK" ]; then
  ffmpeg -y -v error -nostats -framerate "$FPS" -i "$DIR/f%05d.png" -i "$TRACK" "${V[@]}" -c:a aac -b:a "$AUDIO_BITRATE" -shortest "$OUT"
else
  echo "no $TRACK, building without audio"
  ffmpeg -y -v error -nostats -framerate "$FPS" -i "$DIR/f%05d.png" "${V[@]}" "$OUT"
fi
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,nb_frames -of default=nw=1 "$OUT" | tr '\n' ' '; echo
echo "$OUT: $(du -m "$OUT" | cut -f1) MB"
