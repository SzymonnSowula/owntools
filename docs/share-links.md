# Share links — a link to a video, straight from the export dialog

The short version: the feature is **built and tested, and off in production**
only because no bucket is configured — `POST /api/share` on www.owntools.app
answers `503 sharing_not_configured`. The domain was never the missing piece;
storage for the videos is. Switching it on is §2: a Cloudflare R2 bucket, one
API token, two lifecycle rules and a handful of environment variables on
Vercel. No code change, no new desktop build — the app already has the button
and already talks to `owntools.app/api/share`.

§3 is what happens when someone points a script at it. Read it before
switching the feature on: hosting other people's uploads is the one part of
this product where a stranger can spend the owner's money.

---

## 1. What exists

| Piece | Where |
| --- | --- |
| "Share link → Create link" (renders, uploads, copies the link; Copy / Open / ✕ per link) | `packages/feature-editor/src/components/ExportModal.tsx` |
| Upload client (8 MB presigned parts, owner token kept in project.json) | `packages/feature-editor/src/lib/share.ts` |
| Step 1 — upload plan, size cap, storage ceiling, rate limits | `web/app/api/share/route.ts` |
| Step 2 — stitch, check what landed, publish; GET meta; DELETE with the owner token | `web/app/api/share/[id]/route.ts` |
| Player page (unlisted, noindex, previews, download, report link) | `web/app/v/[id]/page.tsx` |
| Stable media addresses → redirect to a freshly signed URL | `web/app/v/[id]/[file]/route.ts` (`/v/<id>/video.mp4`, `/v/<id>/poster.jpg`) |
| Storage, signing, ceilings, container checks, config | `web/lib/share.ts` (+ `share.test.ts`) |
| Which address a rate limit counts against | `web/lib/rateLimit.ts` (+ `rateLimit.test.ts`) |
| What the privacy page and the terms say about it | `web/app/privacy`, `web/app/terms` (read `SHARE_TTL_DAYS`) |

A share is a folder in the bucket — `shares/<id>/{video.mp4, poster.jpg,
meta.json}` — and nothing else: no database, no accounts. The bucket stays
private; the site signs every read. The video carries `Content-Disposition:
attachment` with the share's name, so the download button downloads (a
`download` attribute does nothing for another origin) while `<video>` ignores
the header and plays.

## 2. Switching it on (a person, ~10 minutes)

1. **Cloudflare account → R2.** R2 wants a payment method on file even for the
   free tier.
2. **Create a bucket**, e.g. `owntools-shares`. Location: *Specify
   jurisdiction → European Union* keeps the videos in the EU (it cannot be
   changed later; the S3 endpoint then has `.eu.` in it).
3. **Bucket → Settings → Object lifecycle rules.** Two rules, both needed:
   - prefix `shares/`, delete objects **31 days** after upload
     (`SHARE_TTL_DAYS` + 1). Without it an expired link stops resolving but its
     files stay forever, and the privacy page — which promises deletion — is
     wrong.
   - **abort incomplete multipart uploads after 1 day** (the default rule says
     7 — shorten it). Parts of an upload nobody finished are storage no
     listing shows and no ceiling in §3 can count; this rule is the only thing
     that sweeps them, so the shorter it is the smaller that blind spot.
4. **R2 → Manage API tokens → Create API token**: *Object Read & Write*,
   applied to that one bucket. Copy the Access Key ID, the Secret Access Key
   and the S3 endpoint shown for the bucket's jurisdiction.
5. **Vercel → project `web` → Settings → Environment Variables → Production**
   (mark the secret *Sensitive*):

   | Variable | Value | What it does |
   | --- | --- | --- |
   | `SHARE_S3_ENDPOINT` | `https://<account-id>.eu.r2.cloudflarestorage.com` | without `.eu` for a default bucket |
   | `SHARE_S3_BUCKET` | `owntools-shares` | |
   | `SHARE_S3_REGION` | `auto` | the AWS region name on S3 |
   | `SHARE_S3_ACCESS_KEY_ID` | from step 4 | |
   | `SHARE_S3_SECRET_ACCESS_KEY` | from step 4 | |
   | `SHARE_MAX_MB` | `200` | per video |
   | `SHARE_TTL_DAYS` | `30` | also what /privacy and /terms say |
   | `SHARE_MAX_TOTAL_GB` | `20` | **the bill's ceiling** (§3) |
   | `SHARE_MAX_SHARES` | `2000` | the same ceiling, counted in links |
   | `SHARE_MAX_PENDING` | `40` | uploads open at once |

   Only the first five are required; every other one has the same default in
   code. Then **redeploy** — variables reach only new deployments, and the
   privacy page and the terms are static, so they pick up the lifetime at
   build.
