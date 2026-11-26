// Customer art upload for custom orders.
// The store's product page loads /art-upload.js, which sends the customer's file to /art/upload.
// The file is saved in Shopify Files and its link goes on the cart line as the "Artwork" property,
// so it shows on the order. The private Custom orders page lists those orders with their art.
import crypto from 'node:crypto';
import { config } from './config.js';
import { graphql } from './shopify.js';

export const ART_PROPERTY = 'Artwork';
export const ART_NAME_PROPERTY = 'Artwork file';
export const ART_TAG = 'custom-art';
export const MAX_ART_BYTES = 25 * 1024 * 1024;

// Extensions customers can send, with the type Shopify stores them as.
export const ART_TYPES = {
  png: { mime: 'image/png', image: true },
  jpg: { mime: 'image/jpeg', image: true },
  jpeg: { mime: 'image/jpeg', image: true },
  pdf: { mime: 'application/pdf' },
  svg: { mime: 'image/svg+xml' },
  ai: { mime: 'application/postscript' },
  eps: { mime: 'application/postscript' },
  psd: { mime: 'image/vnd.adobe.photoshop' },
};

const fail = (message) => Object.assign(new Error(message), { userFacing: true });

export function customOrdersKey(secret = config.clientSecret) {
  return crypto.createHmac('sha256', secret || 'unset').update('custom-orders-page').digest('hex').slice(0, 24);
}

const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

/** Check the file name and first bytes. Returns the ART_TYPES entry plus the extension. */
export function checkArt(filename, buf) {
  const e = ext(filename);
  const type = ART_TYPES[e];
  if (!type) throw fail('Please upload a PNG, JPG, PDF, SVG, AI, EPS or PSD file.');
  if (!buf?.length) throw fail('That file is empty.');
  if (buf.length > MAX_ART_BYTES) throw fail('That file is too big (25 MB max). Email it to us instead.');
  const head = buf.subarray(0, 16);
  const starts = (sig) => head.subarray(0, sig.length).equals(Buffer.from(sig));
  const ok = {
    png: () => starts([0x89, 0x50, 0x4e, 0x47]),
    jpg: () => starts([0xff, 0xd8, 0xff]),
    jpeg: () => starts([0xff, 0xd8, 0xff]),
    pdf: () => starts([0x25, 0x50, 0x44, 0x46]),
    psd: () => starts([0x38, 0x42, 0x50, 0x53]),
    svg: () => /<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8')),
    // AI files are PDF or PostScript inside; EPS is PostScript or the DOS EPS binary header.
    ai: () => starts([0x25, 0x50, 0x44, 0x46]) || starts([0x25, 0x21]),
    eps: () => starts([0x25, 0x21]) || starts([0xc5, 0xd0, 0xd3, 0xc6]),
  }[e];
  if (!ok()) throw fail(`That file doesn't look like a real .${e} file. Try saving it again.`);
  return { ...type, ext: e === 'jpeg' ? 'jpg' : e };
}

export const safeName = (s) =>
  String(s).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'art';

// ---------- who may upload ----------

let originsCache = null; // { set, at }

/** The store's own web addresses (myshopify and custom domains). Uploads from anywhere else are refused. */
export async function allowedOrigins(gql = graphql) {
  if (originsCache && Date.now() - originsCache.at < 60 * 60 * 1000) return originsCache.set;
  const set = new Set([`https://${config.shop}.myshopify.com`]);
  for (const o of String(process.env.ART_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)) set.add(o.replace(/\/$/, ''));
  try {
    const d = await gql(`{ shop { myshopifyDomain primaryDomain { host } } }`);
    set.add(`https://${d.shop.myshopifyDomain}`);
    const host = d.shop.primaryDomain?.host;
    if (host) {
      set.add(`https://${host}`);
      set.add(`https://${host.startsWith('www.') ? host.slice(4) : `www.${host}`}`);
    }
  } catch {
    // Fall back to the myshopify address; try again next time.
    return set;
  }
  originsCache = { set, at: Date.now() };
  return set;
}

