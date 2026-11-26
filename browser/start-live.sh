#!/bin/sh
set -eu

target=/tmp/cinema-hls
mkdir -p "$target"

exec ffmpeg -hide_banner -nostdin -loglevel warning \
  -thread_queue_size 256 -f x11grab -draw_mouse 0 -video_size 1280x720 -framerate 24 -i "${DISPLAY:-:99.0}" \
  -thread_queue_size 512 -f pulse -i audio_output.monitor \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p -threads 2 \
  -g 15 -keyint_min 15 -sc_threshold 0 -crf 23 -maxrate 1500k -bufsize 1500k \
  -c:a aac -b:a 112k -af aresample=async=1 \
  -f hls -hls_start_number_source epoch_us -hls_time 0.625 -hls_list_size 14 \
  -hls_flags delete_segments+independent_segments+program_date_time+temp_file \
  -hls_segment_filename "$target/chunk-%d.ts" "$target/live.m3u8"
