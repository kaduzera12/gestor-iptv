# FIXES PENDENTES — Gestor IPTV

> Como usar: cada fix tem um "Prompt para o agente" pronto para copiar.
> Abrir uma conversa nova por fix. Não misturar.

---

## CRONOGRAMA

### Semana 1 — Crítico / Alta prioridade
- **FIX-01** 🔴 Integração Mercado Pago com polling *(feature principal)*
- **FIX-02** 🟠 Guard contra execução paralela de automação/promoção *(pode mandar msg duplicada)*

### Semana 2 — Médio / Baixo
- **FIX-03** 🟡 Clientes `is_trial` do gesapi não devem receber automações
- **FIX-04** 🟠 `renew_link` do gesapi deve apontar pro gestor, não pro painel externo *(depende do FIX-01)*
- **FIX-05** 🟢 Dashboard sem botão de sync para o gesapi

> FIX-03 e FIX-05 podem rodar em paralelo (arquivos distintos).
> FIX-01 deve ser concluído antes de FIX-04.
> FIX-01 e FIX-02 NÃO podem rodar juntos (ambos tocam `server.js` e `cron.js`).

---

## Status

- [x] FIX-01 — Integração Mercado Pago com polling
- [x] FIX-02 — Guard contra execução paralela de automação/promoção
- [x] FIX-03 — Ignorar clientes `is_trial` do gesapi nas automações
- [x] FIX-04 — `renew_link` do gesapi apontando pro gestor próprio
- [x] FIX-05 — Botão de sync gesapi no dashboard

---

## FIX-01 — Integração Mercado Pago com polling

**Urgência:** 🔴 Crítico — feature principal acordada, ainda não existe  
**Diagnóstico:** Feature planejada — nenhum dos arquivos abaixo existe ainda

### Prompt para o agente

```
Projeto: C:\Users\Kadu_\Documents\JARVS\gestor
Leia este documento na seção FIX-01 antes de começar.

Arquivos a ler:
- db.js (schema atual e como adicionar tabelas)
- server.js (como adicionar rotas, padrão de auth)
- cron.js (como adicionar um segundo cron)
- sync-gesapi.js (para entender a função loginGesapi e como fazer renovação)
- .env.example (para entender as variáveis de ambiente)
- FIXES_PENDENTES.md seção FIX-01 (spec completa)

Implemente o FIX-01 conforme a spec abaixo. Ao concluir, marque [x] no status deste documento.
```

### Diagnóstico

O sistema tem integração com Mercado Pago planejada mas ainda não implementada. O fluxo acordado usa **polling** (sem webhook/HTTPS obrigatório):

1. Cliente recebe WhatsApp com link: `http://GESTOR_URL/renovar/{username}`
2. Gestor cria uma preference no MP → redireciona para checkout
3. Cliente paga no MP
4. MP redireciona para `GESTOR_URL/renovar/sucesso?collection_id=xxx`
5. Cron a cada 2 minutos verifica pagamentos pendentes via `GET /v1/payments/search?external_reference={cliente_id}&status=approved`
6. Quando aprovado → renova no painel gesapi via `PUT https://gesapioffice.com/api/users-iptv/{painel_id}` → manda WhatsApp de confirmação

A renovação no gesapi usa:
- Login: `POST https://gesapioffice.com/api/login` com `{username, password, code: ""}`
- Resposta: `{ access_token, crypt_pass }`
- Renovar: `PUT https://gesapioffice.com/api/users-iptv/{painel_id}` com body `{ action: 1, credits: 1, reg_password: crypt_pass }` e header `Authorization: Bearer {access_token}`

### Arquivos a ler antes de começar

- `db.js` — para entender como adicionar tabelas e a migração via `ALTER TABLE`
- `server.js` — padrão de rotas, basicAuth já configurado
- `cron.js` — como adicionar segundo cron com `node-cron`
- `sync-gesapi.js` — função `loginGesapi()` pode ser reutilizada
- `.env.example` — para adicionar as novas variáveis

### Testes PRÉ-implementação

