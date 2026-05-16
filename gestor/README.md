# 📺 Gestor IPTV

Gestor de clientes IPTV com automação de cobranças via WhatsApp.

Substitui a automação paga de painéis como o `painelr.top` — roda na sua própria VPS, sem mensalidade.

## O que faz

- Sincroniza seus clientes do painel IPTV automaticamente todo dia às 9h
- Envia mensagem de boas-vindas quando o cliente é cadastrado manualmente (opcional)
- Envia aviso 3 dias antes do vencimento (opcional)
- Envia aviso 1 dia antes do vencimento (opcional)
- Envia aviso no dia do vencimento (opcional)
- Envia mensagem de reconquista 10 dias após o vencimento (opcional)
- Cada automação pode ser ativada ou desativada individualmente pelo painel
- Templates de mensagem editáveis pelo painel
- Clientes sem nome são marcados visualmente e ignorados pelas automações (tratados como contas de teste)
- Histórico de todas as mensagens enviadas

## Requisitos

- Node.js **20** (obrigatório — versões mais novas não são compatíveis com better-sqlite3 no Windows)
- Uma VPS (recomendado) ou servidor sempre ligado
- [Evolution API](https://github.com/EvolutionAPI/evolution-api) instalada e configurada
- Conta no painel `painelr.top` (ou compatível)

## Instalação

```bash
git clone https://github.com/seu-usuario/gestor-iptv
cd gestor-iptv/gestor
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

1. Configure os templates em **Configurações** e ative as automações desejadas
2. O sistema sincroniza os clientes do painel e dispara as mensagens automaticamente todo dia às **9h** (horário de Brasília)
3. Nenhuma intervenção manual é necessária — basta manter o processo rodando
4. Para disparar manualmente fora do horário, use o botão **▶ Rodar Automação Agora** na tela de **Logs**

> Clientes sem nome no painel são ignorados pelas automações automáticas e marcados visualmente no dashboard.

## Automações disponíveis

| Automação | Quando dispara |
|-----------|---------------|
| Boas-vindas | Ao cadastrar um cliente manualmente |
| 3 dias antes | 3 dias antes do vencimento |
| 1 dia antes | 1 dia antes do vencimento |
| Vencimento | No dia em que a lista vence |
| Reconquistar | 10 dias após o vencimento |

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
└── gestor/
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
