// Prints an API key for Audiobookshelf's read-only "shelfmark" user, creating the user if
// needed. Run inside the audiobookshelf container (init-secrets.sh does this):
//
//   docker exec -i audiobookshelf node - < audiobookshelf/create-api-key.js
//
// Audiobookshelf only hands out API keys to a logged-in admin, and our admins log in via
// Plex. So this signs a short-lived admin key the same way Audiobookshelf does (JWT with
// the server's tokenSecret, plus an apiKeys row), uses it for the API calls, and deletes it.
const crypto = require('crypto')
const jwt = require('/app/node_modules/jsonwebtoken')
const sqlite3 = require('/app/node_modules/sqlite3')

const USERNAME = 'shelfmark'
const KEY_NAME = 'Shelfmark library check'
const BASE = `http://localhost:${process.env.PORT || 80}`
const DB_PATH = `${process.env.CONFIG_PATH || '/config'}/absdatabase.sqlite`

const db = new sqlite3.Database(DB_PATH)
const all = (sql, params = []) => new Promise((ok, fail) => db.all(sql, params, (e, rows) => (e ? fail(e) : ok(rows))))
const run = (sql, params = []) => new Promise((ok, fail) => db.run(sql, params, (e) => (e ? fail(e) : ok())))
// Sequelize's SQLite date format
const now = () => new Date().toISOString().replace('T', ' ').replace('Z', ' +00:00')

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
  return res.json()
}

async function main() {
  const [settings] = await all("SELECT value FROM settings WHERE key = 'server-settings'")
  const tokenSecret = settings && JSON.parse(settings.value).tokenSecret
  const [root] = await all("SELECT id FROM users WHERE type = 'root' AND isActive = 1 LIMIT 1")
  if (!tokenSecret || !root) throw new Error('Audiobookshelf is not set up yet (no token secret or root user)')

  const tempId = crypto.randomUUID()
  const tempName = 'init-secrets (temporary)'
  await run(
    'INSERT INTO apiKeys (id, name, isActive, createdAt, updatedAt, userId, createdByUserId) VALUES (?, ?, 1, ?, ?, ?, ?)',
    [tempId, tempName, now(), now(), root.id, root.id]
  )
  try {
    const admin = jwt.sign({ keyId: tempId, name: tempName, type: 'api' }, tokenSecret, { expiresIn: 300 })

    const { users } = await api(admin, 'GET', '/api/users')
    let user = users.find((u) => u.username === USERNAME)
    if (!user) {
      // Never logs in (the key is its only use), so the password is random and discarded
      const created = await api(admin, 'POST', '/api/users', {
        username: USERNAME,
        password: crypto.randomBytes(24).toString('base64url'),
        type: 'user',
        isActive: true,
        permissions: { download: false, accessAllLibraries: true, accessAllTags: true, accessExplicitContent: true }
      })
      user = created.user
    } else if (!user.isActive) {
      // An inactive user's API keys are rejected
      await api(admin, 'PATCH', `/api/users/${user.id}`, { isActive: true })
    }

    // A new key replaces the old one (the secret file is only rewritten when it was lost)
    await run('DELETE FROM apiKeys WHERE name = ? AND userId = ?', [KEY_NAME, user.id])
    const { apiKey } = await api(admin, 'POST', '/api/api-keys', { name: KEY_NAME, userId: user.id, isActive: true })
    process.stdout.write(apiKey.apiKey)
  } finally {
    await run('DELETE FROM apiKeys WHERE id = ?', [tempId])
    db.close()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