- 🟥 `GET /renovar/qualquer-username` → 404 (rota não existe)
- 🟥 Tabela `pagamentos` não existe no banco
- 🟥 Arquivo `pagamento.js` não existe
- 🟥 Arquivo `renew-gesapi.js` não existe

### O que fazer

**Passo 1 — Variáveis de ambiente**

Adicionar ao `.env.example`:
```
# ─── Mercado Pago ─────────────────────────────────────────────────────────────
MP_ACCESS_TOKEN=APP_USR-seu-access-token-aqui
MP_PRECO=25.00
GESTOR_URL=http://SEU_IP_VPS:3000
```

Adicionar ao `.env` real com os valores do usuário.

**Passo 2 — Tabela `pagamentos` em `db.js`**

Adicionar após a migração da coluna `source`:

```javascript
db.exec(`
  CREATE TABLE IF NOT EXISTS pagamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER REFERENCES clientes(id),
    preference_id TEXT,
    payment_id TEXT,
    external_reference TEXT,
    status TEXT DEFAULT 'aguardando',
    valor REAL,
    criado_em TEXT DEFAULT (datetime('now')),
    processado_em TEXT
  )
`)
```

**Passo 3 — Criar `pagamento.js`**

```javascript
require('dotenv').config()
const fetch = require('node-fetch')

const { MP_ACCESS_TOKEN, MP_PRECO, GESTOR_URL } = process.env
const MP_BASE = 'https://api.mercadopago.com'

async function criarPreference(cliente) {
  const valor = parseFloat(MP_PRECO || '25')
  const res = await fetch(`${MP_BASE}/checkout/preferences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      items: [{
        title: `Renovação IPTV${cliente.nome ? ' — ' + cliente.nome : ''}`,
        quantity: 1,
        unit_price: valor,
        currency_id: 'BRL',
      }],
      external_reference: String(cliente.id),
      back_urls: {
        success: `${GESTOR_URL}/renovar/sucesso`,
        failure: `${GESTOR_URL}/renovar/falha`,
        pending: `${GESTOR_URL}/renovar/pendente`,
      },
      auto_return: 'approved',
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`MP criar preference erro ${res.status}: ${err}`)
  }
  return res.json()
}

async function buscarPagamentoAprovado(externalReference) {
  const res = await fetch(
    `${MP_BASE}/v1/payments/search?external_reference=${externalReference}&status=approved`,
    { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } }
  )
  if (!res.ok) throw new Error(`MP buscar pagamento erro ${res.status}`)
  const data = await res.json()
  return data.results?.[0] || null
}

async function consultarPagamento(paymentId) {
  const res = await fetch(`${MP_BASE}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  })
  if (!res.ok) throw new Error(`MP consultar pagamento erro ${res.status}`)
  return res.json()
}

module.exports = { criarPreference, buscarPagamentoAprovado, consultarPagamento }
```

**Passo 4 — Criar `renew-gesapi.js`**

```javascript
require('dotenv').config()
const fetch = require('node-fetch')

const { GESAPI_USER, GESAPI_PASS } = process.env
const BASE_URL = 'https://gesapioffice.com'

async function renovarClienteGesapi(painelId, credits = 1) {
  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: GESAPI_USER, password: GESAPI_PASS, code: '' }),
  })
  if (!loginRes.ok) throw new Error(`Login gesapi falhou: ${loginRes.status}`)
  const { access_token, crypt_pass } = await loginRes.json()

  const renovarRes = await fetch(`${BASE_URL}/api/users-iptv/${painelId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ action: 1, credits, reg_password: crypt_pass }),
  })
  if (!renovarRes.ok) {
    const err = await renovarRes.text()
    throw new Error(`Renovação gesapi falhou ${renovarRes.status}: ${err}`)
  }
  return renovarRes.json()
}

