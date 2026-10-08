#!/bin/sh
# Shelfmark reads its settings from env only. Export the secret-backed ones from
# /run/secrets, then hand over to the image's own entrypoint.
set -e
s=/run/secrets
export HARDCOVER_API_KEY="$(cat $s/hardcover-token)"
export AA_DONATOR_KEY="$(cat $s/aa-donator-key)"
export OIDC_CLIENT_SECRET="$(cat $s/shelfmark-oidc)"
export OIDC_CLIENT_ID="$(cat $s/shelfmark-client-id)"
export QBITTORRENT_USERNAME="$(cat $s/shelfmark-qbit-user)"
export QBITTORRENT_PASSWORD="$(cat $s/shelfmark-qbit-password)"

# Admin notifications to Telegram (same bot/chat as Seerr), via Apprise
if [ -s $s/telegram-bot-token ] && [ -s $s/telegram-chat-id ]; then
  export ADMIN_NOTIFICATION_ROUTES="[{\"event\":[\"request_created\",\"download_complete\",\"download_failed\"],\"url\":\"tgram://$(cat $s/telegram-bot-token)/$(cat $s/telegram-chat-id)\"}]"
fi

exec /app/entrypoint.sh
