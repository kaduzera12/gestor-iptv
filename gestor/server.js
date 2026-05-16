require('dotenv').config()
const express = require('express')
const path = require('path')
const db = require('./db')
const { sincronizarClientes } = require('./sync')
const { rodarAutomacao } = require('./cron')
const { iniciarCron } = require('./cron')
const { enviarMensagem, aplicarTemplate } = require('./whatsapp')

const app = express()
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
  if (!username || !telefone || !exp_date) {
    return res.status(400).json({ erro: 'username, telefone e exp_date são obrigatórios' })
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
    novo_cliente: 'template_novo_cliente',
    '3_dias': 'template_3_dias',
    '1_dia': 'template_1_dia',
    vencimento: 'template_vencimento',
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
    'template_novo_cliente', 'template_3_dias', 'template_1_dia', 'template_vencimento',
    'ativo_novo_cliente', 'ativo_3_dias', 'ativo_1_dia', 'ativo_vencimento',
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
})
