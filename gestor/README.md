# 📺 Gestor IPTV

Gestor de clientes IPTV com automação de cobranças via WhatsApp.

Substitui a automação paga de painéis como o `painelr.top` — roda na sua própria VPS, sem mensalidade.

## O que faz

- Importa seus clientes do painel IPTV automaticamente
- Envia dados de acesso quando o cliente é cadastrado (opcional)
- Envia aviso 3 dias antes do vencimento (opcional)
- Envia aviso 1 dia antes do vencimento (opcional)
- Envia aviso no dia do vencimento (opcional)
- Cada automação pode ser ativada ou desativada individualmente pelo painel
- Templates de mensagem editáveis pelo painel
- Histórico de todas as mensagens enviadas

## Requisitos

- Node.js 18+
- Uma VPS (recomendado) ou servidor sempre ligado
- [Evolution API](https://github.com/EvolutionAPI/evolution-api) instalada e configurada
- Conta no painel `painelr.top` (ou compatível)

## Instalação

```bash
git clone https://github.com/seu-usuario/gestor-iptv
cd gestor-iptv
npm install
cp .env.example .env
```

Edite o `.env` com suas credenciais:

```env
PANEL_URL=https://seu-painel.painelr.top
PANEL_USER=seu_usuario
PANEL_PASS=sua_senha

EVOLUTION_URL=http://SEU_IP:8080
EVOLUTION_KEY=sua-api-key
EVOLUTION_INSTANCE=nome-da-instancia

PORT=3000
```

## Rodando

```bash
node server.js
```

Acesse `http://localhost:3000` (ou `http://IP_DA_VPS:3000`).

## Rodando em produção (VPS)

Use o PM2 para manter o processo rodando:

```bash
npm install -g pm2
pm2 start server.js --name gestor-iptv
pm2 save
pm2 startup
```

## Como usar

1. **Configurações** — ajuste os templates das mensagens
2. **Sincronizar Painel** — importa todos os clientes do seu painel IPTV
3. A automação roda automaticamente todo dia às **9h** (horário de Brasília)
4. Você também pode disparar manualmente pela tela de **Logs**

## Variáveis disponíveis nos templates

| Variável | Descrição |
|----------|-----------|
| `{nome}` | Nome do cliente |
| `{username}` | Usuário IPTV |
| `{senha}` | Senha IPTV |
| `{exp_date}` | Data de vencimento |
| `{renew_link}` | Link de renovação/pagamento |

## Estrutura do projeto

```
gestor-iptv/
├── server.js       ← API e servidor web
├── cron.js         ← automação de vencimentos
├── sync.js         ← importação do painel IPTV
├── whatsapp.js     ← envio via Evolution API
├── db.js           ← banco de dados SQLite
└── public/
    ├── index.html  ← dashboard de clientes
    ├── logs.html   ← histórico de mensagens
    └── config.html ← templates de mensagem
```

## Licença

MIT
