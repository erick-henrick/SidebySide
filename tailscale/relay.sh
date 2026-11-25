#!/bin/sh
set -eu

case "${1:-}" in
  8080|8765)
    exec tailscale nc "$NEKO_TAILNET_IP" "$1"
    ;;
esac

if [ -n "${NEKO_TAILNET_IP:-}" ]; then
  ipv4_octet='(0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])'
  if ! printf '%s\n' "$NEKO_TAILNET_IP" | grep -Eq "^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.$ipv4_octet\.$ipv4_octet$"; then
    echo 'NEKO_TAILNET_IP precisa ser um IPv4 do Tailscale.' >&2
    exit 1
  fi

  for port in 8080 8765; do
    nc -lk -p "$port" -e /bin/sh "$0" "$port" &
  done
fi

exec /usr/local/bin/containerboot
