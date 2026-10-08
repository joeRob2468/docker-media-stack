# Automated Media Management Setup

Media server stack for example: VPN-protected downloads, *arr automation, Plex, books/audiobooks, and single sign-on with Plex accounts. Originally based on the guide at https://passthebits.com/.

## Services

| Service | URL | Compose file | Notes |
|---|---|---|---|
| 🌐 Traefik | — | `docker-compose.yml` | Reverse proxy, Let's Encrypt wildcard cert via Cloudflare DNS |
| 🔒 Gluetun | — | `docker-compose.yml` | PIA OpenVPN (Toronto, port forwarding). HTTP proxy on `gluetun:8888` for Shelfmark |
| ⬇️ qBittorrent | `bittorrent.` | `bittorrent-compose.yml` | Runs inside Gluetun's network |
| 🔄 qBittorrent Port Forwarder | — | `bittorrent-compose.yml` | Syncs Gluetun's forwarded port into qBittorrent |
| 📺 Sonarr | `sonarr.` | `arr-compose.yml` | TV, inside Gluetun |
| 🎬 Radarr | `radarr.` | `arr-compose.yml` | Movies, inside Gluetun |
| 🔍 Prowlarr | `prowlarr.` | `arr-compose.yml` | Indexers, inside Gluetun |
| 🧩 Byparr | — | `arr-compose.yml` | FlareSolverr-compatible Cloudflare solver, inside Gluetun |
| 📦 Unpackerr | — | `arr-compose.yml` | Extracts completed downloads for Sonarr/Radarr |
| 📡 Plex | `plex.` | `plex-compose.yml` | |
| 📝 Seerr | `overseerr.` | `plex-compose.yml` | Movie/TV requests, Plex login |
| 🎧 Audiobookshelf | `audiobookshelf.` | `audiobookshelf-compose.yml` | Audiobooks (`data/media/books`). Login via Authentik |
| 📚 Shelfmark | `books.` | `books-compose.yml` | Search/download ebooks and audiobooks (Anna's Archive, Prowlarr). Login via Authentik |
| 📖 Calibre-Web-Automated | `library.` | `books-compose.yml` | Ebook library (`data/media/ebooks`), OPDS at `/opds`. Login via Authentik |
| 🔑 Authentik | `auth.` | `authentik-compose.yml` | Single sign-on; Plex accounts with access to your Plex server |
| 🚢 DockMon | `dockmon.` | `dockmon-compose.yml` | Container monitoring and image updates |

All URLs are `<name>.${DOMAIN}` via Traefik. Each needs a Cloudflare DNS record (CNAME to `media.${DOMAIN}`, DNS only).

## Books flow

```
Shelfmark ──AA / libgen / bypasser──▶ gluetun:8888 HTTP proxy ──▶ VPN
          ├─ torrents via Prowlarr ──▶ qBittorrent (already in VPN)
          ├─ ebooks ──▶ data/cwa-ingest ──▶ CWA ──▶ data/media/ebooks ──OPDS──▶ Moon+ Reader
          └─ audiobooks ──▶ data/media/books (hardlinked) ──▶ Audiobookshelf
```

Shelfmark's IRC sources do not use the proxy; keep them disabled. Details in `PLANNED.md`.

## Single sign-on (Authentik)

- Plex source: only accounts with access to the plex-server Plex server can log in ("Allow friends" off). Set up in the Authentik UI (needs a Plex login in the browser).
- OIDC apps for Shelfmark, CWA and Audiobookshelf, plus the `media-admins` group, are defined in `authentik/blueprints/media-sso.yaml`. Authentik reapplies it on change and hourly; edit the file, not the UI.
- Members of `media-admins` are admins in Shelfmark and CWA. Plex users are created as external users (apps only, no Authentik dashboard).
- Emails are sent as verified so apps can link existing accounts by email.
- Local admin logins are kept in each app as a fallback if Authentik is down.
- Shelfmark is configured entirely from `env/shelfmark.env` + secrets (settings set there are locked in its UI). CWA and Audiobookshelf keep their OIDC settings in their own databases (`docker_data/`).
- Containers can't reach public hostnames (no hairpin NAT), so Traefik has a network alias for `auth.${DOMAIN}`.

## Secrets

Credentials live in `secrets/*.secret` (gitignored) and are passed as Docker secrets, never in tracked env files.

```
./init-secrets.sh --check   # list present/missing secrets
./init-secrets.sh           # create missing ones
```

The script reads every `./secrets/*.secret` referenced by the compose files. It generates random values where nothing external depends on them (Authentik keys, OIDC client secrets, Gluetun API key) and prompts (hidden input) for the rest (PIA, Cloudflare, qBittorrent, Plex claim, Sonarr/Radarr API keys, Hardcover token, Anna's Archive donator key). Existing files are never overwritten.

When restoring onto a new machine, copy `secrets/` together with `${MEDIA_VOLUME}/docker_data/`: app databases (CWA, Audiobookshelf, *arr) and Authentik reference the existing values.

## Volumes

This stack uses the local-persist volume driver (https://github.com/MatchbookLab/local-persist, installer: `local_persist_install.sh`). App data lives under `${MEDIA_VOLUME}/docker_data/`, media and downloads under `${MEDIA_VOLUME}/data/`.

## Quick start (new machine)

```
git clone https://github.com/joeRob2468/docker-media-stack ~/.services/docker-media-stack
cd ~/.services/docker-media-stack

cp .env.example .env              # set DOMAIN, EMAIL_ADDRESS, MEDIA_VOLUME
sudo bash local_persist_install.sh
./init-secrets.sh

docker compose pull
docker compose up -d
```

Then:
1. If the Gluetun API key was newly generated, create `${MEDIA_VOLUME}/docker_data/gluetun/auth/config.toml` with it (see `CHANGELOG.md`, 2026-10-05).
2. Fresh Sonarr/Radarr: copy their API keys into `secrets/sonarr-api.secret` / `radarr-api.secret`, then `docker compose up -d unpackerr`.
3. Fresh Authentik: open `https://auth.${DOMAIN}/if/flow/initial-setup/` immediately to set the `akadmin` password, then add the Plex source.
4. Fresh CWA: log in with `admin` / `admin123` and change it immediately.

## Operations

- Gluetun and everything in its network (qBittorrent, Sonarr, Radarr, Prowlarr, Byparr, port forwarder) must be recreated together. A plain `docker restart gluetun` leaves the others pinned to the old network namespace:
  ```
  docker compose up -d --force-recreate gluetun sonarr radarr prowlarr bittorrent byparr bittorrent_port_forwarder
  ```
- DockMon auto-update is off for Gluetun; update it manually, alone.
- Gluetun is pinned to PIA servers `Server-12612-2a` / `Server-12613-2a` (others refused port forwarding, 2026-10-08). Remove `SERVER_NAMES` from `env/gluetun.env` if they disappear.
- Authentik is pinned to a version tag; upgrade one minor version at a time.
- Change history: `CHANGELOG.md`.
