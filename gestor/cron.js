const cron = require('node-cron')
const db = require('./db')
const { enviarMensagem, aplicarTemplate } = require('./whatsapp')
const { sincronizarClientes } = require('./sync')
const { buscarPagamentoAprovado } = require('./pagamento')

let automacaoRodando = false

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
  if (automacaoRodando) {
    console.log('[CRON] Já está rodando, ignorando chamada duplicada')
    return
  }
  automacaoRodando = true
  try {
    console.log(`[CRON] Iniciando — ${new Date().toLocaleString('pt-BR')}`)

    console.log('[CRON] Sincronizando clientes com os painéis...')
    try {
      const { importados, atualizados } = await sincronizarClientes()
      console.log(`[CRON] Sync painelr: ${importados} novos, ${atualizados} atualizados`)
    } catch (err) {
      console.error(`[CRON] Falha no sync painelr: ${err.message}`)
    }

    const clientes = db.prepare(`SELECT * FROM clientes WHERE status = 'ativo'`).all()

    for (const cliente of clientes) {
      const dias = diasParaVencer(cliente.exp_date)

      if (dias === 3)   await processarCliente(cliente, '3_dias',            'template_3_dias',          'ativo_3_dias')
      if (dias === 1)   await processarCliente(cliente, '1_dia',             'template_1_dia',           'ativo_1_dia')
      if (dias === 0)   await processarCliente(cliente, 'vencimento',        'template_vencimento',      'ativo_vencimento')
      if (dias === -10) await processarCliente(cliente, '10_dias_vencido',   'template_10_dias_vencido', 'ativo_10_dias_vencido')
    }

    console.log(`[CRON] Verificação concluída`)
  } finally {
    automacaoRodando = false
  }
}

async function processarPagamentosPendentes() {
  const pendentes = db.prepare(`
    SELECT p.*, c.nome, c.telefone, c.username, c.painel_id, c.source
    FROM pagamentos p
    JOIN clientes c ON c.id = p.cliente_id
    WHERE p.status = 'aguardando'
    AND datetime(p.criado_em) > datetime('now', '-24 hours')
  `).all()

  for (const pag of pendentes) {
    try {
      const aprovado = await buscarPagamentoAprovado(pag.external_reference)
      if (!aprovado) continue

      db.prepare(`
        UPDATE pagamentos SET status = 'aprovado', payment_id = ?, processado_em = datetime('now')
        WHERE id = ?
      `).run(String(aprovado.id), pag.id)

      console.log(`[POLLING] Renovação concluída: ${pag.username}`)

      const valor = pag.valor ? ` de R$ ${pag.valor.toFixed(2).replace('.', ',')}` : ''

      const adminWpp = process.env.ADMIN_WHATSAPP
      if (adminWpp) {
        const msgAdmin = `💰 *Pagamento recebido!*\n\nCliente: *${pag.nome || pag.username}*\nLista: *${pag.username}*\nValor:${valor}\n\nRenove no painel e dispare a confirmação pelo gestor.`
        enviarMensagem(adminWpp, msgAdmin).catch(() => {})
      }
    } catch (err) {
      console.error(`[POLLING] Erro ao processar pagamento ${pag.id}:`, err.message)
    }
  }
}

function iniciarCron() {
  cron.schedule('0 9 * * *', rodarAutomacao, { timezone: 'America/Sao_Paulo' })
  console.log('[CRON] Agendado para 09:00 (horário de Brasília)')
}

function iniciarPollingPagamentos() {
  cron.schedule('*/2 * * * *', processarPagamentosPendentes)
  console.log('[POLLING] Verificação de pagamentos a cada 2 minutos iniciada')
}

module.exports = { iniciarCron, rodarAutomacao, iniciarPollingPagamentos }
