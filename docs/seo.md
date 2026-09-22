# SEO and indexing

How the site tells search engines it exists, what has to be done once by hand,
and what to run after publishing a post.

---

## 1. What the site already does

Nothing in this section needs a person.

| Thing | Where it comes from |
| --- | --- |
| `sitemap.xml` with every public page and post | `web/app/sitemap.ts` |
| `robots.txt`, pointing at the sitemap | `web/app/robots.ts` |
| Canonical URL on every page | `metadata.alternates.canonical` per route |
| `Article` / `TechArticle` + `BreadcrumbList` + `FAQPage` structured data | `web/app/blog/[slug]/page.tsx` |
| `Blog` structured data on the index | `web/app/blog/page.tsx` |
| A social card per post, drawn at build time | `web/app/blog/[slug]/opengraph-image.tsx` |
| RSS feed | `web/app/blog/rss.xml/route.ts` |
| `noindex` on share links, `/checkout`, `/thanks`, `/api` | `robots.ts` + `next.config.ts` headers |

**The canonical host is `https://www.owntools.app`.** Vercel serves www and the
apex answers 308 to it, so the apex must never appear as a canonical, in the
sitemap or in an e-mailed link - that is a URL search engines have to follow a
redirect to reach, and it splits the signals for the page. The default in
`web/lib/site.ts` is www; if `NEXT_PUBLIC_SITE_URL` is set on the host it wins,
so check it is not pinned to the apex there.

---

## 2. One-time setup

### 2.1 Google Search Console

Google does not accept an API call that says "index this". Search Console is
the only road, so it has to exist.

