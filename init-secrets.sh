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
#   name -> length (alphanumeric), or hex:length
declare -A GENERATE=(
  [authentik-pg-pass]=40        # Postgres rejects passwords over 99 chars
  [authentik-secret-key]=60
  [authentik-bootstrap-password]=32   # akadmin password, used on Authentik's first start only
  [authentik-shelfmark-oidc]=128
  [authentik-cwa-oidc]=128
  [authentik-audiobookshelf-oidc]=128
  [authentik-shelfmark-client-id]=40
  [authentik-cwa-client-id]=40
  [authentik-audiobookshelf-client-id]=40
  [authentik-plex-client-id]=40
  [authentik-dockmon-client-id]=40
  [authentik-dockmon-oidc]=128
  [gluetun-apikey]=40
  [sonarr-api]=hex:32           # *arr API keys are set from these via FILE__<APP>__AUTH__APIKEY
  [radarr-api]=hex:32
  [prowlarr-api]=hex:32
)

# Built from other secrets (names sort after their inputs).
derive() {
  case "$1" in
    gluetun-auth-config)
      [ -s secrets/gluetun-apikey.secret ] || return 1
      printf '[[roles]]\nname = "port-forwarder"\nroutes = ["GET /v1/portforward"]\nauth = "apikey"\napikey = "%s"\n' \
        "$(tr -d '\n' < secrets/gluetun-apikey.secret)" ;;
    *) return 1 ;;
  esac
}
DERIVED=" gluetun-auth-config "

# Everything else comes from outside (VPN account, Cloudflare, Plex, external services).
declare -A HINT=(
  [openvpn_user]="PIA username"
  [openvpn_password]="PIA password"
  [cloudflare-token]="Cloudflare API token (Zone.DNS edit)"
  [cloudflare-email]="Cloudflare account email"
  [bittorrent-user]="qBittorrent WebUI username"
  [bittorrent-password]="qBittorrent WebUI password"
  [plex-claim]="Plex claim token from https://account.plex.tv/claim (expires in 4 min)"
  [authentik-plex-token]="Plex token of the server owner (https://support.plex.tv/articles/204059436)"
  [hardcover-token]="Hardcover API token from https://hardcover.app/account/api"
  [aa-donator-key]="Anna's Archive donator key (account page)"
  [telegram-bot-token]="Telegram bot token (@BotFather; same bot as Seerr notifications)"
  [telegram-chat-id]="Telegram chat ID for notifications"
)

# Subshell with pipefail off: tr gets SIGPIPE once head has enough bytes
random() (
  set +o pipefail
  case "$1" in
    hex:*) LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "${1#hex:}" ;;
    *)     LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1" ;;
  esac
)

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
    if [ -n "${GENERATE[$name]:-}" ]; then echo "missing   $name (will generate)"
    elif [[ "$DERIVED" == *" $name "* ]]; then echo "missing   $name (will build from other secrets)"
    else echo "missing   $name (will prompt: ${HINT[$name]:-value})"; fi
    continue
  fi

  if [[ "$DERIVED" == *" $name "* ]]; then
    if content=$(derive "$name"); then
      (umask 077; printf '%s' "$content" > "$file")
      echo "built     $name"
    else
      echo "skipped   $name (inputs missing)"
    fi
  elif [ -n "${GENERATE[$name]:-}" ]; then
    # No trailing newline: linuxserver FILE__ env loading keeps it as part of the value
    (umask 077; random "${GENERATE[$name]}" > "$file")
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
    (umask 077; printf '%s' "$value" > "$file")
    unset value
    echo "saved     $name"
  fi
done

[ "$CHECK" = 1 ] && echo "$missing missing"
true
