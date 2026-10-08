# Changelog

## 2026-10-08

### Changes
- `GTN_APIKEY` moved from `env/bittorrent.env` to `secrets/gluetun-apikey.secret` (+ `.example`), matching other credentials.
- `bittorrent-compose.yml`: `gluetun-apikey` secret on `bittorrent_port_forwarder`; `command:` also exports `GTN_APIKEY` from `/run/secrets/gluetun-apikey`. Forwarder recreated, retrieves port 36775.
- 2026-10-05 `*.bak-20261005-claude*` files in this repo already removed.

## 2026-10-05

### Causes
- **gluetun down since ~10-03:** stale PIA server list (09-17); all CA Toronto IPs retired → OpenVPN TLS handshake timeout. Built-in updater rejected new list (389 vs ~534 servers < `UPDATER_MIN_RATIO` 0.8).
- **port forwarder 401:** gluetun ≥ v3.39.1 requires control-server auth; no `/gluetun/auth/config.toml`.
- **unpackerr / forwarder crash loops:** `UN_*_API_KEY`, `QBT_USERNAME`, `QBT_PASSWORD` set to literal `/run/secrets/...` paths.
- **dependents down after DockMon update:** DockMon v2.3.2 updates gluetun (recreates dependents via `*-dockmon-temp-*`) concurrently with standalone dependent updates → dependent pinned to deleted `gluetun-dockmon-backup-*` → `cannot join network namespace of a non running container`.
- **swap full:** Minecraft (`minecraft-michael-reeves-mc-1`) java ~10 GiB RSS + ~6.4 GiB swap.

### Changes
- `${MEDIA_VOLUME}/docker_data/gluetun/auth/config.toml` (new): role `port-forwarder`, `GET /v1/portforward`, `auth = "apikey"`.
- `env/bittorrent.env`: + `GTN_APIKEY` (moved to secret 2026-10-08).
- gluetun volume `servers/private internet access.json`: `gluetun update -minratio 0.5 -providers "private internet access"`.
- `env/gluetun.env`: + `UPDATER_MIN_RATIO: 0.5`.
- `env/arr.env`: `UN_{SONARR,RADARR}_0_API_KEY: filepath:/run/secrets/...`.
- `bittorrent-compose.yml`: `bittorrent_port_forwarder` `command:` exports `QBT_*` from `/run/secrets/*` then execs `/usr/src/app/entrypoint.sh`.
- `docker compose up -d` gluetun group (gluetun/sonarr/radarr upgraded to local `:latest`); stale `*-dockmon-temp-*` removed.
- Stopped `minecraft-michael-reeves-mc-1` (world saved).
- DockMon: auto-update off for gluetun (update manually, alone).
- `env/arr.env`: + `UN_SONARR_0_PATHS_0: /media/torrents/tv`, `UN_RADARR_0_PATHS_0: /media/torrents/movies` (default `/downloads` didn't exist; matches qBit categories).
- `docker-compose.yml`: traefik `--log.level=DEBUG` → `INFO` (~50k lines/day).
- `docker-compose.yml`: traefik `dnschallenge.delayBeforeCheck=20` → `dnschallenge.propagation.delayBeforeChecks=20s` (deprecated in v3).
- `../lists/deploy/docker-compose.yml`: watchtower `--interval 60 --cleanup --debug` → `--interval 300 --cleanup lists-api-1 lists-web-1 lists-umami-1` (was polling all 28 containers every 60s; raced DockMon, likely cause of registry `toomanyrequests`).

### Backups
- `env/{arr,bittorrent,gluetun}.env.bak-20261005-claude`, `env/gluetun.env.bak-20261005-claude-2`
- `bittorrent-compose.yml.bak-20261005-claude`, `docker-compose.yml.bak-20261005-claude{,-2}`, `env/arr.env.bak-20261005-claude-2`
- `../lists/deploy/docker-compose.yml.bak-20261005-claude`
- `${MEDIA_VOLUME}/docker_data/gluetun/servers.bak-20261005-claude/`

### Notes
- `env/` is git-tracked; keep credentials in `secrets/*.secret` (gitignored).
- Recover stuck dependents: `docker compose up -d`.
- Lower Minecraft `MEMORY` before restarting it.
