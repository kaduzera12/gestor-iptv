require('dotenv').config()
const fetch = require('node-fetch')

const { GESAPI_USER, GESAPI_PASS, GESAPI_PROXY_URL, GESAPI_PROXY_SECRET } = process.env
const BASE_URL = GESAPI_PROXY_URL || 'https://gesapioffice.com'

function gesapiHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra }
  if (GESAPI_PROXY_SECRET) h['X-Proxy-Secret'] = GESAPI_PROXY_SECRET
  return h
}

async function renovarClienteGesapi(painelId, credits = 1) {
  const loginRes = await fetch(`${BASE_URL}/api/login`, {
    method: 'POST',
    headers: gesapiHeaders(),
    body: JSON.stringify({ username: GESAPI_USER, password: GESAPI_PASS, code: '' }),
  })
  if (!loginRes.ok) throw new Error(`Login gesapi falhou: ${loginRes.status}`)
  const { access_token, crypt_pass } = await loginRes.json()

  const renovarRes = await fetch(`${BASE_URL}/api/users-iptv/${painelId}`, {
    method: 'PUT',
    headers: gesapiHeaders({ Authorization: `Bearer ${access_token}` }),
    body: JSON.stringify({ action: 1, credits, reg_password: crypt_pass }),
  })
  if (!renovarRes.ok) {
    const err = await renovarRes.text()
    throw new Error(`Renovação gesapi falhou ${renovarRes.status}: ${err}`)
  }
  return renovarRes.json()
}

module.exports = { renovarClienteGesapi }
