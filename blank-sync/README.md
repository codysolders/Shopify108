# Blank Sync

Keeps one inventory of blank shirts (for example "Gildan Soft Style Inventory G640") and lets every
design product use it.

## What it does

- **A sale takes from the blank.** When any design sells, online or through Shopify POS at the shop,
  the matching blank (same color and size) goes down by the quantity sold.
- **Every design shows the blank's count.** When a blank's count changes for any reason (a sale, a
  new shipment you receive, a manual recount), every design that uses that blank is updated to the
  same number. If you're out of Black / M blanks, every design shows Black / M as sold out.
- **Returns put blanks back.** A refund marked "restock" adds the blank back. Refunds without
  restock don't change anything.
- **Selling a blank directly** (for example ringing up a plain shirt at the shop) works like it does
  today. Shopify takes it off the blank, and the designs update to match.

## How to link a design to its blank

1. Open the design product in Shopify admin.
2. In the **Blank product** field (under Metafields), pick the blank, for example
   "Gildan Soft Style Inventory G640".
3. That's it. Variants are matched by **Color** and **Size** automatically. "Medium" matches "M",
   "XXL" matches "2XL", and "Gray" matches "Grey". The Design option is ignored.

If one variant needs a different blank than its color and size suggest, set **Blank variant
(override)** on that variant.

Run `npm run check` at any time to see which designs are linked and any variants that didn't match.

## One-time setup

You'll need about 30 minutes. Nothing changes in your store until step 5, and the app starts in
**dry run** mode, which only logs what it would do.

### 1. Create the app in Shopify

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) and sign in with your
   store's account.
2. Click **Apps → Create app**, choose to start from the Dev Dashboard, and name it "Blank Sync".
3. Create a version with these access scopes:
   `read_products, write_products, read_inventory, write_inventory, read_orders, write_orders, read_locations`
4. Release the version, then **Install** the app on your store.
5. On the app's **Settings** page, copy the **Client ID** and **Client secret**.

The app and your store need to be in the same Shopify organization for this sign-in method to work.

### 2. Deploy to Google Cloud Run

Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then from this folder:

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud run deploy blank-sync \
  --source . \
  --region us-west1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --concurrency 1 \
  --set-env-vars SHOPIFY_SHOP=YOUR-STORE,SHOPIFY_CLIENT_ID=...,SHOPIFY_CLIENT_SECRET=...,DRY_RUN=true
```

`YOUR-STORE` is the part before `.myshopify.com`. The command prints a URL like
`https://blank-sync-abc123-uw.a.run.app`. Open it and you should see `blank-sync ok (dry run)`.

Cost: Cloud Run's free tier covers 2 million requests a month, so a store this size should cost
$0 to a few dollars a month. `--max-instances 1 --concurrency 1` makes sure two orders are never
processed at the same moment, which keeps the counts exact.

### 3. Create the fields and webhooks

On your computer, copy `.env.example` to `.env`, fill in the same values, then run:

```bash
npm run setup -- https://YOUR-CLOUD-RUN-URL
```

This adds the **Blank product** field to products and tells Shopify to send orders, refunds and
inventory changes to the app.

### 4. Link designs and check

Link your design products (see above), then run:

```bash
npm run check
```

### 5. Go live

1. Turn on tracking for design variants, stock them at your location, and stop them selling when
   out of stock. This also copies the blank counts onto them:
   ```bash
   DRY_RUN=false npm run resync -- --fix
   ```
2. Switch the app out of dry run:
   ```bash
   gcloud run services update blank-sync --region us-west1 --update-env-vars DRY_RUN=false
   ```

Watch the logs for the first few orders with
`gcloud run services logs read blank-sync --region us-west1`.

## Good to know

- Orders are tagged `blanks-deducted` once their blanks are taken, so the same order is never
  counted twice. Inventory changes also use Shopify idempotency keys, so a retried webhook is safe.
- Editing an order after it's placed (adding or removing items) isn't tracked yet. Adjust the blank
  by hand for those.
- `npm run resync` copies every blank's count to its designs again. Use it if anything ever looks off.

## For developers

- Node 20+, no dependencies. `npm test` runs the tests.
- `src/matching.js`: pure matching of design variants to blank variants.
- `src/blankMap.js`: reads linked products from Shopify and builds the lookup index (cached 5 minutes,
  cleared on product webhooks).
- `src/handlers.js`: webhook handlers for `orders/create`, `refunds/create`, `inventory_levels/update`
  and `products/*`.
- `src/inventory.js`: inventory reads and writes (`inventoryAdjustQuantities`, `inventorySetQuantities`).
