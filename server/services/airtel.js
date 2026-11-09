// Switch AIRTEL_BASE_URL to Airtel's production API host when moving out of sandbox.
const baseUrl = (process.env.AIRTEL_BASE_URL || 'https://openapiuat.airtel.africa').replace(/\/+$/, '');
const country = process.env.AIRTEL_COUNTRY || 'KE';
const currency = process.env.AIRTEL_CURRENCY || 'KES';

let cachedToken;
let tokenExpiresAt = 0;

const requestJson = async (url, options) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || `Airtel API returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!body || typeof body !== 'object') throw new Error('Airtel API returned an invalid response.');
  const providerCode = body.status?.code;
  if (providerCode && String(providerCode) !== '200') {
    throw new Error(body.status.message || `Airtel API returned status ${providerCode}.`);
  }
  return body;
};

export async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 30000) return cachedToken;

  const clientId = process.env.AIRTEL_CLIENT_ID;
  const clientSecret = process.env.AIRTEL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Airtel API credentials are not configured.');

  const result = await requestJson(`${baseUrl}/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('Airtel API did not return an access token.');
  }

  cachedToken = result.access_token;
  tokenExpiresAt = Date.now() + Math.max(0, Number(result.expires_in) || 0) * 1000;
  return cachedToken;
}

export async function requestPayment(phoneNumber, amount, reference) {
  const accessToken = await getAccessToken();
  return requestJson(`${baseUrl}/merchant/v2/payments/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Country': country,
      'X-Currency': currency,
    },
    body: JSON.stringify({
      reference,
      subscriber: { country, currency, msisdn: phoneNumber },
      transaction: { amount, country, currency, id: reference },
    }),
  });
}

export async function checkPaymentStatus(transactionId) {
  const accessToken = await getAccessToken();
  return requestJson(`${baseUrl}/standard/v2/payments/${encodeURIComponent(transactionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'X-Country': country,
      'X-Currency': currency,
    },
  });
}
