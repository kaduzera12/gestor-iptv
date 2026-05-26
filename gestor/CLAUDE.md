# Gestor IPTV — Contexto para o Claude

## O que é
Sistema de gestão de clientes IPTV com automação de cobranças via WhatsApp e fluxo de pagamento via Mercado Pago. Roda em VPS Oracle Cloud. Gerencia dois painéis IPTV distintos com lógicas de sync diferentes.

## Stack
- **Runtime:** Node.js + Express
- **Banco:** SQLite via `better-sqlite3` (arquivo `gestor.db` na raiz)
- **WhatsApp:** Evolution API (rodando na mesma VPS, porta 8080)
- **Pagamentos:** Mercado Pago (polling, sem webhook — não requer HTTPS)
- **Agendamento:** node-cron
- **Auth admin:** express-basic-auth (HTTP Basic)
- **Deploy:** PM2 na VPS Oracle (`129.148.33.67`, porta 3000)
- **Links públicos:** Vercel (`gestor-redirect.vercel.app`) para URLs clicáveis no WhatsApp

## Estrutura de arquivos
```
server.js            — Express: rotas públicas (/renovar/*), auth, rotas admin
db.js                — Banco SQLite, schema, migrations, defaults de config
cron.js              — Automação diária (09h), polling de pagamentos (a cada 2min)
whatsapp.js          — Envio de mensagens via Evolution API
sync.js              — Sync do painel painelr (scraping HTML + API)
sync-gesapi.js       — Sync do painel gesapi (REST API) — usado só via proxy/VPS
sync-gesapi-local.js — Sync gesapi rodando no PC local → envia dados pro VPS
renew-gesapi.js      — Renova cliente no painel gesapi via API
pagamento.js         — Cria preference MP, faz polling de pagamentos aprovados
public/              — Frontend admin (index.html, logs.html, config.html, promocao.html)
                       + páginas públicas (renovar.html, renovar-sucesso.html, renovar-falha.html)
```

## Banco de dados (SQLite)

### Tabela `clientes`
| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | INTEGER PK | — |
| nome | TEXT | Nome do cliente |
| telefone | TEXT | Número WhatsApp (formato 55XXXXXXXXXXX) |
| username | TEXT UNIQUE | Username no painel IPTV |
| senha | TEXT | Senha no painel |
| exp_date | TEXT | Vencimento (formato ISO: `YYYY-MM-DDTHH:MM:SS`) |
| renew_link | TEXT | Link de renovação enviado no WhatsApp |
| status | TEXT | `ativo` ou `inativo` |
| painel_id | TEXT | ID no painel de origem (necessário pra renovar no gesapi) |
| source | TEXT | `painelr` ou `gesapi` (default: `painelr`) |
| criado_em | TEXT | Timestamp de criação |

### Tabela `logs`
Registra cada mensagem enviada (tipo: `novo_cliente`, `3_dias`, `1_dia`, `vencimento`, `10_dias_vencido`, `promocao`).

### Tabela `configuracoes`
Chave-valor. Contém os templates de mensagem e flags de ativo/inativo por tipo:
- `template_novo_cliente`, `template_3_dias`, `template_1_dia`, `template_vencimento`, `template_10_dias_vencido`
- `ativo_novo_cliente`, `ativo_3_dias`, `ativo_1_dia`, `ativo_vencimento`, `ativo_10_dias_vencido`

### Tabela `pagamentos`
Rastreia pagamentos MP: `preference_id`, `payment_id`, `external_reference` (= `cliente.id`), `status` (`aguardando`/`aprovado`), `valor`.

## Dois painéis IPTV

### Painel painelr (`novaera.painelr.top`)
- Sync via **scraping HTML** (obtém CSRF, faz login com cookie, pagina em `/api/lines/{pagina}`)
- Roda na VPS todo dia às 09h e manualmente via botão no admin
- Renovação via link externo (`RENEW_URL/c/{username}`)
- `source = 'painelr'` no banco

### Painel gesapi (`searchdefense.top`)
- **URL do painel visual:** https://searchdefense.top/#/login
- **API backend real:** https://gesapioffice.com
- **⚠️ Header obrigatório em TODAS as chamadas:** `Origin: https://searchdefense.top`
- **⚠️ VPS Oracle e Cloudflare Workers são bloqueados pelo SingularCDN** — API só funciona do PC local

#### Endpoints da API gesapi
| Ação | Método | URL |
|------|--------|-----|
| Login | POST | `https://gesapioffice.com/api/login` |
| Listar clientes | GET | `https://gesapioffice.com/api/users-iptv?reg_password={crypt_pass}` |
| Renovar cliente | PUT | `https://gesapioffice.com/api/users-iptv/{painel_id}` |

