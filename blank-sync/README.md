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

## Adding a new design

Pick whichever is easiest. Either way the app does the rest within a few seconds of saving:
it links the design, turns on inventory tracking, stops overselling, and copies the blank's counts.

- **Duplicate the template.** Each blank has a draft product called `TEMPLATE - <blank> design`.
  Click **Duplicate**, rename it, change the **Design** value, set the price and photos, publish.
- **Use a tag.** On any product with Color and Size options, add the tag `blank:G640` (any word or
  style number that appears in only one blank's name).
- **Pick the field.** In the **Blank product** field (under Metafields), pick the blank.

Variants are matched by **Color** and **Size**. "Medium" matches "M", "XXL" matches "2XL", and
"Gray" matches "Grey". The Design option is ignored. If a design has a color or size the blank
doesn't have (or the tag matches no blank), the product gets the tag `blank-sync-needs-review`.
Filter products by that tag to find them; the tag comes off by itself once it's fixed.

If one variant needs a different blank than its color and size suggest, set **Blank variant
(override)** on that variant.

Run `npm run check` at any time to see which designs are linked and any variants that didn't match.

## Adding a new blank

Open the **Add a blank** page (run `npm run links` in Cloud Shell to get the private link). Fill in
the name with its style number, supplier, link, colors (or press **Get colors from this link**), sizes,
"Reorder at" and order quantity. It creates the blank product (tracked, never oversold, not on the
online store) and its design template. Then count your shirts and enter the numbers in Shopify.

**New colors for a blank you already have:** on the same page, under **Add colors to a blank**,
pick the blank and type the colors (or press **Show supplier colors I don't have**). Every size is
added at 0. Colors added in Shopify admin work too: whenever a blank gains a color or size, the app
adds it to that blank's design template automatically. Existing designs are left alone, so each
design only offers the colors you choose.

The same page has **Make template** buttons for blanks that don't have one yet. From Cloud Shell:
`npm run template -- 64200`.

## One-time setup

You'll need about 30 minutes. Nothing changes in your store until step 5, and the app starts in
**dry run** mode, which only logs what it would do.

### 1. Create the app in Shopify

1. Go to the [Shopify Dev Dashboard](https://dev.shopify.com/dashboard) and sign in with your
   store's account.
2. Click **Apps → Create app**, choose to start from the Dev Dashboard, and name it "Blank Sync".
3. Create a version with these access scopes:
   `read_products, write_products, read_inventory, write_inventory, read_orders, write_orders, read_locations, read_files, write_files`
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

## Mockups: each design on each blank color

Open the **Mockups** page (`npm run links` prints its private link) and pick a group, like
`union-3711`.

1. **Art for each design.** Upload a PNG with a see-through background for Design 1, Design 2, ...
   It is saved in Shopify Files and used on every product in the group with that design.
2. **Check the preview.** Open a product to see every design on every color. Move the art with the
   sliders (or **Full front / Left chest / Hat front**) and **Save placement**. Each product keeps
   its own placement, so hats, pants and shirts can differ.
3. **Make the mockups.** The app puts the art on the blank photo of each color and attaches the
   picture to every size of that design and color, so shoppers see the shirt they picked. Making
   them again after a change replaces the old pictures.

Blank photos are found automatically: the photo on that color's variants today, then a product
photo whose file name or alt text names the color (like `2905-navy.jpg`), then a photo on the linked
blank product. You can pick a different one per color. **Hide plain blank photos** takes them off
the store page once every color has mockups (they stay in Files).

The page needs the `read_files` and `write_files` scopes on the app (see setup step 1).
Saved per product in JSON metafields: `custom.mockup_art`, `mockup_place`, `mockup_photos`, `mockup_made`.

## Restock minimums and the reorder list

On each **blank** product in Shopify, fill in (under Metafields):

- **Supplier**: SanMar, Bayside, AKWA, ...
- **Reorder link**: the supplier's page for that blank.
- **Reorder at (default)**: a color/size goes on the list when it's at or below this number.
- **Order quantity (default)**: how many to order (12 if left empty).

A single color/size can override both on its variant (**Reorder at**, **Order quantity**).
Photos come from the blank's own product and variant images in Shopify.

- `npm run reorder` prints the list and the private reorder page link.
- `node scripts/setup-email.js` (owner, once) turns on a 7 AM Pacific email through Gmail, scheduled
  with Cloud Scheduler. It needs a [Gmail app password](https://myaccount.google.com/apppasswords).
  The email is only sent when something is low.

## Sharing with employees (Secret Manager)

So employees never handle the Shopify keys, the owner stores them in Google Cloud Secret Manager once.
In Cloud Shell, from this folder (with a working `.env`):

```bash
node scripts/store-secrets.js
node scripts/add-employee.js person@example.com
```

After that, anyone you add can clone the repo in their own Cloud Shell and run `npm run check` or
`npm run resync` with no `.env`: the app reads the keys from Secret Manager. Remove someone with
`node scripts/add-employee.js person@example.com --remove`. If you change the Client secret in Shopify,
run `node scripts/make-env.js` and `node scripts/store-secrets.js` again.

## Good to know

- Orders are tagged `blanks-deducted` once their blanks are taken, so the same order is never
  counted twice. Inventory changes also use Shopify idempotency keys, so a retried webhook is safe.
- Editing an order after it's placed (adding or removing items) isn't tracked yet. Adjust the blank
  by hand for those.
- `npm run resync` copies every blank's count to its designs again. Use it if anything ever looks off.

## For developers

- Node 20+. Dependencies: nodemailer (email) and sharp (mockup images). `npm test` runs the tests.
- `src/mockups.js` and `src/mockupPage.js`: the Mockups page and image generator.
- `src/matching.js`: pure matching of design variants to blank variants.
- `src/blankMap.js`: reads linked products from Shopify and builds the lookup index (cached 5 minutes,
  cleared on product webhooks).
- `src/handlers.js`: webhook handlers for `orders/create`, `refunds/create`, `inventory_levels/update`
  and `products/*`.
- `src/inventory.js`: inventory reads and writes (`inventoryAdjustQuantities`, `inventorySetQuantities`).
