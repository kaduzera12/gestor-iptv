require('dotenv').config()
const express = require('express')
const basicAuth = require('express-basic-auth')
const path = require('path')
const db = require('./db')
const { sincronizarClientes } = require('./sync')
const { rodarAutomacao, iniciarCron, iniciarPollingPagamentos } = require('./cron')
const { enviarMensagem, aplicarTemplate } = require('./whatsapp')
const { criarPreference } = require('./pagamento')

let promocaoRodando = false

const app = express()

// ─── Rotas públicas (sem autenticação — acesso do cliente final) ───────────────

app.get('/renovar/sucesso', (req, res) => {
  const paymentId = req.query.payment_id || req.query.collection_id
  if (paymentId) {
    const pendente = db.prepare(`
      SELECT id FROM pagamentos WHERE payment_id IS NULL AND status = 'aguardando'
      ORDER BY criado_em DESC LIMIT 1
    `).get()
    if (pendente) {
      db.prepare(`UPDATE pagamentos SET payment_id = ? WHERE id = ?`).run(String(paymentId), pendente.id)
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'renovar-sucesso.html'))
})

app.get('/renovar/falha', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'renovar-falha.html'))
})

app.get('/renovar/pendente', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'renovar-sucesso.html'))
})

app.get('/renovar/:username', async (req, res) => {
  const cliente = db.prepare(`SELECT * FROM clientes WHERE username = ? AND source = 'gesapi'`).get(req.params.username)
  if (!cliente) return res.status(404).send('Cliente não encontrado')
  if (!cliente.nome || !cliente.telefone) return res.status(400).send('Cliente sem dados para renovação')

  try {
    const preference = await criarPreference(cliente)
    db.prepare(`
      INSERT INTO pagamentos (cliente_id, preference_id, external_reference, valor, status)
      VALUES (?, ?, ?, ?, 'aguardando')
    `).run(cliente.id, preference.id, String(cliente.id), parseFloat(process.env.MP_PRECO || '25'))

    const valor = parseFloat(process.env.MP_PRECO || '25').toFixed(2).replace('.', ',')
    const params = new URLSearchParams({ nome: cliente.nome, valor, link: preference.init_point })
    res.redirect(`/renovar.html?${params}`)
  } catch (err) {
    console.error('[RENOVAR]', err.message)
    res.status(500).send('Erro ao gerar link de pagamento. Tente novamente.')
  }
})

// ─── Auth e estáticos (admin) ──────────────────────────────────────────────────

app.use(basicAuth({
  users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASS },
  challenge: true,
  realm: 'Gestor IPTV',
}))

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── Clientes ──────────────────────────────────────────────────────────────────

app.get('/api/clientes', (req, res) => {
  const { busca, status } = req.query
  let sql = 'SELECT * FROM clientes WHERE 1=1'
  const params = []

  if (busca) {
    sql += ' AND (nome LIKE ? OR username LIKE ? OR telefone LIKE ?)'
    params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`)
  }
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }

  sql += ' ORDER BY exp_date ASC'
  res.json(db.prepare(sql).all(...params))
})

app.post('/api/clientes', (req, res) => {
  const { nome, telefone, username, senha, exp_date, renew_link } = req.body
  if (!username || !exp_date) {
    return res.status(400).json({ erro: 'username e exp_date são obrigatórios' })
  }
  try {
    db.prepare(`
      INSERT INTO clientes (nome, telefone, username, senha, exp_date, renew_link)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(nome, telefone, username, senha, exp_date, renew_link)

    const ativoNovo = db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'ativo_novo_cliente'`).get()
    if (ativoNovo?.valor === 'true') {
      const cliente = db.prepare('SELECT * FROM clientes WHERE username = ?').get(username)
      const template = db.prepare(`SELECT valor FROM configuracoes WHERE chave = 'template_novo_cliente'`).get()
      if (cliente && template) {
        const texto = aplicarTemplate(template.valor, cliente)
        enviarMensagem(cliente.telefone, texto)
          .then(() => db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, 'novo_cliente', 'enviado')`).run(cliente.id))
          .catch(() => db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, 'novo_cliente', 'erro')`).run(cliente.id))
      }
    }

    res.json({ ok: true })
  } catch (err) {
    res.status(409).json({ erro: 'Username já existe' })
  }
})

app.put('/api/clientes/:id', (req, res) => {
  const { nome, telefone, username, senha, exp_date, renew_link, status } = req.body
  db.prepare(`
    UPDATE clientes SET nome=?, telefone=?, username=?, senha=?, exp_date=?, renew_link=?, status=?
    WHERE id=?
  `).run(nome, telefone, username, senha, exp_date, renew_link, status, req.params.id)
  res.json({ ok: true })
})

app.delete('/api/clientes/:id', (req, res) => {
  db.prepare('DELETE FROM logs WHERE cliente_id = ?').run(req.params.id)
  db.prepare('DELETE FROM clientes WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ─── Sincronização ─────────────────────────────────────────────────────────────

app.post('/api/sync', async (req, res) => {
  try {
    const resultado = await sincronizarClientes()
    res.json({ ok: true, ...resultado })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

// ─── Envio manual de mensagem ──────────────────────────────────────────────────

app.post('/api/clientes/:id/mensagem', async (req, res) => {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id)
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado' })

  const { tipo } = req.body
  const templateKey = {
    novo_cliente:     'template_novo_cliente',
    '3_dias':         'template_3_dias',
    '1_dia':          'template_1_dia',
    vencimento:       'template_vencimento',
    '10_dias_vencido':'template_10_dias_vencido',
  }[tipo]

  if (!templateKey) return res.status(400).json({ erro: 'Tipo inválido' })

  const template = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(templateKey)
  if (!template) return res.status(404).json({ erro: 'Template não encontrado' })

  const texto = aplicarTemplate(template.valor, cliente)

  try {
    await enviarMensagem(cliente.telefone, texto)
    db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, ?, 'enviado')`).run(cliente.id, tipo)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

