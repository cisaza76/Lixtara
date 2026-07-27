#!/usr/bin/env bash
# Deterministic local fixtures for the video color-range normalization contract
# (Gate 5A remediation — see docs/adr/0011-video-color-range-normalization.md).
#
# CI never runs FFmpeg: the unit suites validate the contract against synthetic ffprobe
# JSON. This script exists so a human (or the adversarial reviewer) can reproduce the
# behavior matrix locally against a REAL ffmpeg. No binary fixture is committed.
#
# Usage: bash scripts/generate-video-range-fixtures.sh <output-dir>
set -euo pipefail
OUT="${1:?usage: generate-video-range-fixtures.sh <output-dir>}"
mkdir -p "$OUT"

# 1. TV-range H.264 (camera-like): limited-range values.
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=4" \
  -vf "scale=in_range=full:out_range=tv,format=yuv420p" -color_range tv \
  -c:v libx264 -pix_fmt yuv420p -an "$OUT/in-tv.mp4"

# 2. Full-range source (probes yuvj420p/pc) — the Gate 5A failure class. A JPEG-derived
#    still→video carries JPEG (full) range end-to-end.
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=64x64:rate=1:duration=1" -frames:v 1 "$OUT/still.jpg"
ffmpeg -y -loglevel error -loop 1 -i "$OUT/still.jpg" -t 4 -r 24 \
  -c:v libx264 -pix_fmt yuv420p -an "$OUT/in-fullrange.mp4"

# 3. Limited values but TAGGED pc (metadata mismatch).
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=4" \
  -vf "scale=in_range=full:out_range=tv,format=yuv420p" -color_range pc \
  -c:v libx264 -pix_fmt yuv420p -an "$OUT/in-tagged-pc.mp4"

# 4. Untagged (unspecified range — decoders assume limited per H.264).
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=24:duration=4" \
  -vf "format=yuv420p" -c:v libx264 -pix_fmt yuv420p -an "$OUT/in-untagged.mp4"

echo "--- fixture probes (pix_fmt / color_range):"
for f in in-tv in-fullrange in-tagged-pc in-untagged; do
  echo -n "$f: "
  ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,color_range \
    -of default=noprint_wrappers=1 "$OUT/$f.mp4" | tr '\n' ' '
  echo
done