1. Open [search.google.com/search-console](https://search.google.com/search-console)
   and add a **URL prefix** property for `https://www.owntools.app/`.
   (A *Domain* property covers both hosts but needs a DNS record at OVH; the
   URL prefix one is verified by a meta tag and takes a minute.)
2. Choose **HTML tag** verification. Copy only the `content="..."` value.
3. Put it on Vercel as `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` and redeploy.
4. Back in Search Console, press **Verify**.
5. **Sitemaps** in the left menu → enter `sitemap.xml` → Submit. Once. It is
   re-read on its own from then on.

### 2.2 Bing Webmaster Tools

Bing is worth ten minutes because it feeds ChatGPT search and DuckDuckGo, and
because its index is far easier to enter than Google's.

1. [bing.com/webmasters](https://www.bing.com/webmasters) → **Import from
   Google Search Console** (carries the verification and the sitemap across),
   or verify separately with `NEXT_PUBLIC_BING_SITE_VERIFICATION`.
2. Confirm the sitemap is listed under **Sitemaps**.

### 2.3 IndexNow

Already set up in the repository: `web/public/<key>.txt` is the key file, and
the protocol is that an engine fetches it and expects the key back. Nothing to
configure - it works from the first deploy that includes that file.

---

## 3. Asking for indexing after you publish

### 3.1 One command, for everything except Google

```bash
pnpm seo:indexnow
```

Submits the home page, the blog and every post to IndexNow, which is shared by
**Bing, Yandex, Seznam and Naver**. It checks each URL answers 200 and that the
key file is live before it sends anything, because submitting a 404 is worse
than submitting nothing.

```bash
pnpm seo:indexnow --blog                    # the blog and the posts only
pnpm seo:indexnow /blog/a-new-post          # one page
pnpm seo:indexnow --dry-run                 # print, send nothing
```

In Git Bash, give a single page its whole URL instead of a path. MSYS rewrites
a leading slash into a Windows path, so `pnpm seo:indexnow /` arrives as
`C:/Program Files/Git/` - the reachability check catches it, but the error
reads like a broken site rather than a broken argument.

Run it **after the deploy is live**, not before. Submitting the same unchanged
pages over and over is counted against you; once per publish is the idea.

### 3.2 Google, by hand

Google ignores IndexNow. For a page you want looked at today:

1. Search Console → the search box at the top (**URL Inspection**).
2. Paste the full URL, `https://www.owntools.app/blog/...`.
3. Wait for the check, then **Request indexing**.

There is a daily quota of roughly a dozen requests, which is plenty for a post
at a time. Requesting the same URL repeatedly does nothing and does not move it
up a queue. Everything else Google finds through the sitemap and through links
from pages it already knows - which is why the blog is linked from the home
page nav, the home page footer and the legal pages, not only from the sitemap.

### 3.3 What does not work, so nobody wastes an afternoon on it

- **Google's Indexing API** only accepts `JobPosting` and `BroadcastEvent`
  pages. Using it for an article is against its terms and does nothing.
- **"Instant indexing" services and ping URLs.** The old
  `google.com/ping?sitemap=` endpoint was retired; the rest are selling the
  Search Console button back to you.
- **Submitting a page that is not live yet.** The crawl is what counts, and a
  404 or a redirect on the first visit is the impression that sticks.

---

## 4. What to expect

A new domain with no links is not indexed slowly because of a technical
problem - it is indexed slowly because nothing points at it. Realistically:

- **Bing / IndexNow**: hours to a few days.
- **Google, requested by hand**: usually days, sometimes the same day.
- **Google, left to the sitemap**: weeks, and some pages simply sit in
  "Discovered - currently not indexed" until the site has more standing.

The lever that changes this is not a setting. It is the posts being linked to
from places that already have readers, and the posts being worth linking to.

---

## 5. Adding a post

### What belongs here

A post answers a question somebody types **while having a problem one of the
tools solves**. That is the whole filter, and it is stricter than it sounds:

- ✅ "how do I transcribe an interview without uploading it" - they want the
  free transcription tool, they just do not know it exists.
- ✅ "screen recording that zooms in automatically on Windows" - Screen Studio
  is macOS only, and that is exactly what screeni does.
- ❌ "why did Windows delete my files permanently" - a real question, genuinely
  under-answered, and completely useless to us: that person wants their files
  back, not a desktop app. Interesting to write is not the same as worth
  ranking for.

The second failure mode is writing up an engineering story because we happen to
have the details. It reads well, it earns a few developer links, and it brings
no one who would ever download the app. If a post cannot name the tool a reader
would want by the end of it, it belongs on the drafts pile, not the blog.

### The three files

Three files, and the suite fails if they disagree (`web/lib/blog.test.ts`):

1. `web/lib/blog.ts` - an entry in `POSTS`: slug, title, description, the
   `answer`, tags, `schema`, and the FAQ.
2. `web/app/blog/posts/<slug>.tsx` - the body, a default-exported component.
3. `web/app/blog/bodies.ts` - `"<slug>": Component`.

Then:

```bash
pnpm blog:minutes     # measures the post and writes the reading time back
pnpm test web/lib/blog.test.ts
```

House rules the tests enforce, because they are the ones that are easy to let
slip:

- **The answer comes first.** `answer` is the whole point of the post in one or
  two sentences, it opens the page, and it has to make sense quoted on its own -
  it may be all a reader (or an AI answer) ever shows.
- **A post that names owntools carries a `<Disclosure>`.** An article that turns
  out to have been an advert costs more trust than the click was worth.
- **Hyphens, not em dashes**, in anything the reader sees.
- Description 80-165 characters; FAQ answers 120-900, each one able to stand
  without the page around it.

---

## 6. Checking your work

```bash
pnpm --dir web build && pnpm --dir web exec next start -p 3026
```

- Structured data: [Rich Results Test](https://search.google.com/test/rich-results)
  and the [schema.org validator](https://validator.schema.org/) - paste the
  rendered HTML for a local build, or the URL once deployed.
- The social card: open `/blog/<slug>/opengraph-image` directly.
- The feed: `/blog/rss.xml` should parse and close.
- The sitemap: `/sitemap.xml` - every `<loc>` on `www`, none of them a redirect.