6. **Cloudflare → Billing → Notifications: a budget alert** at, say, $5 and
   $20. It is a mail and nothing else — Cloudflare has no spending cap — but
   with 10 GB of storage free every month, any bill at all starts small and
   visible.
7. **Vercel → Firewall.** Hobby allows exactly one rate-limit rule, and it is
   already wanted for `/api/key` and `/checkout`: extend that rule's path
   match to cover `/api/share` too, 10 requests / 60 s per IP. It is the only
   limit here that holds across instances (§3).
8. **Check**: `curl -X POST https://www.owntools.app/api/share -H
   "content-type: application/json" -d "{}"` must answer `400 bad_request`,
   not `503`. Then in the app: record → export dialog → *Share link → Create
   link*, open the copied link on a phone, press download, remove the link with
   ✕ and watch the page 404.

Not needed: a bucket CORS rule (the app uploads through its native HTTP
client), public access, `SHARE_PUBLIC_BASE`, or a custom domain — R2 custom
domains need the zone on Cloudflare, and owntools.app's DNS is at OVH.

Worth fixing on the way, but **not by flipping the primary domain**: the site
calls itself `https://owntools.app` while Vercel answers the apex with a 308 to
www, so every share link takes one extra hop. Making the apex primary would fix
it — and would also start answering Polar's webhook (registered at www) with a
redirect, which Polar counts as a failed delivery. Re-register the webhook
first or leave it alone.

## 3. What holds when someone points a script at it

The bill first, because it is the fear worth answering. **R2 charges nothing
for egress**, so the horror story — a six-figure bandwidth invoice — is an
S3/Firebase story and cannot happen here. What is left is storage at
$0.015/GB-month (10 GB free), Class A operations at $4.50/million (1M free) and
Class B at $0.36/million (10M free). Reaching even $100 a month means keeping
about 6.7 TB in the bucket. Cloudflare will not stop that on its own — budget
alerts are informational — so the stop is in the code:

| Guard | Where | What it stops |
| --- | --- | --- |
| `SHARE_MAX_TOTAL_GB` / `SHARE_MAX_SHARES` | `bucketUsage` + `fullReason`, checked before a plan is issued | the bill. Measured from the bucket's own listing (no second credential), cached, and moved by `noteUsage` between measurements so a burst inside one cache window cannot walk past it |
| `SHARE_MAX_PENDING` | same check | uploads left open, whose parts no listing shows until the 1-day abort rule |
| `SHARE_MAX_MB`, re-checked on what landed | `POST /api/share/[id]` | a presigned part URL does not bound its body |
| 30 links/hour per address, 20 creates/minute per instance | `POST /api/share` | one script, and a crowd of addresses the per-caller limit cannot see — the brake `/api/key` needed for the same reason |
| 60 media hits/minute, 60 lookups, 20 writes per address | `/v/<id>/<file>`, `/api/share/[id]` | a hammer on the parts that cost an operation and a signature each |
| `clientAddress` reads `x-vercel-forwarded-for`, then `x-real-ip`, then the **rightmost** `x-forwarded-for` | `web/lib/rateLimit.ts` | rotating a self-supplied header to mint a fresh bucket per request, which switches every limit above off |
| `allowedOrigin` — no `Access-Control-Allow-Origin: *` | `web/lib/share.ts` | any web page in the world making its visitors start uploads on our bucket. The app uses the native HTTP client, which is not a browser and does not care |
| Container check on the finished file | `looksLikeVideo` / `looksLikeJpeg` | the bucket being used as a file host: a renamed archive or installer never gets a `meta.json`, so it never becomes reachable |
| Type and disposition signed into every read URL | `serveAsFor` + `publicUrl` | what a browser is handed being decided by what an uploader managed to store |
| `timingSafeEqualHex` on owner tokens, 12-symbol ids (~2^59) | `web/lib/share.ts` | guessing a link or a take-down token |
| Control and direction marks stripped from names | `cleanName` | a download that reads `…fdp.exe` as `…exe.pdf` |
| `retries: 2` on the storage client | `client()` in `web/lib/share.ts` | aws4fetch's default of ten retries backing off ~51 s, which would hold a function open for the length of any storage wobble — the flood's own amplifier |

Two stops by hand, in order of how fast they work:

- **Roll the R2 API token** (Cloudflare → R2 → Manage API tokens). Instant, no
  deploy: signing stops, uploads and playback both stop.
- **`SHARE_UPLOADS_OFF=1`** on Vercel + redeploy. New links refused with a
  sentence the app shows; everything already shared keeps playing.

Fail-open is deliberate in one place: when the bucket listing itself fails and
nothing was ever measured, a plan is still issued. A storage wobble should not
take the feature down, and the budget alert covers the residual.

## 4. Running it

- **Takedown** (a report arrives at hello@owntools.app with the link): R2 →
  bucket → `shares/<id>/` → delete `meta.json` (the link dies at once), then
  the rest. `<id>` is the last part of the link. The person who shared it
  cannot be told — there is no account to tell.
