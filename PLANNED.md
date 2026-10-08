# Planned

Research only, nothing deployed. Researched 2026-10-05.

## Target flow
```
Chaptarr ──imports──▶ media/ebooks ──ro──▶ Kavita (OPDS) ──▶ Moon+ Reader Net Library
         └─────────▶ media/books   ──────▶ Audiobookshelf (unchanged)
Moon+ progress ──▶ Dropbox / Drive / optional self-hosted WebDAV
```

## Folders
| Host path | Purpose |
|---|---|
| `/mnt/media/data/media/books` | Existing audiobooks (18 authors, m4b, 49G). Audiobookshelf `/audiobooks`. **Don't move**: repointing ABS risks re-import. Chaptarr audiobook root. |
| `/mnt/media/data/media/ebooks` | New. Chaptarr ebook root. Kavita library (ro). |
| `/mnt/media/data/torrents/books` | New. qBit category `books`. |
| `/mnt/media/docker_data/{chaptarr,kavita}` | New config dirs, owned `1000:1000` (create before first start). |

Same filesystem + parent as other *arr paths → hardlinks.

## Chaptarr
- Image `chaptarr/chaptarr:latest`, port 8789 (free in gluetun netns). PUID/PGID default 99:100, so set 1000. Official volumes: `/config`, `/audiobooks`, `/ebooks`, `/downloads`.
- Fit to stack: service in `arr-compose.yml` like sonarr: `network_mode: service:gluetun`, `env_file: ./env/arr.env`, `data:/media`, `chaptarr:/config` (local-persist), traefik labels `chaptarr.${DOMAIN}` → 8789, depends_on gluetun/traefik/bittorrent.
- In UI:
  - Root folders: `/media/media/books` (audiobooks), `/media/media/ebooks`.
  - Download client: qBit `localhost:8088`, category `books`.
  - Remote path mapping `/data/torrents/` → `/media/torrents/`.
  - Separate quality profiles for ebook and audiobook; prefer M4B (optional m4b-tool MP3→M4B conversion).
  - Naming for ABS: `{Author Name}/{Series Title}/Vol {Series Number} - {Book Title} ({Release Year})`.
- Indexers: **use Chaptarr's own indexer settings, not Prowlarr** (decided). Alternatives if needed:
  - Prowlarr app type **Readarr** (`http://localhost:9696` / `http://localhost:8789`); open bug [#84](https://github.com/Chaptarr/chaptarr/issues/84) (Prowlarr test → HTTP 500).
  - Manual Torznab per Prowlarr indexer: `http://localhost:9696/<id>/api` + Prowlarr API key.
  - FlareSolverr (e.g. for MAM): use existing byparr `http://localhost:8191`.
- Unpackerr: likely works as Readarr (`UN_READARR_0_URL=http://gluetun:8789`, key via `filepath:`, `UN_READARR_0_PATHS_0=/media/torrents/books`). Untested.
- DockMon: auto-update **on** (gluetun dependent; only gluetun is off).
- Readarr archived 2025-06-27 (metadata backend offline); Chaptarr uses its own metadata providers.

## Kavita (OPDS for Moon+)
- Image `lscr.io/linuxserver/kavita:latest`, port 5000, PUID/PGID supported.
- `media_network` (not gluetun), no published port, traefik only.
```yaml
  kavita:
    image: lscr.io/linuxserver/kavita:latest
    container_name: kavita
    restart: always
    environment: [PUID=1000, PGID=1000, TZ=America/Chicago]
    volumes:
      - /mnt/media/docker_data/kavita:/config
      - /mnt/media/data/media/ebooks:/data/ebooks:ro
    labels:
      - traefik.enable=true
      - traefik.http.routers.kavita.rule=Host(`kavita.${DOMAIN}`)
      - traefik.http.routers.kavita.entrypoints=websecure
      - traefik.http.services.kavita.loadbalancer.server.port=5000
```
- Library type **Book** → `/data/ebooks`. OPDS URL: Settings → Account (embeds API key; treat as secret).
- Series grouping uses EPUB metadata (`calibre:series`/`series_index`, EPUB3 `belongs-to-collection`/`group-position`) → title → filename. Folder layout doesn't drive grouping. Fix bad metadata with Calibre if needed.
- Not chosen: Calibre-Web/COPS (need a Calibre `metadata.db`; Chaptarr writes plain folders).

## Moon+ Reader
- OPDS: Net Library → add Kavita OPDS URL → browse/download. Confirmed.
- Position/bookmark sync (Pro): Dropbox, WebDAV, Google Drive (sources inconsistent; check app). Optional self-hosted WebDAV: `rclone serve webdav` behind traefik + basic auth, sync folder only.
- Progress lives in Moon+, not Kavita.

## Not chosen
- Syncthing: whole-folder sync only (no browse), needs Syncthing-Fork on phone (official Android app discontinued), must run outside gluetun (22000/tcp+udp, 21027/udp, UI 8384).

## Build order
1. Create dirs (`media/ebooks`, `torrents/books`, `docker_data/{chaptarr,kavita}`), `chown 1000:1000`.
2. Chaptarr service → `docker compose up -d chaptarr` (no other restarts).
3. Chaptarr UI: roots, qBit + category, remote path mapping, profiles, indexers.
4. Kavita service → `docker compose up -d kavita`; create library, user, OPDS URL.
5. Moon+: add OPDS catalog; set progress sync.
6. Optional: Unpackerr Readarr entry, WebDAV container.
7. Log in `CHANGELOG.md`.

## Sources
- Chaptarr: [README](https://github.com/Chaptarr/chaptarr), [compose](https://raw.githubusercontent.com/chaptarr/chaptarr/develop/docker-compose.yml), [serversathome guide](https://github.com/serversathome/wiki/blob/main/chaptarr.md), [ElfHosted](https://docs.elfhosted.com/app/chaptarr/), [SSD Nodes](https://www.ssdnodes.com/learn/self-host-chaptarr-audiobook-library), [issue #84](https://github.com/Chaptarr/chaptarr/issues/84)
- Kavita: [LinuxServer](https://docs.linuxserver.io/images/docker-kavita/), [selfhosting.sh](https://selfhosting.sh/apps/kavita/), [EPUB metadata](https://wiki.kavitareader.com/guides/metadata/epubs/), [EPUB scanner](https://wiki.kavitareader.com/guides/scanner/epub/), [Calibre](https://wiki.kavitareader.com/guides/external-tools/calibre/)
- Moon+: [GameStar](https://www.gamestar.de/artikel/,3457346.html), [MobileRead](https://www.mobileread.com/forums/showthread.php?p=3468573)
