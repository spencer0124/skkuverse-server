---
title: Configure the Home Screen
type: how-to
status: accepted
owner: zoyoong124@gmail.com
last-updated: 2026-09-26
audience: internal
---

# Configure the Home Screen

> How to change what `GET /ui/home` serves: the banner carousel at the top of the app's home screen and the mini-app sections under it. The same carousel also runs on the campus tab's sheet ([Campus sheet banners](#campus-sheet-banners)). Every change is an edit to one JSON file plus a deploy.

## Overview

The layout lives in [`src/ui/home/home-layout.json`](../../src/ui/home/home-layout.json). It is validated when the module loads, so a bad file stops the deploy from starting instead of serving something broken. The rules are in `src/ui/home/home-layout.schema.ts`, and the wire types are in `src/ui/home/home-layout.types.ts`.

The file has two kinds of section, drawn in the order they are listed:

- **`banner_carousel`**: pages that rotate automatically.
  - `aspectRatio` is width ÷ height and applies to every page (1–6).
  - `autoRotateSec` is the number of seconds each page stays up. Use `0` for no rotation, otherwise a whole number from 2 to 30.
  - `items` is the list of pages:
    - `{ "type": "image", ... }` is an uploaded picture. It can have an action and an optional `startAt`/`endAt` window.
    - `{ "type": "default" }` is where the app's own built-in banner goes. Leave it out to hide that banner, and move it to change its position. It may appear at most once.
- **`miniapp_grid`**: an optional `title` plus a list of mini-app ids.
  - Only the ids go in the layout. Names and logos come from the mini-app registry (`src/miniapps/index.json`), which the app already holds.
  - Every id must be registered, and a mini app may appear in only one grid.

Text (`alt`, `title`) is written as `{ "ko": ..., "en"?: ..., "zh"?: ... }`, and `ko` is required. The server picks one language per request, and `Vary: Accept-Language` is already set.

**App releases that predate this endpoint never call it.** They still draw a single flat grid from the registry's `order` and `hidden`. So when you move a mini app between sections, keep `hidden` in `index.json` meaningful for those older releases.

## Prerequisites

- `wrangler` logged in to the Cloudflare account that owns the `skkuverse-media` R2 bucket (only needed to add an image).

## Steps

### Add a banner image

1. **Prepare the image** at the slot's aspect ratio, because the app crops with `cover`. About 2160 px wide is enough; the slot is roughly 1030 px wide on a 3x phone.
2. **Upload it first.** Nothing fetches the URL at boot, so a key with no object behind it becomes a blank page on every phone. The key includes a content hash, and the object is never overwritten (same rules as [event-places.md §5](../reference/event-places.md)):

   ```bash
   KEY=home/banners/<slug>-$(shasum -a 256 banner.jpg | cut -c1-8).jpg
   npx wrangler@4 r2 object put skkuverse-media/$KEY --file banner.jpg --remote \
     --content-type image/jpeg --cache-control "public, max-age=31536000, immutable"
   curl -sI https://media.skkuverse.com/$KEY   # 200, image/jpeg
   ```

3. **Add the item** to the carousel's `items`:

   ```json
   {
     "type": "image",
     "id": "<slug>",
     "imageUrl": "https://media.skkuverse.com/home/banners/<slug>-<hash>.jpg",
     "alt": { "ko": "…", "en": "…" },
     "actionType": "miniapp",
     "actionValue": "eskara-2026",
     "endAt": "2026-10-03T00:00:00+09:00"
   }
   ```

   - `actionType` is `miniapp` (a registered mini-app target), `external` (an https URL), `webview` (a page on our web view), or `route` (an in-app path). Omit both fields for a banner that does nothing when tapped.
   - `startAt` is inclusive and `endAt` is exclusive. Both need an explicit offset. Filtering happens on every request, so a banner ends on time without a deploy. The only lag is the response's 5-minute `Cache-Control`.

4. `npm test`, then deploy.

### Campus sheet banners

`GET /ui/home/campus` puts a second carousel above the four service tiles on the campus tab's sheet. It lives in [`src/ui/ui/campus-banners.json`](../../src/ui/ui/campus-banners.json) and is a single `banner_carousel` object, not a layout. The rules are the home carousel's, with two differences:

- **Images only.** `{ "type": "default" }` is refused, because the campus sheet has no built-in banner for it to stand for.
- **No empty slot.** When every image is outside its window, the section is left out of the response, so the tiles move up.

Add a banner the way the steps above describe, with keys under `campus/banners/`. The slot is 6:1. The ESKARA 2026 student banners are 2400 × 400 WebP, about 110 KB each: the app also opens a banner full screen, turned sideways, where its long edge spans the phone's height (about 2400 px on a 3x phone). Errors at boot start with `campus banners:`. The response also sends a 5-minute `Cache-Control`.

The app only draws this section while its festival gate is open (`isFestivalUnlocked()` in skkuverse-app). A store build shows the campus sheet empty until the festival-day flip.

### Rearrange the mini-app sections

Edit the `miniapp_grid` sections: reorder ids, move an id to another grid, add a grid, or add or remove a `title`. To add a new mini app, register it in `src/miniapps/` first (see [register-a-miniapp.md](register-a-miniapp.md)), since the layout refuses unknown ids.

## Troubleshooting

- **The server will not start and the log starts with `home layout:`**: the message names the field that failed. Common causes are a misspelt key (unknown keys are refused), a mini-app id missing from the registry, or an id placed in two grids.
- **A banner shows in dev but not in production**: its `startAt`/`endAt` window is evaluated on the server's clock. Remember the offset in the window.
- **Production crashes on boot with `ENOENT … home-layout.json`** (or `campus-banners.json`): the file is missing from `scripts/copy-build-assets.js`.

## Related

- [`src/miniapps/index.json`](../../src/miniapps/index.json): the registry the grids reference.
- skkuverse-app `packages/shared/src/home/`: the client parser, which skips section and item types it does not know.
