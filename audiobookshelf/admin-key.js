// Shared by the scripts in this folder, which run inside the audiobookshelf container:
//
//   cat audiobookshelf/admin-key.js audiobookshelf/<script>.js | docker exec -i audiobookshelf node - [args]
//
// Audiobookshelf only takes API calls from a logged-in user, and our admins log in via
// Plex. withAdminApi() signs a short-lived admin key the same way Audiobookshelf does
// (JWT with the server's tokenSecret, plus an apiKeys row), hands an API caller to `fn`,
// and deletes the key afterwards.
const crypto = require('crypto')
const jwt = require('/app/node_modules/jsonwebtoken')
const sqlite3 = require('/app/node_modules/sqlite3')

const ABS_BASE = `http://localhost:${process.env.PORT || 80}`
const ABS_DB_PATH = `${process.env.CONFIG_PATH || '/config'}/absdatabase.sqlite`

const absDb = new sqlite3.Database(ABS_DB_PATH)
const dbAll = (sql, params = []) => new Promise((ok, fail) => absDb.all(sql, params, (e, rows) => (e ? fail(e) : ok(rows))))
const dbRun = (sql, params = []) => new Promise((ok, fail) => absDb.run(sql, params, (e) => (e ? fail(e) : ok())))
// Sequelize's SQLite date format
const sqlNow = () => new Date().toISOString().replace('T', ' ').replace('Z', ' +00:00')

async function withAdminApi(fn) {
  const [settings] = await dbAll("SELECT value FROM settings WHERE key = 'server-settings'")
  const tokenSecret = settings && JSON.parse(settings.value).tokenSecret
  const [root] = await dbAll("SELECT id FROM users WHERE type = 'root' AND isActive = 1 LIMIT 1")
  if (!tokenSecret || !root) throw new Error('Audiobookshelf is not set up yet (no token secret or root user)')

  const keyId = crypto.randomUUID()
  const keyName = 'docker-media-stack script (temporary)'
  await dbRun(
    'INSERT INTO apiKeys (id, name, isActive, createdAt, updatedAt, userId, createdByUserId) VALUES (?, ?, 1, ?, ?, ?, ?)',
    [keyId, keyName, sqlNow(), sqlNow(), root.id, root.id]
  )
  try {
    const token = jwt.sign({ keyId, name: keyName, type: 'api' }, tokenSecret, { expiresIn: 600 })
    const api = async (method, path, body) => {
      const res = await fetch(`${ABS_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body && JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`)
      return res.json()
    }
    return await fn(api)
  } finally {
    await dbRun('DELETE FROM apiKeys WHERE id = ?', [keyId])
    absDb.close()
  }
}

function runMain(main) {
  main().catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
}