module.exports = { renovarClienteGesapi }
```

**Passo 5 — Criar `public/renovar.html`** (página de aguardo para o cliente)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Renovação IPTV</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1d2e; border: 1px solid #2d3148; border-radius: 16px; padding: 40px 32px; max-width: 420px; width: 90%; text-align: center; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #7c6aff; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.6; margin-bottom: 8px; }
    .valor { font-size: 36px; font-weight: 700; color: #22c55e; margin: 20px 0; }
    .btn { display: inline-block; margin-top: 24px; padding: 14px 32px; background: #7c6aff; color: #fff; border-radius: 10px; text-decoration: none; font-size: 16px; font-weight: 600; }
    .aviso { margin-top: 20px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Renovar IPTV</h1>
    <p id="nomeCliente"></p>
    <div class="valor" id="valorRenovacao"></div>
    <p>Clique abaixo para pagar com PIX ou cartão pelo Mercado Pago.</p>
    <a id="btnPagar" href="#" class="btn">Pagar agora</a>
    <p class="aviso">Após o pagamento, sua lista será renovada automaticamente em até 2 minutos.</p>
  </div>
  <script>
    const params = new URLSearchParams(window.location.search)
    const nome = params.get('nome')
    const valor = params.get('valor')
    const link = params.get('link')
    if (nome) document.getElementById('nomeCliente').textContent = 'Olá, ' + nome + '!'
    if (valor) document.getElementById('valorRenovacao').textContent = 'R$ ' + parseFloat(valor).toFixed(2).replace('.', ',')
    if (link) document.getElementById('btnPagar').href = link
    else window.location.href = '/'
  </script>
</body>
</html>
```

**Passo 6 — Criar `public/renovar-sucesso.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pagamento Recebido</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1d2e; border: 1px solid #14532d; border-radius: 16px; padding: 40px 32px; max-width: 420px; width: 90%; text-align: center; }
    .icone { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #22c55e; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icone">✅</div>
    <h1>Pagamento recebido!</h1>
    <p>Sua lista IPTV será renovada automaticamente em até 2 minutos.<br>Você receberá uma confirmação pelo WhatsApp.</p>
  </div>
</body>
</html>
```

**Passo 7 — Criar `public/renovar-falha.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Falha no Pagamento</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1d2e; border: 1px solid #450a0a; border-radius: 16px; padding: 40px 32px; max-width: 420px; width: 90%; text-align: center; }
    .icone { font-size: 56px; margin-bottom: 16px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #ef4444; }
    p { font-size: 15px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icone">❌</div>
    <h1>Pagamento não concluído</h1>
    <p>O pagamento não foi processado. Entre em contato com o suporte ou tente novamente.</p>
  </div>
</body>
</html>
```

**Passo 8 — Adicionar rotas em `server.js`**

Adicionar os imports no topo (após os imports existentes):
```javascript
const { criarPreference, buscarPagamentoAprovado } = require('./pagamento')
const { renovarClienteGesapi } = require('./renew-gesapi')
```

Adicionar as rotas antes do bloco `// ─── Start`:
```javascript
// ─── Renovação via Mercado Pago ────────────────────────────────────────────────

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
    const params = new URLSearchParams({
      nome: cliente.nome || '',
      valor,
      link: preference.init_point,
    })
    res.redirect(`/renovar.html?${params}`)
  } catch (err) {
    console.error('[RENOVAR]', err.message)
    res.status(500).send('Erro ao gerar link de pagamento. Tente novamente.')
  }
})

app.get('/renovar/sucesso', (req, res) => {
  const paymentId = req.query.payment_id || req.query.collection_id
  if (paymentId) {
    // Salva o payment_id no registro pendente mais recente sem payment_id
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
```

**Passo 9 — Adicionar cron de polling em `cron.js`**

Adicionar os imports no topo:
```javascript
const { buscarPagamentoAprovado } = require('./pagamento')
const { renovarClienteGesapi } = require('./renew-gesapi')
const { enviarMensagem } = require('./whatsapp')
```