const recent = new Map(); // ip -> [timestamps]
/** At most `max` uploads per address per hour, so nobody can fill the store's Files. */
export function rateLimited(ip, { max = 30, now = Date.now() } = {}) {
  const list = (recent.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (list.length >= max) return true;
  list.push(now);
  recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return false;
}

// ---------- saving to Shopify Files ----------

const STAGE = `
mutation S($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const FILE_CREATE = `
mutation F($files: [FileCreateInput!]!) {
  fileCreate(files: $files) { files { id fileStatus } userErrors { field message } }
}`;

const FILE_NODE = `
query N($id: ID!) {
  node(id: $id) {
    ... on MediaImage { fileStatus image { url } fileErrors { message } }
    ... on GenericFile { fileStatus url fileErrors { message } }
  }
}`;

const errs = (list) => {
  if (list?.length) throw new Error(list.map((e) => e.message).join('; '));
};

/** Save the customer's file to Shopify Files. Returns { url, image } (url is the file's CDN link). */
export async function saveCustomerArt({ buf, filename }, { gql = graphql, fetchImpl = fetch, delayMs = 1000, tries = 45 } = {}) {
  const type = checkArt(filename, buf);
  if (config.dryRun) return { dryRun: true, url: `${config.appUrl}/dry-run/${safeName(filename)}.${type.ext}`, image: type.image };
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `customer-art-${stamp}-${crypto.randomBytes(3).toString('hex')}-${safeName(filename)}.${type.ext}`;
  const st = (await gql(STAGE, {
    input: [{ filename: name, mimeType: type.mime, resource: type.image ? 'IMAGE' : 'FILE', httpMethod: 'POST', fileSize: String(buf.length) }],
  })).stagedUploadsCreate;
  errs(st.userErrors);
  const t = st.stagedTargets[0];
  const form = new FormData();
  for (const p of t.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([buf], { type: type.mime }), name);
  const up = await fetchImpl(t.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Upload to Shopify failed (${up.status})`);
  const fc = (await gql(FILE_CREATE, {
    files: [{ originalSource: t.resourceUrl, contentType: type.image ? 'IMAGE' : 'FILE', alt: `Customer art: ${String(filename).slice(0, 80)}` }],
  })).fileCreate;
  errs(fc.userErrors);
  const id = fc.files[0].id;
  for (let i = 0; i < tries; i++) {
    const n = (await gql(FILE_NODE, { id })).node;
    if (n?.fileStatus === 'FAILED') throw new Error(`Shopify could not save the file: ${n.fileErrors?.map((e) => e.message).join('; ') || 'unknown error'}`);
    const url = n?.image?.url || n?.url;
    if (n?.fileStatus === 'READY' && url) return { url, image: type.image, id };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Shopify is still saving the file. Please try again in a minute.');
}

// ---------- orders with art ----------

const ORDERS = `
query O($q: String!, $after: String) {
  orders(first: 50, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt displayFulfillmentStatus cancelledAt
      customer { displayName }
      lineItems(first: 50) {
        nodes { title variantTitle quantity customAttributes { key value } image { url } }
      }
    }
  }
}`;

const isUrl = (v) => /^https:\/\//i.test(String(v || ''));

/** Art links on a line: our Artwork property, plus links any older upload left. */
export function artOnLine(attrs = []) {
  const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]));
  const out = [];
  const ours = new RegExp(`^${ART_PROPERTY}( \\d+)?$`);
  for (const a of attrs) {
    if (ours.test(a.key) && isUrl(a.value)) out.push({ url: a.value, name: byKey[`${a.key} file`] || (a.key === ART_PROPERTY ? byKey[ART_NAME_PROPERTY] : '') || '' });
  }
  for (const a of attrs) {
    if (ours.test(a.key) || a.key.startsWith('_')) continue;
    if (isUrl(a.value) && /cdn\.shopify\.com|\/uploads\//.test(a.value)) out.push({ url: a.value, name: a.key });
  }
  return out;
}

/** Answers to the print questions (size, copies, ...) and any other text the customer typed. */
export const printNotes = (attrs = []) =>
  attrs.filter((a) => !a.key.startsWith('_') && !/^Artwork( \d+)?( file)?$/.test(a.key) && !isUrl(a.value) && !/fakepath/i.test(a.value || '') && String(a.value || '').trim());

/** The old upload button only sent the file name ("C:\fakepath\..."), never the file. */
export const lostArt = (attrs = []) => attrs.filter((a) => /fakepath/i.test(a.value || '')).map((a) => a.value.split('\\').pop());

/** Recent orders that have customer art, newest first. */
export async function ordersWithArt({ days = 120, gql = graphql } = {}) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const r = (await gql(ORDERS, { q: `created_at:>=${since}`, after })).orders;
    for (const o of r.nodes) {
      const lines = o.lineItems.nodes
        .map((li) => ({ ...li, art: artOnLine(li.customAttributes), lost: lostArt(li.customAttributes), notes: printNotes(li.customAttributes) }))
        .filter((li) => li.art.length || li.lost.length);
      if (lines.length) out.push({ ...o, lines });
    }
    if (!r.pageInfo.hasNextPage) break;
    after = r.pageInfo.endCursor;
  }
  return out;
}

/** Does this order (webhook payload) carry customer art? */
export const orderHasArt = (order) =>
  (order.line_items || []).some((li) => artOnLine((li.properties || []).map((p) => ({ key: p.name, value: p.value }))).length);