- **Cost**: R2 storage is $0.015/GB-month with 10 GB-month, 1M writes and 10M
  reads free every month, and **no egress fees** — the reason it is R2 and not
  S3 or Vercel Blob for video. A share is ~5 writes plus one per 8 MB part; a
  view is ~3 reads plus the video's range requests. The ceiling check adds one
  listing (a few operations) now and then, not one per request.
- **Limits**: 200 MB per video (checked on what actually landed), the ceilings
  in §3, posters over 5 MB dropped, poster uploads signed to `image/jpeg`.
- **Obligations** (not legal advice): hosting other people's uploads for
  anyone with a link makes the site a hosting service under the EU DSA —
  a contact point, a way to report content (the report link on every share
  page) and terms that say what may not be shared (`/terms`, "share links").

## 5. What was verified, and what was not

**2026-09-15, end to end on this machine**: the app's real upload client
(`packages/feature-editor/src/lib/share.ts`, run in Node) → the site's real
routes under `next dev` → a stand-in bucket that checks every SigV4
signature independently (written from the AWS spec, not from aws4fetch) and
enforces R2's rule that all parts but the last are the same size. 13 checks:
a 20.5 MB three-part upload with a poster; byte-exact download and range
requests through the stable address; the redirect (302, `no-store`, 12 h
signature); `Content-Disposition` with a Polish name; HEAD; 404 for
`meta.json` / `pending.json` / another extension; page metadata with no
signature in the HTML and `summary_large_image`; 403 for a wrong owner token;
413 for a declared oversize; 403 for a tampered signature; 403 for a poster
PUT as `text/html`; 413 and a clean bucket for 26 MB pushed into a 6 MB plan;
DELETE removing every object; 429 after 30 links. The page with the landing's
real screen recording, in headless Chrome at 1440 px day and night and 390 px:
the video loads through the redirect (readyState 4), the poster through its
own.

**The guards in §3** are covered by unit tests (`share.test.ts`,
`rateLimit.test.ts`): the listing parser and the paging above it against a
stubbed `fetch`, the early stop, the cache and the booking that keeps a burst
inside one window from passing the ceiling, each ceiling naming itself, a
failed listing keeping the last reading rather than falling open, the
container checks against a zip / an executable / HTML / a PDF, the origin
allow-list, the timing-safe compare, name cleaning, and a rotated
`x-forwarded-for` resolving to one bucket.

**And end to end**, driving the real routes on a production build (`next
start`) against a stand-in bucket — 28 checks, all passing: a share published
and taken down, with `response-content-type` and `response-content-disposition`
signed into the media redirect; a zip renamed to `.mp4` refused with 415,
nothing left in the bucket and the link never resolving; 3 MB pushed into a
plan that declared 64 bytes refused with 413 and deleted; a wrong owner token
refused for both completing and removing, while the real one still works; the
pending ceiling refusing a third open upload and handing the slot back when one
finishes; a bucket seeded past `SHARE_MAX_TOTAL_GB` refusing the very first
link without writing anything; the same for `SHARE_MAX_SHARES`; and
`SHARE_UPLOADS_OFF=1` answering `sharing_paused`. The headers were checked on
the built site too: `X-Robots-Tag` on `/v/**`, and an unknown origin getting
`Vary: Origin` and **no** `Access-Control-Allow-Origin` where the webview's
origin is echoed back.

**Not yet**: real R2 (the first production share is the check — aws4fetch is
what Cloudflare's own R2 presigning examples use, and the stand-in failed a
tampered signature, so a signing mismatch is unlikely but not ruled out), and
the upload from the **native app**. The Tauri path was read, not run:
tauri-plugin-http follows the apex → www 308 with the body (reqwest keeps a
buffered body on 307/308), drops the `Authorization` header across hosts —
the owner token also travels in the DELETE body, so removal still works — and
JSON-encodes every request body: an 8 MB part becomes ~29 MB of JSON,
~0.6–0.9 s of CPU per part measured. Slower, not broken; a Rust-side part
upload taking a raw IPC body (the way `capture_put` does) is the fix if long
exports make it matter.

**Known bound, accepted**: a poster is PUT through a presigned URL that cannot
limit its size, and is only measured at completion. An upload abandoned before
completion therefore leaves a poster of any size until the 31-day rule — inside
`SHARE_MAX_TOTAL_GB`, which counts it, and inside `SHARE_MAX_PENDING`, which
counts how many can be open. Signing `content-length` into the poster URL would
close it and needs a protocol field the app does not send yet.

**Later, if wanted**: a *Share link* right after recording (today it lives in
the export dialog and renders the cut first), and a Pro-only or longer
lifetime for Pro keys — both product decisions, not needed to switch on.
