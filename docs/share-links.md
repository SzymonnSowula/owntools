# Share links — a link to a video, straight from the export dialog

The short version (2026-09-15): the feature is **built and tested, and off in
production** only because no bucket is configured — `POST /api/share` on
www.owntools.app answers `503 sharing_not_configured`. The domain was never the
missing piece; storage for the videos is. Switching it on is §2: a Cloudflare
R2 bucket, one API token, one lifecycle rule and seven environment variables
on Vercel. No code change, no new desktop build — the app already has the
button and already talks to `owntools.app/api/share`.

---

## 1. What exists

| Piece | Where |
| --- | --- |
| "Share link → Create link" (renders, uploads, copies the link; Copy / Open / ✕ per link) | `packages/feature-editor/src/components/ExportModal.tsx` |
| Upload client (8 MB presigned parts, owner token kept in project.json) | `packages/feature-editor/src/lib/share.ts` |
| Step 1 — upload plan, size cap, 30 links/hour per network | `web/app/api/share/route.ts` |
| Step 2 — stitch, check what landed, publish; GET meta; DELETE with the owner token | `web/app/api/share/[id]/route.ts` |
| Player page (unlisted, noindex, previews, download, report link) | `web/app/v/[id]/page.tsx` |
| Stable media addresses → redirect to a freshly signed URL | `web/app/v/[id]/[file]/route.ts` (`/v/<id>/video.mp4`, `/v/<id>/poster.jpg`) |
| Storage, signing, config | `web/lib/share.ts` (+ `share.test.ts`) |
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
3. **Bucket → Settings → Object lifecycle rules → Add rule**: prefix
   `shares/`, delete objects **31 days** after upload (`SHARE_TTL_DAYS` + 1).
   Without it an expired link stops resolving but its files stay forever, and
   the privacy page — which promises deletion — is wrong. Keep the default
   rule that aborts unfinished multipart uploads after 7 days.
4. **R2 → Manage API tokens → Create API token**: *Object Read & Write*,
   applied to that one bucket. Copy the Access Key ID, the Secret Access Key
   and the S3 endpoint shown for the bucket's jurisdiction.
5. **Vercel → project `web` → Settings → Environment Variables → Production**
   (mark the secret *Sensitive*):

   | Variable | Value |
   | --- | --- |
   | `SHARE_S3_ENDPOINT` | `https://<account-id>.eu.r2.cloudflarestorage.com` (without `.eu` for a default bucket) |
   | `SHARE_S3_BUCKET` | `owntools-shares` |
   | `SHARE_S3_REGION` | `auto` |
   | `SHARE_S3_ACCESS_KEY_ID` | from step 4 |
   | `SHARE_S3_SECRET_ACCESS_KEY` | from step 4 |
   | `SHARE_MAX_MB` | `500` |
   | `SHARE_TTL_DAYS` | `30` |

   Then **redeploy** — variables reach only new deployments, and the privacy
   page and the terms are static, so they pick up the lifetime at build.
6. **Check**: `curl -X POST https://www.owntools.app/api/share -H
   "content-type: application/json" -d "{}"` must answer `400 bad_request`,
   not `503`. Then in the app: record → export dialog → *Share link → Create
   link*, open the copied link on a phone, press download, remove the link with
   ✕ and watch the page 404.

Not needed: a bucket CORS rule (the app uploads through its native HTTP
client), public access, `SHARE_PUBLIC_BASE`, or a custom domain — R2 custom
domains need the zone on Cloudflare, and owntools.app's DNS is at OVH.

Worth fixing on the way: the site calls itself `https://owntools.app`
(`NEXT_PUBLIC_SITE_URL` unset; the app's `SITE_URL` is the apex too), but
Vercel has www as the primary domain and answers the apex with a 308. Every
share link, preview image and API call therefore takes one extra hop, and every
canonical tag on the site points at a redirect. Making `owntools.app` the
primary domain in Vercel (www redirecting to it) fixes both and keeps links
short; `NEXT_PUBLIC_SITE_URL=https://www.owntools.app` is the other way round.

## 3. Running it

- **Takedown** (a report arrives at hello@owntools.app with the link): R2 →
  bucket → `shares/<id>/` → delete `meta.json` (the link dies at once), then
  the rest. `<id>` is the last part of the link. The person who shared it
  cannot be told — there is no account to tell.
- **Cost**: R2 storage is $0.015/GB-month with 10 GB-month, 1M writes and 10M
  reads free every month, and **no egress fees** — the reason it is R2 and not
  S3 or Vercel Blob for video. A share is ~5 writes plus one per 8 MB part; a
  view is ~3 reads plus the video's range requests. At 30 days' retention the
  free tier holds a few hundred average screen recordings at any moment.
- **Limits**: 500 MB per video (checked on what actually landed, not on what
  the app declared — a presigned part URL does not bound its body), 30 new
  links an hour per network (per server instance: a brake on a script, not a
  quota), posters over 5 MB dropped, poster uploads signed to `image/jpeg`.
- **Obligations** (not legal advice): hosting other people's uploads for
  anyone with a link makes the site a hosting service under the EU DSA —
  a contact point, a way to report content (the report link on every share
  page) and terms that say what may not be shared (`/terms`, "share links").

## 4. What was verified, and what was not

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

**Later, if wanted**: a *Share link* right after recording (today it lives in
the export dialog and renders the cut first), and a Pro-only or longer
lifetime for Pro keys — both product decisions, not needed to switch on.