Adicionar a função de polling e o cron no final, antes de `module.exports`:
```javascript
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

      // Renova no painel gesapi
      if (pag.source === 'gesapi' && pag.painel_id) {
        await renovarClienteGesapi(pag.painel_id)
        // Atualiza exp_date local — a próxima sync vai corrigir exato, mas atualiza estimado
        db.prepare(`
          UPDATE clientes SET exp_date = datetime(exp_date, '+30 days'), status = 'ativo'
          WHERE id = ?
        `).run(pag.cliente_id)
      }

      db.prepare(`
        UPDATE pagamentos SET status = 'aprovado', payment_id = ?, processado_em = datetime('now')
        WHERE id = ?
      `).run(String(aprovado.id), pag.id)

      console.log(`[POLLING] Renovação concluída: ${pag.username}`)

      // Envia WhatsApp de confirmação
      if (pag.telefone) {
        const valor = pag.valor ? `R$ ${pag.valor.toFixed(2).replace('.', ',')}` : ''
        const msg = `✅ *Renovação confirmada!*\n\nOlá ${pag.nome || pag.username}! Seu pagamento${valor ? ' de ' + valor : ''} foi aprovado e sua lista IPTV já foi renovada por mais 30 dias.\n\n_Obrigado!_`
        enviarMensagem(pag.telefone, msg).catch(err =>
          console.error(`[POLLING] Erro WhatsApp ${pag.username}:`, err.message)
        )
      }
    } catch (err) {
      console.error(`[POLLING] Erro ao processar pagamento ${pag.id}:`, err.message)
    }
  }
}

function iniciarPollingPagamentos() {
  cron.schedule('*/2 * * * *', processarPagamentosPendentes)
  console.log('[POLLING] Verificação de pagamentos a cada 2 minutos iniciada')
}
```

Atualizar o `module.exports` no final de `cron.js`:
```javascript
module.exports = { iniciarCron, rodarAutomacao, iniciarPollingPagamentos }
```

**Passo 10 — Iniciar o polling em `server.js`**

Atualizar o import de `cron.js` e chamar `iniciarPollingPagamentos()` no start:

```javascript
// Trocar a linha:
const { rodarAutomacao } = require('./cron')
const { iniciarCron } = require('./cron')
// Por:
const { rodarAutomacao, iniciarCron, iniciarPollingPagamentos } = require('./cron')
```

E no callback do `app.listen`, adicionar após `iniciarCron()`:
```javascript
iniciarPollingPagamentos()
```

### Testes PÓS-implementação

- 🟩 `GET /renovar/{username_gesapi_existente}` → redireciona para `renovar.html?nome=...&valor=...&link=https://www.mercadopago.com.br/checkout/...`
- 🟩 `GET /renovar/{username_inexistente}` → 404
- 🟩 `GET /renovar/sucesso?payment_id=123` → exibe página de sucesso
- 🟩 `GET /renovar/falha` → exibe página de falha
- 🟩 Tabela `pagamentos` existe no banco com colunas corretas
- 🟩 Servidor inicia sem erros com `node server.js`

### Critério de conclusão

Acessar `http://IP_VPS:3000/renovar/{username_gesapi}` exibe página com valor e botão de pagamento que redireciona ao Mercado Pago.

---

## FIX-02 — Guard contra execução paralela de automação/promoção

**Urgência:** 🟠 Alta  
**Diagnóstico:** Confirmado em 2026-05-25 — `cron.js` sem flag de lock; `server.js:178` disparo de promoção sem guard

### Prompt para o agente

```
Projeto: C:\Users\Kadu_\Documents\JARVS\gestor
Leia este documento na seção FIX-02 antes de começar.

Arquivos a ler:
- cron.js (função rodarAutomacao sem lock)
- server.js (endpoint /api/promocao sem guard contra duplo disparo)
- FIXES_PENDENTES.md seção FIX-02

Implemente o FIX-02 conforme a spec. Ao concluir, marque [x] no status deste documento.
```

### Diagnóstico

**Problema 1 — `rodarAutomacao` sem lock (`cron.js`)**

```javascript
// cron.js — não tem flag de execução
async function rodarAutomacao() {
  console.log(`[CRON] Iniciando...`)
  // ...loop longo sem proteção
}
```

