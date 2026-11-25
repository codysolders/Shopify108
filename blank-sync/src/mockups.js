// Mockups: put a design's art on the photo of each blank color, and attach the result to the
// matching variants (every size of "Design 1 / Black" shows the Design 1 on Black picture).
//
// Saved on each design product (JSON metafields, nothing else to host):
//   custom.mockup_art     { "Design 1": "https://cdn.shopify.com/...png" }   art per Design value
//   custom.mockup_place   { x, y, w, h }   print box: center x, top y, width, height (fractions of the photo)
//   custom.mockup_photos  { "black": "https://cdn.shopify.com/...jpg" }      plain blank photo per color
//   custom.mockup_made    { "Design 1|black": { media, hash } }              mockups already made
import crypto from 'node:crypto';
import { config } from './config.js';
import { graphql } from './shopify.js';
import { normValue } from './matching.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

export const MOCKUP_ALT = 'Mockup:';
export const DEFAULT_DESIGN = 'Any design';
export const PRESETS = {
  front: { x: 0.5, y: 0.24, w: 0.36, h: 0.4 },
  chest: { x: 0.62, y: 0.25, w: 0.14, h: 0.12 },
  hat: { x: 0.5, y: 0.34, w: 0.3, h: 0.18 },
};

/** A starting print box from the product's name; the page lets staff adjust it. */
export function guessPlace(title = '') {
  if (/\b(hat|cap|trucker|beanie|snapback|5-panel|visor)\b/i.test(title)) return PRESETS.hat;
  if (/\b(polo|quarter|1\/4 zip)\b/i.test(title)) return PRESETS.chest;
  if (/\b(pant|pants|sweatpant|jogger|shorts)\b/i.test(title)) return { x: 0.36, y: 0.3, w: 0.14, h: 0.12 };
  return PRESETS.front;
}

export function mockupsKey(secret = config.clientSecret) {
  return crypto.createHmac('sha256', secret || 'unset').update('mockups-page').digest('hex').slice(0, 24);
}

/** "Dark Ash" -> "dark ash" (same spelling rules as stock matching). */
export const colorKey = (c) => normValue(c);
/** "Dark Ash" -> "darkash", for finding a color in a file name like 2905-darkash.jpg */
const squash = (s) => normValue(s).replace(/[^a-z0-9]/g, '');

export const isMockup = (m) => String(m?.alt || '').startsWith(MOCKUP_ALT);
export const designOption = (options) => (options || []).find((o) => /^design/i.test(o.name));
export const colorOption = (options) => (options || []).find((o) => /^colou?r/i.test(o.name));

export function parseJson(value, fallback) {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

/** Clamp a saved print box to sane numbers. */
export function cleanPlace(p) {
  const n = (v, d, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const d = PRESETS.front;
  return { x: n(p?.x, d.x, 0, 1), y: n(p?.y, d.y, 0, 1), w: n(p?.w, d.w, 0.02, 1), h: n(p?.h, d.h, 0.02, 1) };
}

/**
 * Pure: where the art goes on a W x H photo. The art is fitted inside the print box (keeping its
 * shape), centered across, and touches the top of the box, like a print lined up under the collar.
 */
export function placeArt(W, H, artW, artH, place) {
  const p = cleanPlace(place);
  const boxW = p.w * W;
  const boxH = p.h * H;
  const scale = Math.min(boxW / artW, boxH / artH);
  const width = Math.max(1, Math.round(artW * scale));
  const height = Math.max(1, Math.round(artH * scale));
  let left = Math.round(p.x * W - width / 2);
  let top = Math.round(p.y * H);
  left = Math.min(Math.max(0, left), Math.max(0, W - width));
  top = Math.min(Math.max(0, top), Math.max(0, H - height));
  return { left, top, width, height };
}

const fileName = (url) => decodeURIComponent(String(url || '').split('?')[0].split('/').pop() || '');

/** Pure: do consecutive words of the text spell the color? ("2905-dark-ash", "darkash1", "Dark Ash tee") */
function spells(text, want) {
  const words = normValue(text).split(/[^a-z0-9]+/).filter(Boolean).map((w) => (/^[a-z]+\d{1,2}$/.test(w) ? w.replace(/\d+$/, '') : w));
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && joined.length < want.length; j++) {
      joined += words[j];
      if (joined === want) return true;
    }
  }
  return false;
}

