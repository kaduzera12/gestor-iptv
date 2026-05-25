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
