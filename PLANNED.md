# Planned

Books stack. Researched 2026-10-08 (replaces 2026-10-05 Chaptarr/Kavita plan).

## Flow
```
Shelfmark (books.example.com)
  ├─ Anna's Archive / libgen / Chromium bypasser / metadata ──HTTP proxy──▶ gluetun:8888 ──▶ PIA
  ├─ Prowlarr (gluetun:9696) torrents ──▶ qBit (gluetun:8088, already in VPN)
  ├─ ebooks ──▶ /data/cwa-ingest ──▶ CWA ──▶ Calibre library media/ebooks
  │                                        └─ OPDS (library.example.com/opds) ──▶ Moon+ Net Library
  └─ audiobooks ──▶ /data/media/books (hardlink) ──▶ Audiobookshelf (unchanged)
```

## Files
- `books-compose.yml` (in `docker-compose.yml` `include:`): `calibre-web-automated`, `shelfmark`.
- `env/cwa.env`, `env/shelfmark.env`.
- `env/gluetun.env`: + `HTTPPROXY: on` (port 8888, only reachable on `media_network`; no host port).

## Folders (`${MEDIA_VOLUME}` = /mnt/media, owned 1000:1000)
| Host | Container | Purpose |
|---|---|---|
| `data/media/ebooks` | CWA `/calibre-library` | Calibre library |
| `data/cwa-ingest` | CWA `/cwa-book-ingest`, Shelfmark `/data/cwa-ingest` | Ebook drop; CWA deletes after import |
| `data/media/books` | Shelfmark `/data/media/books` | Existing audiobooks (ABS `/audiobooks`) |
| `data` | Shelfmark `/data` | Matches qBit `/data/torrents` paths; same mount → hardlinks |
| `docker_data/{cwa,shelfmark}` | `/config` | App data. CWA `app.db` mounted ro in Shelfmark at `/auth/app.db` |

## Shelfmark
- Image `ghcr.io/calibrain/shelfmark:latest` (full, with Chromium; ~2 GB RAM), port 8084, `user: 1000:1000`.
- Proxy: `PROXY_MODE=http`, `HTTP_PROXY=http://gluetun:8888`, `NO_PROXY=gluetun,calibre-web-automated,localhost,127.0.0.1`.
  Source-checked (`download/network.py`, `bypass/internal_bypasser.py`): covers AA/libgen/direct downloads, metadata, MAM, internal Chromium bypasser.
  **IRC is not proxied** (raw sockets) → keep IRC sources disabled. Gluetun down → proxied requests fail (no leak).
- Ebooks: `INGEST_DIR=/data/cwa-ingest`, `FILE_ORGANIZATION=none`, `HARDLINK_TORRENTS=false` (docs: no rename/hardlink into ingest folders).
- Audiobooks: `DESTINATION_AUDIOBOOK=/data/media/books`, `FILE_ORGANIZATION_AUDIOBOOK=organize` (`{Author}/{Title}/{Title}`), hardlinked.
- Auth: `AUTH_METHOD=cwa` (CWA users), `SESSION_COOKIE_SECURE=true`.
- UI setup: Direct Download on + AA mirrors (`annas-archive.gl` recommended by upstream, Aug 2026); Prowlarr `http://gluetun:9696` + API key; qBit `http://gluetun:8088`, categories `books`/`audiobooks`; Hardcover API key (optional).

## Calibre-Web-Automated
- Image `crocodilestick/calibre-web-automated:latest`, port 8083. Default login `admin`/`admin123` → change immediately.
- Ingest auto-converts to EPUB by default; originals backed up to `/config/processed_books`.
- OPDS: `https://library.example.com/opds` (basic auth, CWA user).
- Progress sync: KOSync (KOReader) and Kobo only. Moon+ supports neither → Moon+'s own Dropbox/Drive/WebDAV sync.

## Remote access
Traefik labels, `websecure`, wildcard cert. Cloudflare DNS: CNAME `books`, `library` → `media.example.com`, DNS only.

## DockMon
Auto-update on for both (not gluetun dependents).

## Build order
1. Create dirs, `chown 1000:1000`.
2. `docker compose up -d calibre-web-automated`; change admin login. (CWA first so `app.db` exists before Shelfmark mounts it.)
3. `docker compose up -d shelfmark`; configure sources.
4. `HTTPPROXY: on` → `docker compose up -d gluetun sonarr radarr prowlarr bittorrent byparr bittorrent_port_forwarder` (downtime; pick time).
5. Test AA download; verify VPN egress (`HTTPPROXY_LOG: on` temporarily).
6. Moon+: add OPDS catalog.
7. `CHANGELOG.md`.

## Not chosen
- Chaptarr + Kavita (2026-10-05 plan): no Anna's Archive support.
- Shelfmark in gluetun netns: forced VPN incl. IRC, but inherits dependent-recreate problem.
- Shelfmark built-in WireGuard: stack uses PIA OpenVPN via gluetun.

## Sources
[Shelfmark](https://github.com/calibrain/shelfmark), [env vars](https://github.com/calibrain/shelfmark/blob/main/docs/environment-variables.md), [CWA](https://github.com/crocodilestick/Calibre-Web-Automated), [gluetun HTTP proxy](https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/http-proxy.md)
