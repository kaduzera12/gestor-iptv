require('dotenv').config()
const fetch = require('node-fetch')
const db = require('./db')

const { PANEL_URL, PANEL_USER, PANEL_PASS } = process.env

async function loginPainel() {
  const resPage = await fetch(`${PANEL_URL}/login`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  const html = await resPage.text()
  const cookies = resPage.headers.raw()['set-cookie'] || []
  const cookieStr = cookies.map(c => c.split(';')[0]).join('; ')

  const csrfMatch = html.match(/name='csrf'\s+value='([^']+)'/)
  if (!csrfMatch) throw new Error('CSRF token não encontrado')
  const csrf = csrfMatch[1]

  const resLogin = await fetch(`${PANEL_URL}/login`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: cookieStr,
    },
    body: new URLSearchParams({ username: PANEL_USER, password: PANEL_PASS, csrf }),
    redirect: 'manual',
  })

  const loginCookies = resLogin.headers.raw()['set-cookie'] || []
  const loginBody = await resLogin.text()
  if (!loginBody.includes('dashboard')) throw new Error('Login falhou')

  // Mescla cookies deduplificando por nome — o do login sobrescreve o inicial
  const cookieMap = new Map()
  for (const c of [...cookies, ...loginCookies]) {
    const part = c.split(';')[0]
    const [name] = part.split('=')
    cookieMap.set(name.trim(), part)
  }
  const sessionCookie = [...cookieMap.values()].join('; ')

  return sessionCookie
}

function extrairTelefone(messageHtml) {
  const match = messageHtml && messageHtml.match(/phone=55(\d+)/)
  return match ? '55' + match[1] : null
}

function extrairNome(notes) {
  if (!notes) return null
  return notes.replace(/\(.*?\)/g, '').trim() || null
}

async function sincronizarClientes() {
  console.log('[SYNC] Iniciando sincronização com o painel...')

  let sessionCookie
  try {
    sessionCookie = await loginPainel()
  } catch (err) {
    throw new Error(`Falha no login: ${err.message}`)
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest',
    Cookie: sessionCookie,
  }

  let pagina = 1
  let totalImportados = 0
  let totalAtualizados = 0

  while (true) {
    const res = await fetch(`${PANEL_URL}/api/lines/${pagina}`, { headers })
    const data = await res.json()

    if (!data.results || data.results.length === 0) break

    for (const linha of data.results) {
      const telefone = extrairTelefone(linha.message)
      const nome = extrairNome(linha.reseller_notes)

      // Converte "DD/MM/YYYY HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
      let expDate = null
      if (linha.exp_date) {
        const m = linha.exp_date.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2}:\d{2})?/)
        if (m) expDate = `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00:00'}`
      }

      if (!expDate) continue

      const renewLink = `${PANEL_URL.replace(/\/+$/, '')}/c/${linha.username}`

      const existente = db.prepare('SELECT id FROM clientes WHERE username = ?').get(linha.username)

      if (existente) {
        db.prepare(`
          UPDATE clientes SET nome = ?, telefone = COALESCE(?, telefone),
          exp_date = ?, renew_link = ?, painel_id = ?, status = 'ativo'
          WHERE username = ?
        `).run(nome, telefone, expDate, renewLink, String(linha.id), linha.username)
        totalAtualizados++
      } else {
        db.prepare(`
          INSERT INTO clientes (nome, telefone, username, senha, exp_date, renew_link, painel_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(nome, telefone, linha.username, null, expDate, renewLink, String(linha.id))
        totalImportados++
      }
    }

    if (pagina >= data.pages) break
    pagina++
  }

  console.log(`[SYNC] Concluído: ${totalImportados} importados, ${totalAtualizados} atualizados`)
  return { importados: totalImportados, atualizados: totalAtualizados }
}

module.exports = { sincronizarClientes }
