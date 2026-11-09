#!/bin/sh
# Contact sheet: sheet.sh out.png a.png b.png … (up to 8, 4 per row, 360×640 each)
out=$1; shift
n=$#; inputs=""; filters=""; i=0
for f in "$@"; do inputs="$inputs -i $f"; filters="$filters[$i:v]scale=360:640[s$i];"; i=$((i+1)); done
while [ $i -lt 8 ]; do inputs="$inputs -f lavfi -i color=black:s=360x640"; filters="$filters[$i:v]null[s$i];"; i=$((i+1)); done
ffmpeg -y -loglevel error $inputs -filter_complex "${filters}[s0][s1][s2][s3]hstack=4[r0];[s4][s5][s6][s7]hstack=4[r1];[r0][r1]vstack" -frames:v 1 "$out"
