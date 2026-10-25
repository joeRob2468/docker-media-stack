// Prints an API key for Audiobookshelf's read-only "shelfmark" user, creating the user if
// needed. Needs admin-key.js in front (init-secrets.sh runs it that way):
//
//   cat audiobookshelf/admin-key.js audiobookshelf/create-api-key.js | docker exec -i audiobookshelf node -
const USERNAME = 'shelfmark'
const KEY_NAME = 'Shelfmark library check'

runMain(() =>
  withAdminApi(async (api) => {
    const { users } = await api('GET', '/api/users')
    let user = users.find((u) => u.username === USERNAME)
    if (!user) {
      // Never logs in (the key is its only use), so the password is random and discarded
      const created = await api('POST', '/api/users', {
        username: USERNAME,
        password: crypto.randomBytes(24).toString('base64url'),
        type: 'user',
        isActive: true,
        permissions: { download: false, accessAllLibraries: true, accessAllTags: true, accessExplicitContent: true }
      })
      user = created.user
    } else if (!user.isActive) {
      // An inactive user's API keys are rejected
      await api('PATCH', `/api/users/${user.id}`, { isActive: true })
    }

    // A new key replaces the old one (the secret file is only rewritten when it was lost)
    await dbRun('DELETE FROM apiKeys WHERE name = ? AND userId = ?', [KEY_NAME, user.id])
    const { apiKey } = await api('POST', '/api/api-keys', { name: KEY_NAME, userId: user.id, isActive: true })
    process.stdout.write(apiKey.apiKey)
  })
)
