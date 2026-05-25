require('dotenv').config()
const fetch = require('node-fetch')
const db = require('./db')

const { GESAPI_USER, GESAPI_PASS } = process.env
const BASE_URL = 'https://gesapioffice.com'

async function loginGesapi() {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: GESAPI_USER, password: GESAPI_PASS, code: '' }),
  })
  if (!res.ok) throw new Error(`Login falhou: ${res.status}`)
  const data = await res.json()
  return { token: data.access_token, cryptPass: data.crypt_pass }
}

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

async function sincronizarClientesGesapi() {
  console.log('[SYNC-GESAPI] Iniciando sincronização...')

  const { token, cryptPass } = await loginGesapi()

  const res = await fetch(`${BASE_URL}/api/users-iptv?reg_password=${encodeURIComponent(cryptPass)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Erro ao buscar clientes: ${res.status}`)
  const linhas = await res.json()

  let totalImportados = 0
  let totalAtualizados = 0
  let totalRemovidos = 0
  const usernamesAtivos = new Set()

  for (const linha of linhas) {
    const expDate = converterData(linha.exp_date)
    if (!expDate) continue
    if (linha.is_trial) continue

    const username = String(linha.username)
    const nome = extrairNome(linha.nota)
    const telefone = normalizarTelefone(linha.whatsapp)
    const gestorUrl = (process.env.GESTOR_URL || '').replace(/\/+$/, '')
    const renewLink = gestorUrl ? `${gestorUrl}/renovar/${username}` : null

    usernamesAtivos.add(username)

    const existente = db.prepare(`SELECT id FROM clientes WHERE username = ? AND source = 'gesapi'`).get(username)

    if (existente) {
      db.prepare(`
        UPDATE clientes SET nome = ?, telefone = COALESCE(?, telefone),
        exp_date = ?, renew_link = ?, painel_id = ?, status = 'ativo'
        WHERE username = ? AND source = 'gesapi'
      `).run(nome, telefone, expDate, renewLink, String(linha.id), username)
      totalAtualizados++
    } else {
      try {
        db.prepare(`
          INSERT INTO clientes (nome, telefone, username, senha, exp_date, renew_link, painel_id, source)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'gesapi')
        `).run(nome, telefone, username, linha.password, expDate, renewLink, String(linha.id))
        totalImportados++
      } catch {
        // username já existe em outro painel — ignora
      }
    }
  }

  // Remove clientes gesapi que foram excluídos do painel
  const todosLocais = db.prepare(`SELECT id, username FROM clientes WHERE source = 'gesapi'`).all()
  for (const { id, username } of todosLocais) {
    if (!usernamesAtivos.has(username)) {
      db.prepare(`DELETE FROM logs WHERE cliente_id = ?`).run(id)
      db.prepare(`DELETE FROM clientes WHERE id = ?`).run(id)
      totalRemovidos++
    }
  }

  console.log(`[SYNC-GESAPI] Concluído: ${totalImportados} importados, ${totalAtualizados} atualizados, ${totalRemovidos} removidos`)
  return { importados: totalImportados, atualizados: totalAtualizados, removidos: totalRemovidos }
}

module.exports = { sincronizarClientesGesapi }
