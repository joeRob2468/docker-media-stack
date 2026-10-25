#!/bin/sh
# Nightly from cron: apply the rule-based audiobook metadata cleanup (no external lookups).
# Prints only when something changed, so the cron log only records changes.
set -eu
cd "$(dirname "$0")/.."
cat audiobookshelf/admin-key.js audiobookshelf/clean-metadata.js | docker exec -i audiobookshelf node - --apply
