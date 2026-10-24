#!/bin/sh
# Usage: jp/add_slide.sh <id> <before-image> <after-image>
# Centre-crops to square, scales to 512x512, writes WebP q80 into jp/img/<id>/.
# Then add an entry at the TOP of jp/slides.json (newest first):
#   {"id":"<id>","date":"YYYY-MM-DD","ja":"…してください。","en":"calque","before":"img/<id>/before.webp","after":"img/<id>/after.webp","source":"optional URL"}
set -e
[ $# -eq 3 ] || { echo "usage: $0 id before after"; exit 1; }
d="$(dirname "$0")/img/$1"; mkdir -p "$d"
VF="crop='min(iw,ih)':'min(iw,ih)',scale=512:512"
ffmpeg -loglevel error -y -i "$2" -vf "$VF" -c:v libwebp -quality 80 "$d/before.webp"
ffmpeg -loglevel error -y -i "$3" -vf "$VF" -c:v libwebp -quality 80 "$d/after.webp"
ls -l "$d"
