require('dotenv').config()
const fetch = require('node-fetch')

const { EVOLUTION_URL, EVOLUTION_KEY, EVOLUTION_INSTANCE } = process.env

async function enviarMensagem(telefone, texto) {
  let numero = telefone.replace(/\D/g, '')
  if (!numero.startsWith('55')) numero = '55' + numero

  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_KEY },
    body: JSON.stringify({
      number: numero,
      text: texto,
      delay: 1200,
      linkPreview: false,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Evolution API erro ${res.status}: ${err}`)
  }

  return res.json()
}

function aplicarTemplate(template, dados) {
  return template
    .replace(/{nome}/g, dados.nome || '')
    .replace(/{username}/g, dados.username || '')
    .replace(/{senha}/g, dados.senha || '')
    .replace(/{exp_date}/g, dados.exp_date || '')
    .replace(/{renew_link}/g, dados.renew_link || '')
}

module.exports = { enviarMensagem, aplicarTemplate }