Se o usuário clicar em "▶ Rodar Automação Agora" (`POST /api/cron/rodar`) enquanto o cron das 9h já está rodando, dois loops rodam em paralelo e enviam mensagens duplicadas para todos os clientes.

**Problema 2 — Disparo de promoção sem guard (`server.js:164-193`)**

```javascript
app.post('/api/promocao', async (req, res) => {
  // ...
  res.json({ ok: true, total: clientes.length })
  ;(async () => {
    for (const c of clientes) { /* envia mensagem */ }
  })()
})
```

Dois cliques no botão "Disparar" disparam dois loops simultâneos em background, enviando mensagens em duplicata para todos os clientes.

### Arquivos a ler antes de começar

- `cron.js` — adicionar flag `let automacaoRodando = false`
- `server.js` — adicionar flag `let promocaoRodando = false`

### Testes PRÉ-implementação

- 🟥 Chamar `POST /api/cron/rodar` duas vezes seguidas rápido → dois loops rodam (confirmar nos logs que aparece "[CRON] Iniciando" duas vezes)
- 🟥 Chamar `POST /api/promocao` duas vezes seguidas → dois disparos em background simultâneos

### O que fazer

**Passo 1 — Lock em `cron.js`**

Adicionar flag no topo do arquivo (após os requires):
```javascript
let automacaoRodando = false
```

Modificar `rodarAutomacao`:
```javascript
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
    try {
      const { importados, atualizados } = await sincronizarClientesGesapi()
      console.log(`[CRON] Sync gesapi: ${importados} novos, ${atualizados} atualizados`)
    } catch (err) {
      console.error(`[CRON] Falha no sync gesapi: ${err.message} — disparos continuam com dados atuais`)
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
```

**Passo 2 — Lock e rate limit em `server.js`**

Adicionar flag no topo (após os requires):
```javascript
let promocaoRodando = false
```

Modificar o endpoint `/api/promocao`:
```javascript
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
```

**Passo 3 — Feedback no frontend (`public/promocao.html`)**

Localizar o trecho que exibe resultado após disparo e adicionar tratamento para o erro 429:

```javascript
// Substituir o bloco dentro de disparar() após a chamada fetch:
const data = await res.json()

btn.disabled = false
btn.textContent = 'Disparar mensagem'

if (data.ok) {
  const el = document.getElementById('resultado')
  el.className = 'ok'
  el.style.display = 'block'
  el.textContent = `✓ Disparo iniciado para ${data.total} cliente${data.total !== 1 ? 's' : ''}. As mensagens serão enviadas em sequência — acompanhe pelos Logs.`
} else {
  const el = document.getElementById('resultado')
  el.className = 'erro'
  el.style.display = 'block'
  el.textContent = data.erro || 'Erro ao disparar'
}
```

### Testes PÓS-implementação

- 🟩 Chamar `POST /api/cron/rodar` duas vezes seguidas → segundo retorna 200 mas logs mostram "Já está rodando, ignorando"
- 🟩 Chamar `POST /api/promocao` enquanto disparo está ativo → retorna 429 com mensagem clara
- 🟩 Disparo normal de promoção continua funcionando

### Critério de conclusão

Dois cliques no botão "Disparar" exibem mensagem de erro no segundo clique. Duplo `POST /api/cron/rodar` não dispara dois loops simultâneos.

---

## FIX-03 — Ignorar clientes `is_trial` do gesapi nas automações

**Urgência:** 🟡 Médio  
**Diagnóstico:** Confirmado em 2026-05-25 — `sync-gesapi.js:84` não usa o campo `is_trial` da API

### Prompt para o agente

```
Projeto: C:\Users\Kadu_\Documents\JARVS\gestor
Leia este documento na seção FIX-03 antes de começar.

Arquivos a ler:
- sync-gesapi.js (onde clientes são importados sem checar is_trial)
- FIXES_PENDENTES.md seção FIX-03

Implemente o FIX-03. Ao concluir, marque [x] no status deste documento.
```

### Diagnóstico

A API do gesapi retorna `is_trial: 1` e `status: "Teste"` para contas de teste. O `sync-gesapi.js` ignora esses campos e importa todos os clientes com `status = 'ativo'`, fazendo com que contas de teste recebam mensagens automáticas de vencimento.

