#!/bin/sh
set -eu

# The desktop socket is local to this container. Websockify protects the port on the Docker network.
secret=$(python3 -c 'import hashlib,hmac,os; print(hmac.new(os.environ["CONTROL_TOKEN"].encode(), b"side-by-side:chromium-lab:proxy", hashlib.sha256).hexdigest())')
x11vnc -quiet -display "${DISPLAY:-:99.0}" -localhost -no6 -rfbport 15900 -forever -shared -nopw &
desktop=$!
trap 'kill "$desktop" 2>/dev/null || true' EXIT
websockify --web /usr/share/novnc --web-auth --auth-plugin BasicHTTPAuth --auth-source "sidebyside:$secret" 16080 127.0.0.1:15900