/** Pure: does this picture show this color, by its alt text or file name? */
export function mediaShowsColor(m, color, allColors = []) {
  const want = squash(color);
  if (!want || !m?.url) return false;
  // A longer color that contains this one wins ("Heather Navy" over "Navy").
  const longer = allColors.filter((c) => squash(c) !== want && squash(c).includes(want));
  if (longer.some((c) => mediaShowsColor(m, c))) return false;
  const name = fileName(m.url).replace(/\.[a-z0-9]+$/i, '').replace(/_[0-9a-f]{8}-[0-9a-f-]{27,}$/i, '');
  return spells(m.alt || '', want) || spells(name, want);
}

/**
 * Pure: the plain blank photo for each color. Order: the one saved before, the picture on that
 * color's variants today (if it isn't a mockup), a product picture named for the color, then a
 * picture on the linked blank product.
 * product: { media: [{ id, url, alt }], variants: [{ selectedOptions, mediaIds }] }
 * Returns { [colorKey]: { url, from } }
 */
export function findPhotos({ colors, variants, media, saved = {}, blankMedia = [] }) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const plain = media.filter((m) => !isMockup(m) && m.url);
  const colorName = (v) => v.selectedOptions.find((o) => /^colou?r/i.test(o.name))?.value;
  const out = {};
  for (const color of colors) {
    const k = colorKey(color);
    if (saved[k]) {
      out[k] = { url: saved[k], from: 'saved' };
      continue;
    }
    const onVariant = variants
      .filter((v) => colorKey(colorName(v) || '') === k)
      .flatMap((v) => v.mediaIds || [])
      .map((id) => byId.get(id))
      .find((m) => m && !isMockup(m) && m.url);
    if (onVariant) {
      out[k] = { url: onVariant.url, from: 'variant', mediaId: onVariant.id };
      continue;
    }
    const named = plain.find((m) => mediaShowsColor(m, color, colors));
    if (named) {
      out[k] = { url: named.url, from: 'name', mediaId: named.id };
      continue;
    }
    const fromBlank = blankMedia.find((m) => !isMockup(m) && mediaShowsColor(m, color, colors));
    if (fromBlank) out[k] = { url: fromBlank.url, from: 'blank' };
  }
  return out;
}

export const mockupHash = (photoUrl, artUrl, place) =>
  crypto.createHash('sha256').update(JSON.stringify([photoUrl, artUrl, cleanPlace(place)])).digest('hex').slice(0, 16);

/**
 * Pure: the mockups a product needs. One per Design value x Color, for the variants with both.
 * Products without a Design option use one art (saved under DEFAULT_DESIGN) for everything.
 * Returns { jobs: [{ design, color, key, variantIds, photoUrl, artUrl, hash, old }], missing: [...] }
 */
export function planMockups(product, { only = null, force = false } = {}) {
  const dOpt = designOption(product.options);
  const cOpt = colorOption(product.options);
  if (!cOpt) return { jobs: [], missing: [{ reason: 'This product has no Color option.' }] };
  const designs = dOpt ? dOpt.values : [DEFAULT_DESIGN];
  const jobs = [];
  const missing = [];
  for (const design of designs) {
    if (only && design !== only) continue;
    const artUrl = product.art[design] || (dOpt ? null : product.art[DEFAULT_DESIGN]);
    for (const color of cOpt.values) {
      const ck = colorKey(color);
      const variantIds = product.variants
        .filter((v) => {
          const o = Object.fromEntries(v.selectedOptions.map((x) => [x.name, x.value]));
          return colorKey(o[cOpt.name] || '') === ck && (!dOpt || o[dOpt.name] === design);
        })
        .map((v) => v.id);
      if (!variantIds.length) continue;
      const photoUrl = product.photos[ck]?.url;
      if (!artUrl) {
        missing.push({ design, color, reason: 'no art yet' });
        continue;
      }
      if (!photoUrl) {
        missing.push({ design, color, reason: 'no blank photo for this color' });
        continue;
      }
      const key = `${design}|${ck}`;
      const hash = mockupHash(photoUrl, artUrl, product.place);
      const made = product.made[key];
      const exists = made && product.media.some((m) => m.id === made.media);
      if (!force && exists && made.hash === hash) continue;
      jobs.push({ design, color, key, variantIds, photoUrl, artUrl, hash, old: exists ? made.media : null });
    }
  }
  return { jobs, missing };
}

