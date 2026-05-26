# Gestor IPTV — Contexto para o Claude

## O que é
Sistema de gestão de clientes IPTV com automação de WhatsApp. Gerencia dois painéis:
- **painelr** (`novaera.painelr.top`) — sync automático pela VPS
- **gesapi** (`searchdefense.top`) — sync manual pelo PC local (VPS bloqueada pelo SingularCDN)

## Stack
- Node.js + Express + SQLite (better-sqlite3)
- Evolution API para WhatsApp
- Mercado Pago para pagamentos (polling, sem webhook)
- PM2 na VPS Oracle (`129.148.33.67`)
- Vercel para links públicos de renovação (`gestor-redirect.vercel.app`)

## Arquitetura dos painéis

### Painel painelr
- Sync via `sync.js` — roda na VPS todo dia às 09h e manualmente pelo botão no admin
- Renovação via link externo (`RENEW_URL`)

### Painel gesapi (searchdefense.top)
- **URL do painel visual:** https://searchdefense.top/#/login
- **API backend real:** https://gesapioffice.com
- **⚠️ Header obrigatório em TODAS as chamadas:** `Origin: https://searchdefense.top`
- **Credenciais:** usuário `eduardosilva77`, senha `eduardosilva77.`
- **⚠️ VPS e Cloudflare Workers são bloqueados pelo SingularCDN** — API só funciona do PC local

#### Endpoints da API gesapi
| Ação | Método | URL |
|------|--------|-----|
| Login | POST | `https://gesapioffice.com/api/login` |
| Listar clientes | GET | `https://gesapioffice.com/api/users-iptv?reg_password={crypt_pass}` |
| Renovar cliente | PUT | `https://gesapioffice.com/api/users-iptv/{painel_id}` |

- **Login body:** `{username, password, code: ""}` → retorna `access_token` e `crypt_pass`
- **Renovar body:** `{action: 1, credits: 1, reg_password: crypt_pass}`
- O `crypt_pass` vem do login e é necessário tanto pra listar quanto pra renovar

#### Sync gesapi
- Rodar manualmente: `node sync-gesapi-local.js` (na raiz do projeto)
- Roda automaticamente no logon do Windows (startup folder)
- Envia os clientes transformados pro VPS via `POST /api/import-gesapi` (basicAuth)

## Fluxo de renovação gesapi
1. Cliente recebe WhatsApp com link `https://gestor-redirect.vercel.app/renovar/{username}`
2. Vercel redireciona pro VPS (`http://129.148.33.67:3000/renovar/{username}`)
3. VPS cria preferência no Mercado Pago e redireciona pra página de pagamento
4. Cliente paga → polling da VPS detecta em até 2 minutos
5. Admin recebe WhatsApp: nome do cliente, username da lista, valor
6. Admin renova manualmente no painel `searchdefense.top`
7. Admin dispara confirmação pro cliente pelo botão WhatsApp no painel admin
8. Admin roda `node sync-gesapi-local.js` pra atualizar a data no DB

## Variáveis de ambiente relevantes (.env)
- `GESAPI_USER` / `GESAPI_PASS` — credenciais do painel gesapi
- `GESTOR_URL` — URL pública (Vercel) usada nos `renew_link` dos clientes
- `VPS_URL` — URL direta da VPS usada pelo script local pra chamar a API
- `ADMIN_WHATSAPP` — número do admin pra receber avisos de pagamento
- `MP_ACCESS_TOKEN` / `MP_PRECO` — Mercado Pago
