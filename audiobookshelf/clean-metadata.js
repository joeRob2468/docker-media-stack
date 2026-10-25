// Tidies audiobook metadata in Audiobookshelf. Needs admin-key.js in front:
//
//   cat audiobookshelf/admin-key.js audiobookshelf/clean-metadata.js | docker exec -i audiobookshelf node - [--apply] [--hardcover [--compare]]
//
// Without --apply it only prints the planned changes (JSON). Rules, from the item's own data:
// - Title: drop "(Unabridged)" / "(1 of 5)", and series/number decorations around the book's
//   title when the folder name (`N - Title` or `Title`) shows what the title is. Edition
//   markers like "(Dramatized Adaptation)" stay: they tell editions apart.
// - Series: number from the folder (`2.5 - The Exile`), or series and number from a title
//   suffix ("…: The Library Trilogy, Book 2") when the book has no series.
// - Authors: drop names that are also the book's narrators; "N.K. Jemisin" -> "N. K. Jemisin".
// - Year: "2024-01-01" -> "2024".
// With --hardcover (needs HARDCOVER_API_KEY), books still missing a series number, a series or
// a sane year are looked up on Hardcover, the same source Shelfmark uses, and only those empty
// fields are filled, when title and author agree. Two requests per looked-up book, paced to
// stay well inside Hardcover's per-account limit, which Shelfmark shares. --compare (report
// only, never applied) looks up every book and lists where Hardcover's series, number or
// year differ from the current values.
// Changes are saved through the API, so Audiobookshelf keeps them in its metadata.json, which
// wins over file tags on rescans. Nothing on disk is renamed.
const APPLY = process.argv.includes('--apply')
const HARDCOVER = process.argv.includes('--hardcover')
const COMPARE = HARDCOVER && process.argv.includes('--compare')
const HARDCOVER_URL = 'https://api.hardcover.app/v1/graphql'
const HARDCOVER_GAP_MS = 1500 // 40 a minute; the account's limit is 60, shared with Shelfmark
const EDITION = /\b(dramati[sz]ed|full[- ]cast|graphic ?audio|adaptation)\b/i
const THIS_YEAR = new Date().getFullYear()

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const surname = (name) => norm(name).split(' ').pop()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function folderInfo(item) {
  let name = item.relPath.split('/').pop()
  if (item.isFile) name = name.replace(/\.[^.]+$/, '')
  name = name.replace(/_ /g, ': ') // a ":" in a title is saved as "_" in folder names
  const m = name.match(/^(\d+(?:\.\d+)?)\s+-\s+(.+)$/)
  return m ? { num: m[1], title: m[2] } : { num: null, title: name }
}

function cleanTitle(title, folder) {
  let t = title.trim()
  for (let prev; prev !== t; ) {
    prev = t
    t = t.replace(/\s*\((?:unabridged|abridged|\d+\s+of\s+\d+)\)\s*$/i, '')
  }
  const ft = folder.title
  if (ft.length >= 3 && norm(t) !== norm(ft)) {
    const i = t.toLowerCase().indexOf(ft.toLowerCase())
    const rest = i >= 0 ? t.slice(0, i) + t.slice(i + ft.length) : ''
    if (i >= 0 && !EDITION.test(rest)) {
      t = t.slice(i, i + ft.length)
    } else if (i < 0 && folder.num && /\b(?:bk|book)\.?\s*\d+(?:\.\d+)?$/i.test(t)) {
      t = ft // "Broken Earth bk 3" in folder "3 - The Stone Sky"
    }
  }
  return t
}

function plan(item, seriesNames) {
  const md = item.media.metadata
  const folder = folderInfo(item)
  const changes = {}
  const set = (field, from, to, source = 'rules') => (changes[field] = { from, to, source })

  const title = cleanTitle(md.title, folder)
  if (title !== md.title) set('title', md.title, title)

  const canonical = (name) => seriesNames.find((n) => norm(n) === norm(name)) || name
  let series = md.series.map((s) => ({ id: s.id, name: s.name, sequence: s.sequence || '' }))
  const suffix = md.title.match(/:\s*(.+?),?\s+Book\s+(\d+(?:\.\d+)?)\s*$/i)
  if (!series.length && suffix) series = [{ name: canonical(suffix[1]), sequence: suffix[2] }]
  if (folder.num) series = series.map((s) => (s.sequence ? s : { ...s, sequence: folder.num }))
  if (fmtSeries(series) !== fmtSeries(md.series)) set('series', fmtSeries(md.series), fmtSeries(series))

  const narrators = new Set((md.narrators || []).map(norm))
  let authors = md.authors.map((a) => ({ id: a.id, name: a.name }))
  const writers = authors.filter((a) => !narrators.has(norm(a.name)))
  if (writers.length && writers.length < authors.length) authors = writers
  authors = authors.map((a) => {
    const name = a.name.replace(/\b([A-Z])\.(?=[A-Z])/g, '$1. ')
    return name === a.name ? a : { name }
  })
  const names = (list) => list.map((a) => a.name).join(' & ')
  if (names(authors) !== names(md.authors)) set('authors', names(md.authors), names(authors))

  const date = String(md.publishedYear || '').match(/^(\d{4})-\d{2}-\d{2}/)
  if (date) set('publishedYear', md.publishedYear, date[1]) // a full date in the year field

  const year = parseInt(md.publishedYear, 10)
  const badYear = !md.publishedYear || !(year >= 1000 && year <= THIS_YEAR + 1)
  return { item, folder, title, series, authors, badYear, changes }
}

