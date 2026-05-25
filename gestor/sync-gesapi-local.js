require('dotenv').config()
const fetch = require('node-fetch')

const { GESAPI_USER, GESAPI_PASS, GESTOR_URL, VPS_URL, ADMIN_USER, ADMIN_PASS } = process.env
const GESAPI_BASE = 'https://gesapioffice.com'

function extrairNome(nota) {
  if (!nota) return null
  const trimmed = nota.trim()
  if (trimmed.toLowerCase() === 'teste') return null
  const obsMatch = trimmed.match(/Obs:\s*(.+)$/i)
  if (obsMatch) return obsMatch[1].trim() || null
  return trimmed || null
}

function normalizarTelefone(whatsapp) {
  if (!whatsapp || whatsapp === '0') return null
  let num = whatsapp.replace(/\D/g, '')
  if (!num.startsWith('55')) num = '55' + num
  return num.length >= 12 ? num : null
}

function converterData(expDate) {
  if (!expDate) return null
  const m = expDate.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2}:\d{2})?/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00:00:00'}`
}

async function main() {
  console.log('[SYNC-LOCAL] Fazendo login no gesapi...')

  const loginRes = await fetch(`${GESAPI_BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://searchdefense.top', Referer: 'https://searchdefense.top/' },
    body: JSON.stringify({ username: GESAPI_USER, password: GESAPI_PASS, code: '' }),
  })
  if (!loginRes.ok) throw new Error(`Login falhou: ${loginRes.status}`)
  const { access_token, crypt_pass } = await loginRes.json()
  console.log('[SYNC-LOCAL] Login OK. Buscando clientes...')

  const usersRes = await fetch(`${GESAPI_BASE}/api/users-iptv?reg_password=${encodeURIComponent(crypt_pass)}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}`, Origin: 'https://searchdefense.top', Referer: 'https://searchdefense.top/' },
  })
  if (!usersRes.ok) throw new Error(`Erro ao buscar clientes: ${usersRes.status}`)
  const linhas = await usersRes.json()
  console.log(`[SYNC-LOCAL] ${linhas.length} registros recebidos. Transformando...`)

  const gestorUrl = (GESTOR_URL || '').replace(/\/+$/, '')
  const vpsUrl = (VPS_URL || gestorUrl).replace(/\/+$/, '')
  const clientes = []

  for (const linha of linhas) {
    const expDate = converterData(linha.exp_date)
    if (!expDate) continue
    if (linha.is_trial) continue

    const username = String(linha.username)
    clientes.push({
      username,
      nome: extrairNome(linha.nota),
      telefone: normalizarTelefone(linha.whatsapp),
      senha: linha.password,
      exp_date: expDate,
      renew_link: gestorUrl ? `${gestorUrl}/renovar/${username}` : null,
      painel_id: String(linha.id),
    })
  }

  console.log(`[SYNC-LOCAL] ${clientes.length} clientes válidos. Enviando pro VPS...`)

  const basicAuth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64')
  const importRes = await fetch(`${vpsUrl}/api/import-gesapi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basicAuth}` },
    body: JSON.stringify({ clientes }),
  })
  if (!importRes.ok) {
    const txt = await importRes.text()
    throw new Error(`Erro no import: ${importRes.status} — ${txt}`)
  }
  const result = await importRes.json()
  console.log(`[SYNC-LOCAL] Concluído: ${result.importados} importados, ${result.atualizados} atualizados, ${result.removidos} removidos`)
}

main().catch(err => { console.error('[SYNC-LOCAL] ERRO:', err.message); process.exit(1) })
