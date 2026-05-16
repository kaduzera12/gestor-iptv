const cron = require('node-cron')
const db = require('./db')
const { enviarMensagem, aplicarTemplate } = require('./whatsapp')

function getConfig(chave) {
  const row = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave)
  return row ? row.valor : null
}

function isAtivo(chave) {
  return getConfig(chave) === 'true'
}

function diasParaVencer(expDate) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  const venc = new Date(expDate)
  venc.setHours(0, 0, 0, 0)
  return Math.round((venc - hoje) / (1000 * 60 * 60 * 24))
}

function jaEnviouHoje(clienteId, tipo) {
  const hoje = new Date().toISOString().slice(0, 10)
  const row = db.prepare(`
    SELECT id FROM logs
    WHERE cliente_id = ? AND tipo = ? AND DATE(enviado_em) = ?
  `).get(clienteId, tipo, hoje)
  return !!row
}

async function processarCliente(cliente, tipo, templateKey, ativoKey) {
  if (!isAtivo(ativoKey)) return
  if (jaEnviouHoje(cliente.id, tipo)) return

  const template = getConfig(templateKey)
  if (!template || !cliente.telefone || !cliente.nome) return

  const texto = aplicarTemplate(template, cliente)

  try {
    await enviarMensagem(cliente.telefone, texto)
    db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, ?, 'enviado')`).run(cliente.id, tipo)
    console.log(`[CRON] ${tipo} → ${cliente.username} (${cliente.telefone})`)
  } catch (err) {
    db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, ?, 'erro')`).run(cliente.id, tipo)
    console.error(`[CRON] ERRO ${tipo} → ${cliente.username}: ${err.message}`)
  }
}

async function rodarAutomacao() {
  console.log(`[CRON] Iniciando verificação — ${new Date().toLocaleString('pt-BR')}`)

  const clientes = db.prepare(`SELECT * FROM clientes WHERE status = 'ativo'`).all()

  for (const cliente of clientes) {
    const dias = diasParaVencer(cliente.exp_date)

    if (dias === 3)   await processarCliente(cliente, '3_dias',            'template_3_dias',          'ativo_3_dias')
    if (dias === 1)   await processarCliente(cliente, '1_dia',             'template_1_dia',           'ativo_1_dia')
    if (dias === 0)   await processarCliente(cliente, 'vencimento',        'template_vencimento',      'ativo_vencimento')
    if (dias === -10) await processarCliente(cliente, '10_dias_vencido',   'template_10_dias_vencido', 'ativo_10_dias_vencido')
  }

  console.log(`[CRON] Verificação concluída`)
}

function iniciarCron() {
  cron.schedule('0 9 * * *', rodarAutomacao, { timezone: 'America/Sao_Paulo' })
  console.log('[CRON] Agendado para 09:00 (horário de Brasília)')
}

module.exports = { iniciarCron, rodarAutomacao }