let lastHardcoverCall = 0
async function hardcover(query, variables, retried = false) {
  const key = (process.env.HARDCOVER_API_KEY || '').trim().replace(/^Bearer\s+/i, '')
  if (!key) throw new Error('HARDCOVER_API_KEY is not set')
  await sleep(Math.max(0, lastHardcoverCall + HARDCOVER_GAP_MS - Date.now()))
  lastHardcoverCall = Date.now()
  const res = await fetch(HARDCOVER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': 'docker-media-stack clean-metadata' },
    body: JSON.stringify({ query, variables })
  })
  if (res.status === 429 && !retried) {
    await sleep(Math.min(60, Number(res.headers.get('retry-after')) || 30) * 1000)
    return hardcover(query, variables, true)
  }
  if (!res.ok) throw new Error(`Hardcover ${res.status}`)
  const body = await res.json()
  if (body.errors) throw new Error(`Hardcover: ${JSON.stringify(body.errors).slice(0, 200)}`)
  return body.data
}

// The Hardcover book with this title and author: series name/number and original year.
async function hardcoverBook(title, author) {
  const found = await hardcover(
    'query($q: String!) { search(query: $q, query_type: "Book", per_page: 5, page: 1) { results } }',
    { q: `${title} ${author}` }
  )
  const hits = found.search?.results?.hits || []
  const doc = hits
    .map((h) => h.document || h)
    .find((d) => {
      const t = norm(d.title)
      // Hardcover titles a series volume "Series: Book Title" ("Mistborn: The Final Empire")
      const sameTitle = t === norm(title) || t.endsWith(' ' + norm(title))
      return sameTitle && (d.author_names || []).some((a) => norm(a).includes(surname(author)))
    })
  if (!doc) return null
  const data = await hardcover(
    'query($id: Int!) { books(where: {id: {_eq: $id}}, limit: 1) { release_year featured_book_series { position series { name } } } }',
    { id: Number(doc.id) }
  )
  const book = data.books?.[0] || {}
  const fs = book.featured_book_series
  return {
    id: doc.id,
    year: book.release_year ? String(book.release_year) : null,
    series: fs?.series?.name ? { name: fs.series.name, sequence: fs.position != null ? String(fs.position) : '' } : null
  }
}

const fmtSeries = (list) => list.map((s) => `${s.name}${s.sequence ? ' #' + s.sequence : ''}`).join('; ')

// Fill only what is still empty (series, number, year) from Hardcover's record.
async function hardcoverFill(p) {
  const md = p.item.media.metadata
  const needs = COMPARE || !p.series.length || p.series.some((s) => !s.sequence) || p.badYear
  if (!needs || EDITION.test(md.title) || !p.authors.length) return
  const hc = await hardcoverBook(p.title, p.authors[0].name)
  if (!hc) {
    if (COMPARE) p.changes.hardcover = { from: '', to: 'no confident match', source: 'hardcover' }
    return
  }
  if (COMPARE) {
    // Report only: where Hardcover disagrees with what will be stored
    const ours = fmtSeries(p.series)
    const theirs = hc.series ? fmtSeries([hc.series]) : ''
    if (theirs && norm(theirs) !== norm(ours)) p.changes.compareSeries = { from: ours, to: theirs, source: 'hardcover' }
    if (hc.year && hc.year !== String(md.publishedYear || '')) p.changes.compareYear = { from: md.publishedYear, to: hc.year, source: 'hardcover' }
    return
  }
  const before = fmtSeries(p.series)
  if (!p.series.length && hc.series) {
    p.series = [hc.series]
  } else if (hc.series) {
    p.series = p.series.map((s) => (!s.sequence && norm(s.name) === norm(hc.series.name) ? { ...s, sequence: hc.series.sequence } : s))
  }
  const after = fmtSeries(p.series)
  if (after !== before) p.changes.series = { from: p.changes.series?.from ?? fmtSeries(md.series), to: after, source: 'hardcover' }
  if (p.badYear && hc.year) p.changes.publishedYear = { from: md.publishedYear, to: hc.year, source: 'hardcover' }
}

runMain(() =>
  withAdminApi(async (api) => {
    const { libraries } = await api('GET', '/api/libraries')
    const out = []
    for (const lib of libraries.filter((l) => l.mediaType === 'book')) {
      const { results } = await api('GET', `/api/libraries/${lib.id}/items?limit=0`)
      const items = []
      for (const r of results) items.push(await api('GET', `/api/items/${r.id}?expanded=1`))
      const seriesNames = [...new Set(items.flatMap((i) => i.media.metadata.series.map((s) => s.name)))]
      for (const item of items) {
        const p = plan(item, seriesNames)
        if (HARDCOVER) {
          await hardcoverFill(p).catch((e) => console.error(`Hardcover lookup failed for ${item.relPath}: ${e.message}`))
        }
        if (!Object.keys(p.changes).length) continue
        if (APPLY && !COMPARE) {
          const metadata = {}
          if (p.changes.title) metadata.title = p.title
          if (p.changes.series) metadata.series = p.series
          if (p.changes.authors) metadata.authors = p.authors
          if (p.changes.publishedYear) metadata.publishedYear = p.changes.publishedYear.to
          await api('PATCH', `/api/items/${item.id}/media`, { metadata })
        }
        out.push({ path: item.relPath, changes: p.changes })
      }
    }
    // Applied runs stay quiet when nothing changed, so a nightly log only records changes
    if (APPLY && !out.length) return
    console.log(JSON.stringify({ applied: APPLY, at: new Date().toISOString(), items: out }, null, 1))
  })
)
