# Automated Media Management Setup

Self-hosted media server stack: VPN-protected downloads, *arr automation, Plex, books/audiobooks, and single sign-on with Plex accounts. Originally based on the guide at https://passthebits.com/.

Contents: [Services](#services) · [Paths](#paths) · [Secrets](#secrets) · [Fresh install](#fresh-install) · [Restore from existing data](#restore-from-existing-data) · [Manual app setup](#manual-app-setup) · [Connecting apps](#connecting-apps-and-devices) · [Single sign-on](#single-sign-on-authentik) · [Operations](#operations)

## Services

Hostnames in this README use `example.com` as a placeholder; replace it with your `DOMAIN` from `.env`.

| Service | URL | Compose file | Notes |
|---|---|---|---|
| 🌐 Traefik | — | `docker-compose.yml` | Reverse proxy, Let's Encrypt wildcard cert via Cloudflare DNS challenge |
| 🔒 Gluetun | — | `docker-compose.yml` | PIA OpenVPN (CA Toronto, port forwarding). HTTP proxy `gluetun:8888` for Shelfmark |
| ⬇️ qBittorrent | `bittorrent.` | `bittorrent-compose.yml` | In Gluetun's network |
| 🔄 Port Forwarder | — | `bittorrent-compose.yml` | Copies Gluetun's forwarded port into qBittorrent |
| 📺 Sonarr | `sonarr.` | `arr-compose.yml` | In Gluetun's network |
| 🎬 Radarr | `radarr.` | `arr-compose.yml` | In Gluetun's network |
| 🔍 Prowlarr | `prowlarr.` | `arr-compose.yml` | In Gluetun's network |
| 🧩 Byparr | — | `arr-compose.yml` | FlareSolverr-compatible Cloudflare solver for Prowlarr, in Gluetun's network |
| 📦 Unpackerr | — | `arr-compose.yml` | Extracts completed downloads for Sonarr/Radarr (env-only config) |
| 📡 Plex | `plex.` | `plex-compose.yml` | |
| 📝 Seerr | `overseerr.` | `plex-compose.yml` | Movie/TV requests, Plex login |
| 🎧 Audiobookshelf | `audiobookshelf.` | `audiobookshelf-compose.yml` | Login via Authentik |
| 📚 Shelfmark | `books.` | `books-compose.yml` | Ebook/audiobook search and download. Fully configured from env. Login via Authentik |
| 📖 Calibre-Web-Automated | `library.` | `books-compose.yml` | Ebook library, OPDS at `/opds`. Login via Authentik |
| 🔑 Authentik | `auth.` | `authentik-compose.yml` | Single sign-on with Plex accounts |
| 🚢 DockMon | `dockmon.` | `dockmon-compose.yml` | Container monitoring and image updates |

Services "in Gluetun's network" share one network namespace: they reach each other (and qBittorrent) at `localhost`, and other containers reach them at `gluetun:<port>`.

### DNS records (Cloudflare, all "DNS only")

| Type | Name | Target |
|---|---|---|
| A | `media` | public IP of the server |
| CNAME | `audiobookshelf`, `auth`, `bittorrent`, `books`, `dockmon`, `library`, `overseerr`, `plex`, `prowlarr`, `radarr`, `sonarr` | `media.example.com` |

The home router has no NAT loopback: devices on the LAN can't reach the public IP. Point the hostnames at the server's LAN IP (`LAN_IP` in `.env`, e.g. `192.168.1.10`) locally, via the Windows hosts file or a router/Pi-hole DNS override (the latter also covers phones). Containers reach `auth.${DOMAIN}` through a Traefik network alias, so server-side login works regardless.

## Paths

Everything lives under `MEDIA_VOLUME` (`/mnt/media`, set in `.env`): app data in `docker_data/<app>`, media and downloads in `data/`. All media and download paths are on one filesystem so hardlinks work.

| Host path | qBittorrent | Sonarr/Radarr/Prowlarr/Unpackerr | Plex | Shelfmark | Audiobookshelf | CWA |
|---|---|---|---|---|---|---|
| `data/torrents` | `/data/torrents` | `/media/torrents` | | `/data/torrents` | | |
| `data/media/tv`, `data/media/movies` | | `/media/media/tv`, `/media/media/movies` | `/media/tv`, `/media/movies` | | | |
| `data/media/books` (audiobooks) | | | | `/data/media/books` | `/audiobooks` | |
| `data/media/ebooks` (Calibre library) | | | | `/data/media/ebooks` | | `/calibre-library` |
| `data/cwa-ingest` | | | | `/data/cwa-ingest` | | `/cwa-book-ingest` |

qBittorrent and the *arrs see the torrent folder under different paths (`/data/torrents` vs `/media/torrents`). Sonarr and Radarr bridge this with **remote path mappings** (see below); without them imports fail with "path does not exist".

## Secrets

All credentials are files in `secrets/*.secret` (gitignored), passed as Docker secrets. Nothing secret is in tracked files.

```
./init-secrets.sh --check   # list present/missing secrets, write nothing
./init-secrets.sh           # create missing ones; never overwrites existing files
```

| Kind | Secrets | Source |
|---|---|---|
| Generated | `authentik-pg-pass`, `authentik-secret-key`, `authentik-bootstrap-password`, `authentik-{shelfmark,cwa,audiobookshelf}-oidc`, `authentik-{shelfmark,cwa,audiobookshelf,plex}-client-id`, `gluetun-apikey`, `sonarr-api`, `radarr-api`, `prowlarr-api` | random |
| Built | `gluetun-auth-config` | Gluetun control-server auth file containing `gluetun-apikey` |
| Prompted | `openvpn_user`, `openvpn_password` | PIA account |
| | `cloudflare-token`, `cloudflare-email` | Cloudflare API token with Zone.DNS edit |
| | `bittorrent-user`, `bittorrent-password` | qBittorrent WebUI login you choose (set the same in qBittorrent) |
| | `plex-claim` | https://account.plex.tv/claim, only needed for a brand-new Plex server, expires in 4 minutes |
| | `authentik-plex-token` | Plex token of the server owner ([how to find it](https://support.plex.tv/articles/204059436)) |
| | `hardcover-token` | https://hardcover.app/account/api (scopes incl. `read:lists`, `write:lists`) |
| | `aa-donator-key` | Anna's Archive account page |
| | `telegram-bot-token`, `telegram-chat-id` | Telegram bot (@BotFather) and chat used for notifications; same as Seerr's Telegram settings |

How they're used:
- Sonarr/Radarr/Prowlarr API keys are pinned with `FILE__<APP>__AUTH__APIKEY`, so the keys are known before the apps first start. Don't regenerate them in the app UI.
- The linuxserver `FILE__` loader keeps a trailing newline as part of the value. Secret files must not end with a newline (`init-secrets.sh` writes them without one; use `printf '%s'` when writing by hand).
- Shelfmark (`shelfmark/start.sh`) and Authentik's worker (entrypoint in compose) export some secrets into env at startup, because those settings can't be loaded from files directly.

To write a secret by hand without leaving it in shell history (zsh):
```
setopt HIST_IGNORE_SPACE
 printf '%s' 'VALUE' > secrets/NAME.secret && chmod 600 secrets/NAME.secret
```

## Fresh install

1. Install Docker and the local-persist plugin:
   ```
   git clone https://github.com/joeRob2468/docker-media-stack ~/.services/docker-media-stack
   cd ~/.services/docker-media-stack
   sudo bash local_persist_install.sh
   ```
2. `cp .env.example .env` and fill it in (make sure the file ends with a newline):

   | Variable | Used for |
   |---|---|
   | `DOMAIN` | all hostnames (`<service>.${DOMAIN}`), Shelfmark/Plex URLs, Authentik blueprint |
   | `EMAIL_ADDRESS` | Let's Encrypt account |
   | `MEDIA_VOLUME` | root of `data/` and `docker_data/` |
   | `TZ` | timezone for all containers (`America/Chicago`) |
   | `PUID` / `PGID` | user/group the apps run as (1000) |
   | `LAN_IP` | Plex `ADVERTISE_IP` |
   | `PLEX_SERVER_ID` | Plex machine identifier allowed to log in via Authentik. A **new** Plex server gets a new ID: after Plex is set up, copy it from https://plex.tv/api/v2/resources (`clientIdentifier` of the server, needs your Plex token) and run `docker compose up -d authentik-worker` |
3. Create folders (owned by uid 1000):
   ```
   mkdir -p $MEDIA_VOLUME/data/{torrents/{tv,movies,temp},media/{tv,movies,books,ebooks},cwa-ingest} $MEDIA_VOLUME/docker_data
   ```
4. Get a Plex claim token right before the next step, then `./init-secrets.sh`.
5. Add the DNS records above.
6. Start: `docker compose pull && docker compose up -d`. First start of Authentik takes several minutes (database migrations).
7. Do the [manual app setup](#manual-app-setup) below, in order.

Already automated, nothing to click: Traefik and certificates, Gluetun (incl. control-server auth and HTTP proxy), port forwarder, Unpackerr, Shelfmark (all settings), Authentik admin account, Plex login source, admin group and the three OIDC apps (blueprint), Sonarr/Radarr/Prowlarr API keys.

## Restore from existing data

Use this when moving to a new machine or disk with a backup of the old one.

1. Steps 1–2 of the fresh install (Docker, local-persist, clone, `.env`).
2. Restore, with the stack stopped on the old machine when the copy was made:
   - `secrets/` (all files; the apps' databases reference these exact values)
   - `$MEDIA_VOLUME/docker_data/` (keep ownership: mostly 1000:1000; `authentik/database` belongs to uid 70)
   - `$MEDIA_VOLUME/data/` (media; downloads optional)
3. `./init-secrets.sh --check` must report `0 missing`. If something is missing, don't let it generate a new random value for anything an app already uses (API keys, OIDC secrets): recover it from the old app config instead.
4. `docker compose up -d`. No manual app setup is needed: configuration comes from `docker_data`, env files and the blueprint. Skip `plex-claim` (only for new servers).
5. Check:
   - `docker logs gluetun | grep "port forwarded"` shows a port, and `docker logs bittorrent_port_forwarder` says it set it.
   - Sonarr/Radarr/Prowlarr open and show no indexer/download client errors (System → Status).
   - Login with Plex works on `books.`, `library.` and `audiobookshelf.`.

## Manual app setup

Only needed on a fresh install. Values below are what the current stack uses.

### qBittorrent (`bittorrent.`)
1. First login: the temporary password is in `docker logs bittorrent`. Set **Tools → Options → WebUI** username/password to the values in `secrets/bittorrent-user|password.secret` (the port forwarder logs in with them).
2. **Downloads**:
   - Default Torrent Management Mode: **Automatic**; "When Category Save Path changed": **Relocate torrent**.
   - Default Save Path: `/data/torrents`
   - Keep incomplete torrents in: `/data/torrents/temp` (enabled)
3. **Categories** (right-click in the category list → Add):
   - `tv` → `/data/torrents/tv`
   - `movies` → `/data/torrents/movies`
   - `books` → `/data/torrents/books` (Shelfmark ebook torrents)
   - `audiobooks` → `/data/torrents/audiobooks` (Shelfmark/AudioBookBay audiobook torrents)
   - Seeding: share limit ratio `0`, action Stop. Sonarr/Radarr ("Remove Completed") and Shelfmark (`PROWLARR_TORRENT_ACTION: remove_and_delete`) remove torrents and their files after import, so `/data/torrents` only holds in-progress downloads.
4. **Connection**: leave the listening port alone (the port forwarder sets it to Gluetun's forwarded port); UPnP off.
5. **BitTorrent**: queueing on, max active downloads/uploads/torrents 4.
6. **WebUI → Bypass authentication for clients in whitelisted IP subnets**: on, `172.18.255.250/32` (Traefik's fixed IP; Authentik already checked the user). Leave localhost bypass off.

### Sonarr (`sonarr.`) and Radarr (`radarr.`)
Do the same in both; differences in brackets as Sonarr / Radarr.
1. **Settings → Media Management**: Use Hardlinks instead of Copy **on**. Root Folder: `/media/media/tv` / `/media/media/movies`.
2. **Settings → Download Clients → qBittorrent**: Host `localhost`, Port `8088`, username/password from the bittorrent secrets, Category `tv` / `movies`, Sequential Order on.
3. **Settings → Download Clients → Remote Path Mappings**: Host `localhost`, Remote Path `/data/torrents/tv/` / `/data/torrents/movies/`, Local Path `/media/torrents/tv/` / `/media/torrents/movies/`.
4. Quality profile used by Seerr: `HD - 720p/1080p` / `HD-1080p`.
5. Indexers are added by Prowlarr; don't add them here.
6. **Settings → Connect → Plex Media Server**: Host `plex` (container name, not an IP: container IPs change when containers are recreated), Port `32400`, authenticate with Plex.

### Prowlarr (`prowlarr.`)
1. **Settings → Tags**: create `flare`.
2. **Settings → Indexers → Indexer Proxies → FlareSolverr**: Name `Byparr`, Host `http://localhost:8191/`, Request Timeout 60, Tags `flare`. Byparr runs in the same network namespace, hence `localhost`.
3. **Indexers**: add EZTV, Knaben and Nyaa.si **with tag `flare`** (Cloudflare-protected); LimeTorrents, RuTracker.org and The Pirate Bay without tags.
4. **Settings → Apps**: add Sonarr and Radarr with Sync Level "Full Sync", Prowlarr Server `http://localhost:9696`, Sonarr/Radarr Server `http://localhost:8989` / `http://localhost:7878`, API key from `secrets/sonarr-api.secret` / `radarr-api.secret`.

### Plex (`plex.`)
1. Claimed automatically from `secrets/plex-claim.secret` on first start.
2. Libraries: **Movies** → `/media/movies`, **TV Shows** → `/media/tv`.
3. Share libraries with friends as usual. Anyone with access to the server can log in to the book apps (see SSO).

### Seerr (`overseerr.`)
1. Sign in with Plex; server `plex`, port `32400`, no SSL; enable Movies and TV Shows.
2. Radarr: hostname `gluetun`, port `7878`, API key from secrets, profile `HD-1080p`, root `/media/media/movies`, default server.
3. Sonarr: hostname `gluetun`, port `8989`, API key from secrets, profile `HD - 720p/1080p`, root `/media/media/tv`, default server.
4. Notifications → Telegram: bot token and chat ID (same values as `secrets/telegram-*.secret`). Current types: pending, approved, available (consider adding auto-approved and failed).

### Authentik (`auth.`)
Mostly automatic:
- `akadmin` password: `cat secrets/authentik-bootstrap-password.secret` (set on first start only).
- The Plex source, `media-admins` group and OIDC apps come from `authentik/blueprints/media-sso.yaml`.

Manual:
1. Log in once with Plex. Then as `akadmin`: Directory → Users → your user → set type **Internal** and add to group **media-admins**.
2. Other Plex users stay external (app access only).

### Audiobookshelf (`audiobookshelf.`)
1. First visit creates the root admin. Library: **Audiobooks** → `/audiobooks`.
2. **Settings → Authentication → OpenID Connect**:
   - Issuer URL `https://auth.example.com/application/o/audiobookshelf/` → Auto-populate
   - Client ID: `cat secrets/authentik-audiobookshelf-client-id.secret`; Client Secret: `cat secrets/authentik-audiobookshelf-oidc.secret`
   - Button text `Login with Plex`, Auto Register on, Match existing users by **email**
   - Allowed mobile redirect URIs: `audiobookshelf://oauth`; Group claim empty
   - Keep password authentication on as a fallback. Restart the container if it asks.

### Calibre-Web-Automated (`library.`)
1. Log in with `admin` / `admin123` and change the password immediately.
2. **Admin → Edit Basic Configuration → Feature Configuration → Login type OAuth → Generic OIDC**:
   - Client ID: `cat secrets/authentik-cwa-client-id.secret`, Client Secret: `cat secrets/authentik-cwa-oidc.secret`
   - Metadata URL `https://auth.example.com/application/o/cwa/.well-known/openid-configuration`
   - Scope `openid profile email`, username field `preferred_username`, email field `email`
   - Admin group `media-admins`, group-based admin management on
3. Restart: `docker compose restart calibre-web-automated`.
4. **Admin → Edit Basic Configuration → Default Settings for New Users:** enable Allow Downloads, Allow eBook Viewer, Allow Changing Password (optionally Allow Editing Public Shelves). The default is none of these, which leaves Plex-login users unable to download, read, or set the password OPDS/KOReader need. Give existing users the same under Admin → Users.
5. Hardcover metadata works automatically (`HARDCOVER_TOKEN` from secrets).

### Shelfmark (`books.`)
All settings come from `env/shelfmark.env` and secrets (and are locked in its UI). One manual step, a local fallback admin for when Authentik is down:
```
docker exec -it -w /app shelfmark /app/.venv/bin/python -c "
import getpass
from werkzeug.security import generate_password_hash
from shelfmark.core.user_db import UserDB
u = input('Username: ').strip(); p = getpass.getpass('Password: ')
UserDB('/config/users.db').create_user(username=u, password_hash=generate_password_hash(p), auth_source='builtin', role='admin')"
```
Keep Shelfmark's IRC sources disabled: they don't use the VPN proxy.

Notifications: new requests, finished and failed downloads go to Telegram (same bot/chat as Seerr), built by `shelfmark/start.sh` from the Telegram secrets. Users can add their own routes under their Shelfmark settings → Notifications.

### DockMon (`dockmon.`)
Create the admin account on first visit (keep it as fallback). Then **Settings → OIDC**:
- Provider URL `https://auth.example.com/application/o/dockmon/`
- Client ID: `cat secrets/authentik-dockmon-client-id.secret`, Client Secret: `cat secrets/authentik-dockmon-oidc.secret`
- Scopes `openid profile email`, groups claim `groups`
- Group mapping: `media-admins` → DockMon's administrator group
- Enable, and turn on **SSO default** so the login page goes straight to Authentik.
 Turn auto-update **off for gluetun** (see Operations); leave it on for the rest.

## Connecting apps and devices

Everyone logs in with their Plex account ("Login with Plex") on the web. A few readers and apps use a username/password instead (OPDS, KOReader sync, some third-party apps): those need an app password set in the service's own profile first (see each section).

**At home:** phones and other devices on the home Wi-Fi need the LAN DNS override (see [DNS records](#dns-records-cloudflare-all-dns-only)); without it, use mobile data. Outside the home everything works directly.

| What | Address |
|---|---|
| Audiobooks | `https://audiobookshelf.example.com` |
| Ebook library (web) | `https://library.example.com` |
| Ebook catalog (OPDS) | `https://library.example.com/opds` |
| Request ebooks/audiobooks | `https://books.example.com` |
| Request movies/TV | `https://overseerr.example.com` |

### Audiobooks: Audiobookshelf
- **Phone (Android/iOS):** install the Audiobookshelf app (links at https://www.audiobookshelf.org). Server address `https://audiobookshelf.example.com`, then **Login with Plex**. Downloads for offline listening and progress sync work in the app.
- **Third-party iOS apps** (e.g. ShelfPlayer, Plappa): same server address. If an app has no OpenID/"Login with Plex" option, an admin sets a password for that user in Audiobookshelf (Settings → Users) and the app logs in with username/password.
- **Desktop:** use the web player in the browser; "Install app" in Chrome/Edge gives it its own window.

### Ebooks: Calibre-Web-Automated
First set an app password: log in at `library.` with Plex → click your username (top right) → set **Password** → Save. Use your CWA username (shown there) with this password below. If the password field is missing, ask an admin to enable "Allow Changing Password" for you.

- **Moon+ Reader (Android):** Net Library → **+** (Add OPDS catalog) → URL `https://library.example.com/opds`, your CWA username and app password. Browse and download books into Moon+. Reading position syncs through Moon+'s own Dropbox/Google Drive/WebDAV option (Settings → Sync), not through CWA.
- **KOReader (Android, Kobo, Kindle, PocketBook):**
  - Library: Search (magnifier) → OPDS catalog → **+** → `https://library.example.com/opds`, username, app password.
  - Progress sync with CWA: open `https://library.example.com/kosync` in a browser and follow the plugin instructions there (custom sync server, same username/password). Progress then also shows in CWA.
- **iOS readers with OPDS** (e.g. Marvin, KyBook, Panels for comics): add an OPDS catalog with the same URL and credentials.
- **Desktop:** read in the browser (CWA's built-in reader), or use **Thorium Reader** (Windows/macOS/Linux): Catalogs → Add OPDS feed → same URL; it asks for username/password on first open.
- **Calibre desktop:** CWA's library is a Calibre library on the server, but desktop Calibre can't attach to it remotely, and opening `metadata.db` over a network share while CWA runs risks corrupting it. Edit metadata in CWA's web UI instead, or download books from CWA and add them to a local Calibre library.
- **Kobo e-readers (optional, not enabled):** CWA can sync shelves to Kobo devices. Admin: Admin → Edit Basic Configuration → Feature Configuration → **Enable Kobo sync**. User: profile → **Create Kobo Sync Token**, then put the shown `api_endpoint` line into `.kobo/Kobo/Kobo eReader.conf` on the device (USB).
- **Kindle (optional, not enabled):** Send-to-Kindle needs an SMTP account in Admin → Edit Email Server Settings and each user's Kindle email in their profile.

### Requests: Shelfmark and Seerr
Web apps, no native client. On a phone open `https://books.example.com` / `https://overseerr.example.com` and use **Add to Home Screen** (Safari Share menu / Chrome menu) for an app-like icon. Requested ebooks show up in CWA, audiobooks in Audiobookshelf.

### Plex
Official Plex apps on any device, signed in with the Plex account the library is shared with. Plexamp for music if libraries are added later.

### Admin apps (*arrs, qBittorrent, DockMon)
Browser: log in with Plex (must be in `media-admins`); no second login. Mobile apps such as nzb360 (Android) or Ruddarr (iOS) connect to `https://sonarr.example.com` etc. with the API key from `secrets/<app>-api.secret`; `/api` isn't behind Authentik. qBittorrent and DockMon have no API exception, so their mobile apps won't work from outside.

## Books flow

```
Shelfmark ──AA / libgen / bypasser──▶ gluetun:8888 HTTP proxy ──▶ VPN
          ├─ torrents ──▶ qBittorrent (already in VPN)
          ├─ ebooks ──▶ data/cwa-ingest ──▶ CWA ──▶ data/media/ebooks ──OPDS──▶ Moon+ Reader
          └─ audiobooks ──▶ data/media/books (hardlinked) ──▶ Audiobookshelf
```

## Single sign-on (Authentik)

- Plex source: only accounts with access to the Plex server `PLEX_SERVER_ID` can log in ("Allow friends" off).
- `authentik/blueprints/media-sso.yaml` defines the Plex source, its login button, the `media-admins` group and the OIDC apps. Authentik reapplies it when the file changes and hourly: **edit the file, not the UI**.
- `media-admins` members are admins in Shelfmark and CWA.
- App logins (Shelfmark, CWA, Audiobookshelf, DockMon, admin tools) use the `media-login` flow: only the Plex source and no username field, so Authentik goes straight to Plex. `auth.example.com` itself keeps the default flow with password login (for `akadmin`).
- Emails are sent as verified so apps link existing accounts by email.
- Local logins remain in each app as a fallback.
- **Admin tools** (Sonarr, Radarr, Prowlarr, qBittorrent, DockMon) sit behind Authentik forward auth (`authentik@docker` Traefik middleware, "Admin tools" proxy provider in domain mode on the embedded outpost). Only `media-admins` and `authentik Admins` get through; everyone else is denied. Sonarr/Radarr/Prowlarr `/api` bypasses it and still requires the API key. No second login: the *arrs use `AUTH__METHOD=External` (env), qBittorrent skips its login for Traefik's fixed IP `172.18.255.250` only, and DockMon logs in via its own OIDC against Authentik. Inside `media_network` the *arr UIs are reachable without login; only this stack's containers are on it.
- "Login with Plex" reuses an existing Authentik session. If the browser is signed in to Authentik as `akadmin`, the apps would get `akadmin`; a `deny-akadmin` policy (blueprint) blocks that with a message. Sign out at `auth.` first, or do Authentik admin work in a separate browser profile.

## Operations

- Gluetun and everything in its network must be recreated together; a plain `docker restart gluetun` leaves the others attached to the old network namespace:
  ```
  docker compose up -d --force-recreate gluetun sonarr radarr prowlarr bittorrent byparr bittorrent_port_forwarder
  ```
- DockMon auto-update is off for Gluetun (updating it races its dependents); update it manually, alone, with the command above.
- Gluetun is pinned to PIA servers `Server-12612-2a` / `Server-12613-2a` (others refused port forwarding, 2026-10-08). Remove `SERVER_NAMES` from `env/gluetun.env` if they disappear.
- Authentik is pinned to a version tag; upgrade one minor version at a time.
- Change history: `CHANGELOG.md`.