Evidência em `sync-gesapi.js`:
```javascript
// linha 58 — loop sem verificar is_trial
for (const linha of linhas) {
  const expDate = converterData(linha.exp_date)
  if (!expDate) continue
  // ... não verifica linha.is_trial
```

### Arquivos a ler antes de começar

- `sync-gesapi.js` — loop de importação, linhas 58-89

### Testes PRÉ-implementação

- 🟥 Após sync, clientes com `is_trial: 1` aparecem na tabela com `status = 'ativo'` e seriam processados pelo cron

### O que fazer

Em `sync-gesapi.js`, no loop de importação, pular clientes `is_trial` e usar o status real da API:

```javascript
for (const linha of linhas) {
  const expDate = converterData(linha.exp_date)
  if (!expDate) continue
  if (linha.is_trial) continue  // ignora contas de teste

  const username = String(linha.username)
  const nome = extrairNome(linha.nota)
  const telefone = normalizarTelefone(linha.whatsapp)
  const renewBase = (GESAPI_RENEW_URL || '').replace(/\/+$/, '')
  const renewLink = renewBase ? `${renewBase}/#/recharge/${username}` : null

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
```

### Testes PÓS-implementação

- 🟩 Após sync, clientes com `is_trial: 1` não aparecem na tabela
- 🟩 Clientes normais (`is_trial: 0`) continuam sendo importados normalmente

### Critério de conclusão

Nenhum cliente com `is_trial: 1` aparece na tabela `clientes` após uma sincronização do gesapi.

---

## FIX-04 — `renew_link` do gesapi apontando pro gestor próprio

**Urgência:** 🟠 Alta — depende do FIX-01 estar concluído  
**Diagnóstico:** Confirmado em 2026-05-25 — `sync-gesapi.js:66` usa URL do painel externo

### Prompt para o agente

```
Projeto: C:\Users\Kadu_\Documents\JARVS\gestor
Leia este documento na seção FIX-04 antes de começar.
ATENÇÃO: este fix só deve ser executado após o FIX-01 estar concluído e o GESTOR_URL configurado no .env.

Arquivos a ler:
- sync-gesapi.js (linha 65-66, geração do renewLink)
- .env.example (verificar se GESTOR_URL existe)
- FIXES_PENDENTES.md seção FIX-04

Implemente o FIX-04. Ao concluir, marque [x] no status deste documento.
```

### Diagnóstico

Em `sync-gesapi.js:65-66`:
```javascript
const renewBase = (GESAPI_RENEW_URL || '').replace(/\/+$/, '')
const renewLink = renewBase ? `${renewBase}/#/recharge/${username}` : null
```

Este link aponta para o painel externo (`searchdefense.top`), que exige a secret key do Mercado Pago do usuário para funcionar. Após o FIX-01, o `renew_link` deve apontar para o gestor próprio.

### O que fazer

Em `sync-gesapi.js`, substituir a geração do `renewLink`:

```javascript
// Substituir:
const renewBase = (GESAPI_RENEW_URL || '').replace(/\/+$/, '')
const renewLink = renewBase ? `${renewBase}/#/recharge/${username}` : null

// Por:
const gestorUrl = (process.env.GESTOR_URL || '').replace(/\/+$/, '')
const renewLink = gestorUrl ? `${gestorUrl}/renovar/${username}` : null
```

Remover a variável `GESAPI_RENEW_URL` do `.env.example` (não é mais necessária).

### Testes PÓS-implementação

- 🟩 Após sync, `renew_link` dos clientes gesapi aponta para `http://IP_VPS:3000/renovar/{username}`
- 🟩 Clicar no link leva à página de pagamento do gestor

### Critério de conclusão

`SELECT renew_link FROM clientes WHERE source = 'gesapi' LIMIT 1` retorna URL contendo `/renovar/`.

---

## FIX-05 — Botão de sync gesapi no dashboard

