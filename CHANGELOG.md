# Changelog

## 2026-10-08

### Changes
- `GTN_APIKEY` moved from `env/bittorrent.env` to `secrets/gluetun-apikey.secret` (+ `.example`), matching other credentials.
- `bittorrent-compose.yml`: `gluetun-apikey` secret on `bittorrent_port_forwarder`; `command:` also exports `GTN_APIKEY` from `/run/secrets/gluetun-apikey`. Forwarder recreated, retrieves port 36775.
- 2026-10-05 `*.bak-20261005-claude*` files in this repo already removed.
- Books stack: `books-compose.yml` (+ `include:`), `env/cwa.env`, `env/shelfmark.env`.
  - `calibre-web-automated` → `library.${DOMAIN}` (OPDS `/opds`), library `data/media/ebooks`, ingest `data/cwa-ingest`.
  - `shelfmark` → `books.${DOMAIN}`, CWA logins (`app.db` ro), ebooks → CWA ingest, audiobooks → `data/media/books` (hardlinked).
  - Cloudflare DNS: CNAME `books`, `library` → `media.example.com` (DNS only).
  - Shelfmark auth: `cwa_config` mounted ro at `/auth` (not just `app.db`); later switched to OIDC in UI and `AUTH_METHOD`/`CWA_DB_PATH` removed from env (Shelfmark persists env values to `plugins/security.json`). Local fallback admin created via `UserDB.create_user`.
- Authentik (`authentik-compose.yml`, `env/authentik.env`): `auth.${DOMAIN}`, Postgres + server + worker, pinned 2026.8.3, no docker.sock. Secrets via `file://` (`secrets/authentik-{pg-pass,secret-key}.secret`).
  - Plex source (UI): allowed server plex-server, "Allow friends" off.
  - `authentik/blueprints/media-sso.yaml` (mounted `/blueprints/custom`): group `media-admins`, OIDC providers/apps for Shelfmark, CWA, Audiobookshelf (client secrets via `!File /run/secrets/authentik-<app>-oidc`), `grant_types` authorization_code + refresh_token (empty by default when created via API → "Invalid grant_type"), ABS callbacks under `/audiobookshelf/auth/openid/...`, `email-verified` scope mapping (apps only link existing users by verified email).
  - Traefik: network alias `auth.${DOMAIN}` on `media_network` (no hairpin NAT; containers must reach Authentik by its public hostname).
  - `env/shelfmark.env` `NO_PROXY` + `auth.example.com`.
  - Cloudflare DNS: CNAME `auth` → `media.example.com` (DNS only).
- `init-secrets.sh`: creates missing `secrets/*.secret` referenced by compose files (random or prompted); never overwrites.
- CWA: Hardcover metadata via `secrets/hardcover-token.secret` → `FILE__HARDCOVER_TOKEN` (linuxserver env-from-file). Token copied from Shelfmark's saved key.
- Shelfmark: all non-default UI settings moved to `env/shelfmark.env` (generated from its settings registry; verified identical). `HARDCOVER_API_KEY`, `AA_DONATOR_KEY`, `OIDC_CLIENT_SECRET` exported from secrets by `command:` wrapper (`secrets/aa-donator-key.secret` new). Env-set settings are locked in the UI.
- More automation (fresh installs need fewer manual steps):
  - Sonarr/Radarr/Prowlarr API keys pinned from secrets via `FILE__<APP>__AUTH__APIKEY` (values unchanged; `secrets/prowlarr-api.secret` new). linuxserver `FILE__` keeps trailing newlines → briefly broke Radarr/Prowlarr API auth (401) until newlines were stripped; `init-secrets.sh` now writes secrets without newline.
  - Gluetun control-server auth from `secrets/gluetun-auth-config.secret` (`HTTP_CONTROL_SERVER_AUTH_CONFIG_FILEPATH`), built by `init-secrets.sh` from `gluetun-apikey`; identical to the old `docker_data/gluetun/auth/config.toml`.
  - Authentik worker: `AUTHENTIK_BOOTSTRAP_PASSWORD` from secret via entrypoint wrapper (first start only). Blueprint now also defines the Plex source (token from `secrets/authentik-plex-token.secret`) and the login-page binding; verified unchanged.
  - `init-secrets.sh`: generates *arr API keys (hex) and bootstrap password, builds gluetun auth file, prompts for Plex token.
- README: DNS records, path map, secrets table, fresh install, restore from existing data, per-app manual setup (qBittorrent paths/categories, remote path mappings, Prowlarr Byparr proxy + `flare` tag, Seerr, Plex, ABS/CWA OIDC, Shelfmark fallback admin, Moon+).
- Machine-specific values moved to `.env`: `TZ` (now `America/Chicago` everywhere, was `Etc/UTC`; Plex maintenance window moves from 9pm–midnight local to 2–5am), `PUID`/`PGID`, `LAN_IP`, `PLEX_SERVER_ID`. Domain no longer hardcoded: Shelfmark/Plex URLs via compose `environment:`, blueprint via `!Format`/`!Env DOMAIN`. Verified effective config identical apart from TZ. `.env` lacked a final newline → first append corrupted `MEDIA_VOLUME`; caught before deploy.
- Shelfmark: Telegram admin notifications (request created, download complete/failed) via Apprise, same bot/chat as Seerr (`secrets/telegram-{bot-token,chat-id}.secret`, copied from Seerr's config). Startup wrapper moved to `shelfmark/start.sh`. Removed leftover `cwa_config:/auth` mount (Shelfmark uses OIDC now).
- Authentik: `deny-akadmin` expression policy bound to the Shelfmark/CWA/ABS apps (an open akadmin session had auto-created `akadmin` users in CWA and Shelfmark). Deleted those users and Shelfmark's stale `Administrator` (CWA-auth era).
- Public-ready: OIDC/Plex client IDs moved to `secrets/authentik-*-client-id.secret` (values unchanged; read via `!File` and `shelfmark/start.sh`, generated by `init-secrets.sh`). Domain, IPs, server name replaced with placeholders in docs.
- Security: Sonarr/Radarr/Prowlarr/qBittorrent/DockMon behind Authentik forward auth (blueprint "Admin tools" proxy provider, domain mode, embedded outpost; media-admins + authentik Admins). `/api` of the *arrs excluded (API key). Secret files `chmod 600` (Postgres password 644), `secrets/` 700, `.env` 600. Server: SSH key added, fail2ban (sshd + recidive) enabled.
- Single login for admin tools: *arrs `AUTH__METHOD=External` (env), Traefik fixed IP 172.18.255.250 + qBittorrent auth whitelist for it, DockMon OIDC app in blueprint (`secrets/authentik-dockmon-{client-id,oidc}.secret`; configured in DockMon UI).
- README: connecting apps and devices; CWA default user permissions (default role 0 blocks downloads/OPDS for Plex users).
- `README.md`: rewritten for current stack (services, books flow, SSO, secrets, new-machine steps, operations).
- `env/gluetun.env`: + `HTTPPROXY: on` (Shelfmark `HTTP_PROXY=http://gluetun:8888`; verified egress = VPN IP).
- `env/gluetun.env`: + `SERVER_NAMES: Server-12612-2a,Server-12613-2a`. After recreate, Server-10961/10994 (x.x.x.x) refused PIA PF API (`10.x.0.1:19999` connection refused) → forwarder crash loop. 12612/12613 (x.x.x.x) work. Remove pin if those servers disappear.

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