// ─── Configurações / Templates ─────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT chave, valor FROM configuracoes').all()
  const config = Object.fromEntries(rows.map(r => [r.chave, r.valor]))
  res.json(config)
})

app.put('/api/config', (req, res) => {
  const permitidas = [
    'template_novo_cliente', 'template_3_dias', 'template_1_dia', 'template_vencimento', 'template_10_dias_vencido',
    'ativo_novo_cliente', 'ativo_3_dias', 'ativo_1_dia', 'ativo_vencimento', 'ativo_10_dias_vencido',
  ]
  for (const [chave, valor] of Object.entries(req.body)) {
    if (permitidas.includes(chave)) {
      db.prepare('INSERT OR REPLACE INTO configuracoes (chave, valor) VALUES (?, ?)').run(chave, valor)
    }
  }
  res.json({ ok: true })
})

// ─── Logs ──────────────────────────────────────────────────────────────────────

app.get('/api/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT l.*, c.nome, c.username, c.telefone
    FROM logs l
    LEFT JOIN clientes c ON c.id = l.cliente_id
    ORDER BY l.enviado_em DESC
    LIMIT 200
  `).all()
  res.json(logs)
})

// ─── Disparo de promoção ───────────────────────────────────────────────────────

app.post('/api/promocao', async (req, res) => {
  const { mensagem, filtro } = req.body
  if (!mensagem || !filtro) return res.status(400).json({ erro: 'mensagem e filtro são obrigatórios' })
  if (promocaoRodando) return res.status(429).json({ erro: 'Já existe um disparo em andamento. Aguarde concluir.' })

  const hoje = new Date().toISOString().slice(0, 10)
  let sql = `SELECT * FROM clientes WHERE nome IS NOT NULL AND telefone IS NOT NULL`
  if (filtro === 'ativos')   sql += ` AND date(exp_date) >= '${hoje}'`
  if (filtro === 'vencidos') sql += ` AND date(exp_date) < '${hoje}'`

  const clientes = db.prepare(sql).all()

  res.json({ ok: true, total: clientes.length })

  promocaoRodando = true
  ;(async () => {
    try {
      for (const c of clientes) {
        const texto = mensagem
          .replace(/{nome}/g, c.nome || '')
          .replace(/{username}/g, c.username || '')
          .replace(/{renew_link}/g, c.renew_link || '')
        try {
          await enviarMensagem(c.telefone, texto)
          db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, 'promocao', 'enviado')`).run(c.id)
        } catch {
          db.prepare(`INSERT INTO logs (cliente_id, tipo, status) VALUES (?, 'promocao', 'erro')`).run(c.id)
        }
        await new Promise(r => setTimeout(r, 1500))
      }
    } finally {
      promocaoRodando = false
    }
  })()
})

// ─── Disparo manual do cron ────────────────────────────────────────────────────

app.post('/api/cron/rodar', async (req, res) => {
  try {
    await rodarAutomacao()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ erro: err.message })
  }
})

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Gestor IPTV rodando em http://localhost:${PORT}`)
  iniciarCron()
  iniciarPollingPagamentos()
})