- **Login body:** `{username, password, code: ""}` → retorna `access_token` e `crypt_pass`
- **Renovar body:** `{action: 1, credits: 1, reg_password: crypt_pass}`
- O `crypt_pass` vem do login e é obrigatório tanto pra listar quanto pra renovar

#### Sync gesapi (manual, PC local)
- Rodar: `node sync-gesapi-local.js`
- Roda automaticamente no logon do Windows (arquivo em `%AppData%\...\Startup\gestor-sync-gesapi.bat`)
- Busca clientes do gesapi, transforma, e envia pro VPS via `POST /api/import-gesapi` (basicAuth)
- `source = 'gesapi'` no banco

## Automação (cron.js)
- **09h diário:** sincroniza painelr → processa todos os clientes ativos → envia WhatsApp por dias até vencer
  - 3 dias antes → template `3_dias`
  - 1 dia antes → template `1_dia`
  - No dia → template `vencimento`
  - 10 dias vencido → template `10_dias_vencido`
- **A cada 2 minutos:** polling de pagamentos MP pendentes → se aprovado, notifica admin no WhatsApp
- Flag `automacaoRodando` impede execução paralela

## Fluxo de renovação gesapi (Mercado Pago)
1. Cliente recebe WhatsApp com link `https://gestor-redirect.vercel.app/renovar/{username}`
2. Vercel redireciona pro VPS (`http://129.148.33.67:3000/renovar/{username}`)
3. VPS cria preference no MP e redireciona pra `renovar.html` com nome, valor e link
4. Cliente paga → polling detecta em até 2 minutos
5. Admin recebe WhatsApp: *"💰 Pagamento recebido! Cliente: X / Lista: Y / Valor: R$ Z"*
6. Admin renova manualmente no painel `searchdefense.top`
7. Admin dispara confirmação pro cliente pelo botão WhatsApp no painel admin
8. Admin roda `node sync-gesapi-local.js` pra atualizar a data no DB

## Rotas do servidor

### Públicas (sem autenticação)
- `GET /renovar/:username` — cria preference MP, salva em `pagamentos`, redireciona pra `renovar.html`
- `GET /renovar/sucesso|falha|pendente` — páginas de retorno do MP

### Admin (Basic Auth)
- `GET /api/clientes` — lista clientes (suporta `?busca=` e `?status=`)
- `POST /api/clientes` — cria cliente (dispara WhatsApp se `ativo_novo_cliente=true`)
- `PUT /api/clientes/:id` — edita cliente
- `DELETE /api/clientes/:id` — remove cliente e seus logs
- `POST /api/sync` — dispara sync do painelr manualmente
- `POST /api/import-gesapi` — recebe array de clientes do script local e faz upsert
- `POST /api/clientes/:id/mensagem` — envia WhatsApp manual por tipo de template
- `GET /api/config` / `PUT /api/config` — lê e salva configurações/templates
- `GET /api/logs` — últimos 200 logs
- `POST /api/promocao` — disparo em massa com filtro (todos/ativos/vencidos)
- `POST /api/cron/rodar` — dispara automação manualmente

## Variáveis de ambiente (.env)
```
# Painel painelr
PANEL_URL=https://novaera.painelr.top
PANEL_USER=...
PANEL_PASS=...
RENEW_URL=https://novaera.appm.live

# Evolution API (WhatsApp)
EVOLUTION_URL=http://129.148.33.67:8080
EVOLUTION_KEY=...
EVOLUTION_INSTANCE=vago-principal

# Admin
PORT=3000
ADMIN_USER=...
ADMIN_PASS=...
ADMIN_WHATSAPP=5564999008457   ← número que recebe avisos de pagamento

# Painel gesapi (só usado no script local)
GESAPI_USER=eduardosilva77
GESAPI_PASS=eduardosilva77.

# Mercado Pago
MP_ACCESS_TOKEN=...
MP_PRECO=29.90

# URLs
GESTOR_URL=https://gestor-redirect.vercel.app   ← URL pública (Vercel) para renew_link
VPS_URL=http://129.148.33.67:3000               ← URL direta da VPS (usada pelo script local)
```

## Templates de mensagem
Variáveis disponíveis: `{nome}`, `{username}`, `{senha}`, `{exp_date}`, `{renew_link}`

Editáveis pelo painel admin em Configurações.

## Deploy
```bash
# Na VPS
cd ~/gestor-iptv/gestor
git pull
pm2 restart gestor-iptv --update-env

# Iniciar do zero
pm2 start server.js --name gestor-iptv
pm2 save
```