**Urgência:** 🟢 Baixo  
**Diagnóstico:** Confirmado em 2026-05-25 — `public/index.html:324` só chama `/api/sync` (painelr)

### Prompt para o agente

```
Projeto: C:\Users\Kadu_\Documents\JARVS\gestor
Leia este documento na seção FIX-05 antes de começar.

Arquivos a ler:
- public/index.html (função sincronizar() linha ~319, botão linha 87)
- server.js (verificar que /api/sync-gesapi existe)
- FIXES_PENDENTES.md seção FIX-05

Implemente o FIX-05. Ao concluir, marque [x] no status deste documento.
```

### Diagnóstico

`public/index.html:87` tem apenas um botão de sync que chama `/api/sync` (painelr):
```html
<button class="btn btn-cinza" onclick="sincronizar()" id="btnSync">↻ Sincronizar Painel</button>
```

A função `sincronizar()` em `index.html:319` também só chama `/api/sync`. Não existe botão nem função para sincronizar o gesapi (`/api/sync-gesapi`).

### O que fazer

**Passo 1** — Em `public/index.html`, substituir o botão de sync único por dois botões:

```html
<!-- Substituir: -->
<button class="btn btn-cinza" onclick="sincronizar()" id="btnSync">↻ Sincronizar Painel</button>

<!-- Por: -->
<button class="btn btn-cinza" onclick="sincronizar('painelr')" id="btnSync">↻ Sync Painelr</button>
<button class="btn btn-cinza" onclick="sincronizar('gesapi')" id="btnSyncGesapi">↻ Sync Gesapi</button>
```

**Passo 2** — Atualizar a função `sincronizar()` no script:

```javascript
async function sincronizar(painel = 'painelr') {
  const isGesapi = painel === 'gesapi'
  const btnId = isGesapi ? 'btnSyncGesapi' : 'btnSync'
  const endpoint = isGesapi ? '/api/sync-gesapi' : '/api/sync'
  const label = isGesapi ? '↻ Sync Gesapi' : '↻ Sync Painelr'

  const btn = document.getElementById(btnId)
  btn.textContent = '↻ Sincronizando...'
  btn.disabled = true
  try {
    const res = await fetch(endpoint, { method: 'POST' })
    const data = await res.json()
    if (data.ok) {
      toast(`Sync: ${data.importados} importados, ${data.atualizados} atualizados`, 'ok')
      carregarClientes()
    } else toast(data.erro || 'Erro no sync', 'erro')
  } catch { toast('Erro de conexão', 'erro') }
  btn.textContent = label
  btn.disabled = false
}
```

### Testes PÓS-implementação

- 🟩 Dashboard exibe dois botões: "↻ Sync Painelr" e "↻ Sync Gesapi"
- 🟩 Clicar em "Sync Gesapi" chama `/api/sync-gesapi` e exibe toast com resultado
- 🟩 Clicar em "Sync Painelr" continua chamando `/api/sync`

### Critério de conclusão

Dois botões de sync visíveis no dashboard, cada um sincronizando seu respectivo painel.

---

## Guia de Execução Paralela

| Combinação | Seguro? | Motivo |
|---|---|---|
| FIX-03 + FIX-05 | ✅ Sim | Arquivos completamente distintos |
| FIX-01 + FIX-03 | ✅ Sim | FIX-01 não toca `sync-gesapi.js` |
| FIX-01 + FIX-05 | ✅ Sim | FIX-05 toca só `index.html` |
| FIX-01 + FIX-02 | ❌ Não | Ambos tocam `server.js` e `cron.js` |
| FIX-02 + FIX-05 | ✅ Sim | Arquivos distintos |
| FIX-04 antes FIX-01 | ❌ Não | FIX-04 depende de `GESTOR_URL` e rota `/renovar/:username` do FIX-01 |

**Ordem recomendada:**
1. FIX-01 (sozinho — maior e mais crítico)
2. FIX-02 (sozinho — toca mesmos arquivos do FIX-01)
3. FIX-03 + FIX-04 + FIX-05 em paralelo (arquivos distintos, FIX-01 já concluído)
