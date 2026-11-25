// Minimal Shopify Admin GraphQL client with the client credentials grant.
import crypto from 'node:crypto';
import { config } from './config.js';

let cachedToken = null; // { token, expiresAt }

/** Forget the token, so the next call gets a new one (with any permissions approved since). */
export function clearAccessToken() {
  cachedToken = null;
}

export async function getAccessToken(fetchImpl = fetch) {
  if (config.accessToken) return config.accessToken;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const res = await fetchImpl(`https://${config.shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in || 86399) * 1000 };
  return cachedToken.token;
}

export async function graphql(query, variables = {}, { fetchImpl = fetch, retries = 3 } = {}) {
  const token = await getAccessToken(fetchImpl);
  const url = `https://${config.shop}.myshopify.com/admin/api/${config.apiVersion}/graphql.json`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
    }
    if (!res.ok) throw new Error(`Shopify API error ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < retries) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (body.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
    return body.data;
  }
}

// A stable UUID made from a string, so retries of the same change reuse the same idempotency key.
export function stableKey(text) {
  const h = crypto.createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function gid(type, id) {
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/${type}/${s}`;
}

export function verifyWebhook(rawBody, hmacHeader, secret = config.clientSecret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(hmacHeader));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