// ---------- Image work (sharp) ----------

let sharpLib = null;
async function sharp() {
  if (!sharpLib) {
    sharpLib = (await import('sharp')).default;
    sharpLib.cache(false);
    sharpLib.concurrency(1);
  }
  return sharpLib;
}

export async function fetchImage(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Could not download ${fileName(url)} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Art on photo. Small photos are enlarged to 1200px wide first so the art stays sharp. Returns a JPEG. */
export async function composeMockup(photoBuf, artBuf, place) {
  const s = await sharp();
  let photo = s(photoBuf).rotate();
  let { width: W, height: H } = await photo.metadata();
  if (W < 1200) {
    H = Math.round((H * 1200) / W);
    W = 1200;
    photo = photo.resize(W, H);
  }
  const photoFlat = await photo.flatten({ background: '#ffffff' }).toBuffer();
  const art = s(artBuf).rotate();
  const am = await art.metadata();
  const spot = placeArt(W, H, am.width, am.height, place);
  const artSized = await art.resize(spot.width, spot.height, { fit: 'fill' }).png().toBuffer();
  return s(photoFlat)
    .composite([{ input: artSized, left: spot.left, top: spot.top }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

// ---------- Shopify ----------

const PRODUCT = `
query P($id: ID!) {
  product(id: $id) {
    id title tags status
    options { name values }
    media(first: 250) { nodes { id alt status mediaContentType ... on MediaImage { image { url width height } } } }
    art: metafield(namespace: "custom", key: "mockup_art") { value }
    place: metafield(namespace: "custom", key: "mockup_place") { value }
    photos: metafield(namespace: "custom", key: "mockup_photos") { value }
    made: metafield(namespace: "custom", key: "mockup_made") { value }
    blank: metafield(namespace: "custom", key: "blank_product") {
      reference { ... on Product { id title media(first: 100) { nodes { id alt ... on MediaImage { image { url } } } } } }
    }
  }
}`;

const VARIANTS = `
query V($id: ID!, $after: String) {
  product(id: $id) {
    variants(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id title selectedOptions { name value } media(first: 5) { nodes { id } } }
    }
  }
}`;

const TAGGED = `
query T($q: String!, $after: String) {
  products(first: 100, after: $after, query: $q, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status tags
      options { name values }
      featuredMedia { preview { image { url } } }
      art: metafield(namespace: "custom", key: "mockup_art") { value }
      made: metafield(namespace: "custom", key: "mockup_made") { value }
    }
  }
}`;

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

const NODES = `
query N($ids: [ID!]!) {
  nodes(ids: $ids) { ... on MediaImage { id status fileStatus image { url } mediaErrors { message } } }
}`;

const ADD_MEDIA = `
mutation M($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
  productUpdate(product: $product, media: $media) {
    product { id media(first: 250) { nodes { id alt } } }
    userErrors { field message }
  }
}`;

const DETACH = `
mutation D($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
  productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) { userErrors { field message } }
}`;

const APPEND = `
mutation A($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
  productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) { userErrors { field message } }
}`;

const FILE_DELETE = `
mutation X($fileIds: [ID!]!) { fileDelete(fileIds: $fileIds) { deletedFileIds userErrors { field message } } }`;

const FILE_UPDATE = `
mutation U($files: [FileUpdateInput!]!) { fileUpdate(files: $files) { files { id } userErrors { field message } } }`;

const REORDER = `
mutation R($id: ID!, $moves: [MoveInput!]!) { productReorderMedia(id: $id, moves: $moves) { userErrors { field message } } }`;

const SET_FIELDS = `
mutation SF($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;

const errs = (list) => {
  if (list?.length) {
    const msg = list.map((e) => e.message).join('; ');
    if (/access denied|write_files|read_files/i.test(msg)) throw new Error(SCOPE_HELP);
    throw new Error(msg);
  }
};
export const SCOPE_HELP =
  'Blank Sync needs permission to add files. In the Shopify Dev Dashboard, open Blank Sync, create a new version with ' +
  'read_files and write_files added to the scopes, release it, and approve it on the store.';

const wrap = async (p) => {
  try {
    return await p;
  } catch (e) {
    if (/access denied|ACCESS_DENIED|write_files|read_files/i.test(e.message)) throw new Error(SCOPE_HELP);
    throw e;
  }
};

/** Everything the mockup page and generator need about one product. */
export async function loadProduct(id, gql = graphql) {
  const p = (await gql(PRODUCT, { id })).product;
  if (!p) return null;
  const variants = [];
  let after = null;
  do {
    const conn = (await gql(VARIANTS, { id, after })).product.variants;
    for (const v of conn.nodes) variants.push({ id: v.id, title: v.title, selectedOptions: v.selectedOptions, mediaIds: v.media.nodes.map((m) => m.id) });
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  const media = p.media.nodes
    .filter((m) => m.mediaContentType === 'IMAGE')
    .map((m) => ({ id: m.id, alt: m.alt || '', url: m.image?.url || null, status: m.status }));
  const blankMedia = (p.blank?.reference?.media?.nodes || []).map((m) => ({ id: m.id, alt: m.alt || '', url: m.image?.url }));
  const savedPhotos = parseJson(p.photos?.value, {});
  const colors = colorOption(p.options)?.values || [];
  return {
    id: p.id,
    title: p.title,
    tags: p.tags,
    status: p.status,
    options: p.options.filter((o) => o.name !== 'Title'),
    media,
    variants,
    blank: p.blank?.reference ? { id: p.blank.reference.id, title: p.blank.reference.title } : null,
    blankMedia,
    art: parseJson(p.art?.value, {}),
    placeSaved: Boolean(p.place?.value),
    place: cleanPlace(parseJson(p.place?.value, guessPlace(p.title))),
    savedPhotos,
    photos: findPhotos({ colors, variants, media, saved: savedPhotos, blankMedia }),
    made: parseJson(p.made?.value, {}),
  };
}

/** Tags that group design products (not Blank Sync's own tags), with how many products have each. */
export function designTags(products) {
  const counts = new Map();
  for (const p of products) {
    if (!p.colors.length || p.title.startsWith('TEMPLATE') || p.tags.includes('blank')) continue;
    for (const t of p.tags) {
      if (/^(blank|blank:.*|blank-sync-.*|blanks-deducted)$/i.test(t)) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Products with a tag (or all products), with how far along their mockups are. */
export async function listTagged(tag, gql = graphql) {
  const out = [];
  let after = null;
  const q = tag ? `tag:'${String(tag).replace(/'/g, '')}'` : '';
  do {
    const conn = (await gql(TAGGED, { q, after })).products;
    for (const p of conn.nodes) {
      const d = designOption(p.options);
      const c = colorOption(p.options);
      out.push({
        id: p.id,
        title: p.title,
        status: p.status,
        tags: p.tags,
        image: p.featuredMedia?.preview?.image?.url || null,
        designs: d ? d.values : [DEFAULT_DESIGN],
        colors: c?.values || [],
        art: parseJson(p.art?.value, {}),
        madeCount: Object.keys(parseJson(p.made?.value, {})).length,
      });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function setJson(ownerId, key, value, gql) {
  const r = await gql(SET_FIELDS, { m: [{ ownerId, namespace: 'custom', key, type: 'json', value: JSON.stringify(value) }] });
  errs(r.metafieldsSet.userErrors);
}

/** Upload bytes to Shopify's staging bucket. Returns the resourceUrl to create media or files from. */
export async function stageUpload(buf, filename, mimeType, gql = graphql, fetchImpl = fetch) {
  const r = (await gql(STAGE, { input: [{ filename, mimeType, resource: 'IMAGE', httpMethod: 'POST', fileSize: String(buf.length) }] }))
    .stagedUploadsCreate;
  errs(r.userErrors);
  const t = r.stagedTargets[0];
  const form = new FormData();
  for (const p of t.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([buf], { type: mimeType }), filename);
  const res = await fetchImpl(t.url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Upload to Shopify failed (${res.status})`);
  return t.resourceUrl;
}

async function waitReady(ids, gql, { tries = 40, delayMs = 1500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const nodes = (await gql(NODES, { ids })).nodes.filter(Boolean);
    const failed = nodes.find((n) => n.status === 'FAILED' || n.fileStatus === 'FAILED');
    if (failed) throw new Error(`Shopify could not process an image: ${failed.mediaErrors?.map((e) => e.message).join('; ') || 'unknown error'}`);
    if (nodes.length === ids.length && nodes.every((n) => n.image?.url && (n.status === 'READY' || n.fileStatus === 'READY'))) return nodes;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error('Shopify is still processing the images. Try again in a minute.');
}

const safeName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';

/**
 * Save art for one Design value on one or more products. The file goes to Shopify Files.
 * Returns { url, products }.
 */
export async function saveArt({ productIds, design, buf, filename, mimeType }, gql = graphql) {
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) throw new Error('Art must be a PNG (best, with a see-through background), JPG or WebP.');
  if (config.dryRun) return { dryRun: true, products: productIds.length };
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const resourceUrl = await wrap(stageUpload(buf, `art-${safeName(design)}-${safeName(filename.replace(/\.[^.]+$/, ''))}.${ext}`, mimeType, gql));
  const r = (await wrap(gql(FILE_CREATE, { files: [{ originalSource: resourceUrl, contentType: 'IMAGE', alt: `Mockup art: ${design}` }] }))).fileCreate;
  errs(r.userErrors);
  const [file] = await waitReady([r.files[0].id], gql);
  for (const id of productIds) {
    const cur = parseJson((await gql(`query($id: ID!) { product(id: $id) { art: metafield(namespace: "custom", key: "mockup_art") { value } } }`, { id })).product?.art?.value, {});
    cur[design] = file.image.url;
    await setJson(id, 'mockup_art', cur, gql);
  }
  return { url: file.image.url, products: productIds.length };
}

export async function savePlace(productId, place, gql = graphql) {
  if (config.dryRun) return { dryRun: true };
  await setJson(productId, 'mockup_place', cleanPlace(place), gql);
  return { place: cleanPlace(place) };
}

/** Choose a different blank photo for a color (url of one of the product's pictures). */
export async function savePhoto(productId, color, url, gql = graphql) {
  const p = await loadProduct(productId, gql);
  const saved = { ...p.savedPhotos };
  if (url) saved[colorKey(color)] = url;
  else delete saved[colorKey(color)];
  if (!config.dryRun) await setJson(productId, 'mockup_photos', saved, gql);
  return { saved };
}

/**
 * Make (or remake) the mockups for one product, optionally one Design value only, and attach each
 * to its variants. Old mockups it replaces are deleted. Plain blank photos stay where they are.
 */
export async function makeMockups(productId, { design = null, force = false, gql = graphql, fetchImpl = fetch } = {}) {
  const product = await loadProduct(productId, gql);
  if (!product) throw new Error('That product no longer exists.');
  const { jobs, missing } = planMockups(product, { only: design, force });
  if (!jobs.length) return { made: 0, missing, title: product.title };
  if (config.dryRun) return { dryRun: true, wouldMake: jobs.length, missing, title: product.title };

  // Remember each color's plain photo, so it is still found after the variants show mockups.
  const photos = { ...product.savedPhotos };
  for (const [k, v] of Object.entries(product.photos)) photos[k] = v.url;
  await setJson(product.id, 'mockup_photos', photos, gql);

  const cache = new Map();
  const get = (url) => {
    if (!cache.has(url)) cache.set(url, fetchImage(url, fetchImpl));
    return cache.get(url);
  };
  const sources = [];
  for (const j of jobs) {
    const jpg = await composeMockup(await get(j.photoUrl), await get(j.artUrl), product.place);
    const name = `mockup-${safeName(product.title)}-${safeName(j.design)}-${safeName(j.color)}.jpg`;
    sources.push({ job: j, resourceUrl: await stageUpload(jpg, name, 'image/jpeg', gql, fetchImpl) });
  }
  const before = new Set(product.media.map((m) => m.id));
  const added = (
    await gql(ADD_MEDIA, {
      product: { id: product.id },
      media: sources.map((s) => ({ originalSource: s.resourceUrl, mediaContentType: 'IMAGE', alt: `${MOCKUP_ALT} ${s.job.design} / ${s.job.color}` })),
    })
  ).productUpdate;
  errs(added.userErrors);
  const fresh = added.product.media.nodes.filter((m) => !before.has(m.id));
  const altToJob = new Map(sources.map((s) => [`${MOCKUP_ALT} ${s.job.design} / ${s.job.color}`, s.job]));
  const newIds = new Map();
  for (const m of fresh) if (altToJob.has(m.alt)) newIds.set(altToJob.get(m.alt).key, m.id);
  if (newIds.size !== jobs.length) throw new Error('Shopify did not take every image. Try again.');
  await waitReady([...newIds.values()], gql);

  // A variant shows one picture: take off what it had, then attach the mockup.
  const byVariant = new Map(product.variants.map((v) => [v.id, v]));
  const detach = [];
  const append = [];
  for (const j of jobs) {
    for (const vid of j.variantIds) {
      const had = byVariant.get(vid)?.mediaIds || [];
      if (had.length) detach.push({ variantId: vid, mediaIds: had });
      append.push({ variantId: vid, mediaIds: [newIds.get(j.key)] });
    }
  }
  for (let i = 0; i < detach.length; i += 100) errs((await gql(DETACH, { productId: product.id, variantMedia: detach.slice(i, i + 100) })).productVariantDetachMedia.userErrors);
  for (let i = 0; i < append.length; i += 100) errs((await gql(APPEND, { productId: product.id, variantMedia: append.slice(i, i + 100) })).productVariantAppendMedia.userErrors);

  const made = { ...product.made };
  for (const j of jobs) made[j.key] = { media: newIds.get(j.key), hash: j.hash };
  await setJson(product.id, 'mockup_made', made, gql);

  const old = jobs.map((j) => j.old).filter(Boolean);
  if (old.length) errs((await wrap(gql(FILE_DELETE, { fileIds: old }))).fileDelete.userErrors);

  // The first design on the first color becomes the main picture.
  const first = planMockups({ ...product, made }, { force: true }).jobs[0];
  if (first && made[first.key]) {
    await gql(REORDER, { id: product.id, moves: [{ id: made[first.key].media, newPosition: '0' }] }).catch(() => {});
  }
  log(`mockups: ${product.title}: made ${jobs.length}${design ? ` for ${design}` : ''}`);
  return { made: jobs.length, missing, title: product.title };
}

/**
 * Take the plain blank photos off the store page once every color has mockups. The files stay in
 * Shopify Files (and saved here), so mockups can still be remade from them.
 */
export async function hidePlainPhotos(productId, gql = graphql) {
  const p = await loadProduct(productId, gql);
  const plan = planMockups(p);
  if (plan.jobs.length || plan.missing.length) throw new Error('Make every mockup first, so no variant is left without a picture.');
  const plain = p.media.filter((m) => !isMockup(m));
  if (!plain.length) return { hidden: 0 };
  const photos = { ...p.savedPhotos };
  for (const [k, v] of Object.entries(p.photos)) photos[k] = v.url;
  if (config.dryRun) return { dryRun: true, wouldHide: plain.length };
  await setJson(p.id, 'mockup_photos', photos, gql);
  const used = new Set(Object.values(photos));
  const hide = plain.filter((m) => used.has(m.url));
  if (!hide.length) return { hidden: 0 };
  errs((await wrap(gql(FILE_UPDATE, { files: hide.map((m) => ({ id: m.id, referencesToRemove: [p.id] })) }))).fileUpdate.userErrors);
  return { hidden: hide.length };
}
