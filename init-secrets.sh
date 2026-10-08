#!/usr/bin/env bash
# Create any missing files in secrets/ that the compose files reference.
#
#   ./init-secrets.sh          create missing secrets (random or prompted)
#   ./init-secrets.sh --check  list status only, write nothing
#
# Existing files are never overwritten, so restoring secrets/ alongside
# docker_data/ keeps apps and Authentik in sync.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { set -a; . ./.env; set +a; }

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# Secrets nothing outside the stack depends on: generated randomly.
#   name -> length (alphanumeric)
declare -A GENERATE=(
  [authentik-pg-pass]=40        # Postgres rejects passwords over 99 chars
  [authentik-secret-key]=60
  [authentik-shelfmark-oidc]=128
  [authentik-cwa-oidc]=128
  [authentik-audiobookshelf-oidc]=128
  [gluetun-apikey]=40           # must match docker_data/gluetun/auth/config.toml
)

# Everything else comes from outside (VPN account, Cloudflare, app-generated API keys).
declare -A HINT=(
  [openvpn_user]="PIA username"
  [openvpn_password]="PIA password"
  [cloudflare-token]="Cloudflare API token (Zone.DNS edit)"
  [cloudflare-email]="Cloudflare account email"
  [bittorrent-user]="qBittorrent WebUI username"
  [bittorrent-password]="qBittorrent WebUI password"
  [plex-claim]="Plex claim token from https://account.plex.tv/claim (expires in 4 min)"
  [sonarr-api]="Sonarr API key (Settings > General)"
  [radarr-api]="Radarr API key (Settings > General)"
  [hardcover-token]="Hardcover API token from https://hardcover.app/account/api"
  [aa-donator-key]="Anna's Archive donator key (account page)"
)

# Subshell with pipefail off: tr gets SIGPIPE once head has enough bytes
random() ( set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" )

names=$(grep -ho '\./secrets/[A-Za-z0-9_.-]*\.secret' ./*compose*.yml | sed 's|./secrets/||; s|\.secret$||' | sort -u)

mkdir -p secrets
missing=0
for name in $names; do
  file="secrets/$name.secret"
  if [ -s "$file" ]; then
    echo "ok        $name"
    continue
  fi
  missing=$((missing + 1))
  if [ "$CHECK" = 1 ]; then
    if [ -n "${GENERATE[$name]:-}" ]; then echo "missing   $name (will generate)"; else echo "missing   $name (will prompt: ${HINT[$name]:-value})"; fi
    continue
  fi

  if [ -n "${GENERATE[$name]:-}" ]; then
    (umask 077; random "${GENERATE[$name]}" > "$file"; echo >> "$file")
    # Postgres reads its password file as uid 70, not the file owner
    [ "$name" = authentik-pg-pass ] && chmod 644 "$file"
    echo "generated $name"
  else
    value=""
    read -rsp "${HINT[$name]:-$name}: " value || true; echo
    if [ -z "$value" ]; then
      echo "skipped   $name (empty input; containers using it won't start)"
      continue
    fi
    (umask 077; printf '%s\n' "$value" > "$file")
    unset value
    echo "saved     $name"
  fi
done

if [ "$CHECK" = 1 ]; then
  echo "$missing missing"
elif [ -s secrets/gluetun-apikey.secret ] && [ -n "${MEDIA_VOLUME:-}" ] && [ ! -f "$MEDIA_VOLUME/docker_data/gluetun/auth/config.toml" ]; then
  echo "note: create \$MEDIA_VOLUME/docker_data/gluetun/auth/config.toml with this gluetun API key (see CHANGELOG 2026-10-05)"
fi
