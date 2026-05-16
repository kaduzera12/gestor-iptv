const Database = require('better-sqlite3')
const db = new Database('gestor.db')

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT,
    telefone TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    senha TEXT,
    exp_date TEXT NOT NULL,
    renew_link TEXT,
    status TEXT DEFAULT 'ativo',
    painel_id TEXT,
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER REFERENCES clientes(id),
    tipo TEXT NOT NULL,
    status TEXT DEFAULT 'enviado',
    enviado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT
  );
`)

const defaults = {
  template_novo_cliente: `*Dados da sua lista IPTV:*
*Usuário:* {username}
*Senha:* {senha}

*Vencimento:* {exp_date}
*Link de Renovação:* {renew_link}

_Mensagem automática_`,

  template_3_dias: `*Olá {nome}!*

Faltam *3 dias* para sua lista *{username}* vencer.

Renove pelo link:
{renew_link}

_Mensagem automática_`,

  template_1_dia: `*Olá {nome}!*

Falta *1 dia* para sua lista *{username}* vencer.

Renove pelo link:
{renew_link}

_Mensagem automática_`,

  template_vencimento: `*Olá {nome}!*

Sua lista *{username}* venceu hoje.

Renove agora pelo link:
{renew_link}

_Mensagem automática_`,

  ativo_novo_cliente: 'true',
  ativo_3_dias: 'true',
  ativo_1_dia: 'true',
  ativo_vencimento: 'true',
}

for (const [chave, valor] of Object.entries(defaults)) {
  db.prepare(`INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)`).run(chave, valor)
}

module.exports = db
