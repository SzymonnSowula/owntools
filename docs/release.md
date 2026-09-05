# Releasing shipshape

How a version gets from this repo onto a user's PC, and how the app updates
itself afterwards. Everything below assumes the public repo
`SzymonnSowula/shipshape` — if the name ever differs, fix the updater endpoint
first (see *One-time setup*).

**The flow in one line:** bump version → commit → push tag `vX.Y.Z` →
`.github/workflows/release.yml` builds the NSIS installer on `windows-latest`,
signs the updater artifact, and uploads installer + `.sig` + `latest.json` to a
**draft** GitHub release → you test the installer → publish → installed apps
pick the update up from `…/releases/latest/download/latest.json`.

## One-time setup

### 1. Create the repo and push

There is no git remote yet.

```powershell
gh repo create SzymonnSowula/shipshape --public --source . --remote origin --push
# or by hand:
git remote add origin https://github.com/SzymonnSowula/shipshape.git
git push -u origin master
```

CI (`.github/workflows/ci.yml`) runs on every push and PR: typecheck + vitest +
`next build` on Ubuntu, `cargo check` on Windows.

### 2. Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value | Required |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `C:\Users\szymo\.tauri\shipshape.key` (generated 2026-09-01 with `pnpm tauri signer generate`, **no password**). | yes |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty — the key has no password. The workflow passes an empty string when the secret is missing, so you can also skip it. | no |
| `WINDOWS_CERTIFICATE` | Base64 of a code-signing PFX. Without it the installer is built unsigned. | no |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password of that PFX (leave out if the PFX has none). | no |

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY < C:\Users\szymo\.tauri\shipshape.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
# optional, only once you have a certificate:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\cert.pfx")) | gh secret set WINDOWS_CERTIFICATE
gh secret set WINDOWS_CERTIFICATE_PASSWORD
```

The matching **public** key is already in
`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and the
endpoint there is
`https://github.com/SzymonnSowula/shipshape/releases/latest/download/latest.json`.
Change the endpoint if the repo name differs — an installed app only ever asks
that URL.

> **Back the private key up** (password manager, offline copy). If it is lost,
> no future build can be signed with the key existing installs trust: the
> updater rejects the new `latest.json`, and every user has to reinstall by hand
> from a build that carries a new public key. `*.key` is git-ignored on purpose.

## Windows code signing — the options

Unsigned installers work, but SmartScreen shows "Windows protected your PC /
Unknown publisher" and the user has to click *More info → Run anyway*.
Reputation for an unsigned file is per file hash, so every release starts from
zero. Realistic options for a Polish solo developer:

- **OV code-signing certificate** (Organization Validation; a sole trader /
  JDG qualifies — you validate against CEIDG + ID). **Certum** (Asseco, Polish
  CA) is the natural pick: Polish support, PLN invoices, and a cheaper
  *Open Source Code Signing* tier — but that one only applies if the repo
  carries an OSI licence. Alternatives: SSL.com, DigiCert, Sectigo, GlobalSign.
  Since **June 2023** the CA/B Forum requires the private key to live on
  certified hardware (FIPS 140-2 L2 / CC EAL4+): you get a USB token / smart
  card, or use the CA's cloud signing (Certum SimplySign, SSL.com eSigner,
  DigiCert KeyLocker). Plain exportable `.pfx` files are no longer issued.
  That matters for the workflow: the built-in `WINDOWS_CERTIFICATE` path
  assumes a PFX. With a token or cloud HSM you instead set
  `bundle.windows.signCommand` in `tauri.conf.json` to the provider's signing
  CLI (or sign on a self-hosted Windows runner with the token plugged in).
  Budget roughly €100–300 / year plus the token; expect a few days of validation.
- **Azure Trusted Signing** — Microsoft-issued short-lived certificates,
  ~$10/month, well trusted by SmartScreen, signs from CI via
  `azure/trusted-signing-action` + `signCommand`. The catch is eligibility:
  organisations need ~3 years of verifiable history, and *individual* validation
  has been limited to a few countries. Check the current rules before planning
  around it.
- **EV certificate** — more expensive and stricter vetting; historically gave
  instant SmartScreen reputation, but that advantage has been shrinking. Not
  worth it at this stage.

Whatever you sign with, **reputation still builds over time**: an OV-signed
publisher sees warnings for the first days/weeks of installs, then they stop.
Always timestamp (the workflow uses `http://timestamp.digicert.com`) so
signatures outlive the certificate.

## Local builds

`bundle.createUpdaterArtifacts` is on, so **every** `tauri build` (not just CI)
needs the updater private key in the environment or it stops with "A public key
has been found, but no private key":

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "C:\Users\szymo\.tauri\shipshape.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm --filter desktop tauri build
```

The build then also writes `…_x64-setup.exe.sig` next to the installer.
From Git Bash pass the key **contents** instead — `TAURI_SIGNING_PRIVATE_KEY="$(cat
~/.tauri/shipshape.key)"` — because the CLI does not understand `/c/Users/...`
POSIX paths in `TAURI_SIGNING_PRIVATE_KEY_PATH`.

## Cutting a release

```powershell
node scripts/bump-version.mjs 0.2.0          # all package.json files, tauri.conf.json, Cargo.toml
cd apps/desktop/src-tauri; cargo check; cd ../../..   # refreshes Cargo.lock
# add the 0.2.0 entry to web/lib/changelog.ts
git add -A
git commit -m "v0.2.0"
git push
git tag v0.2.0
git push --tags                               # (or: git push origin v0.2.0)
```

What happens next:

1. The tag triggers `release.yml`. tauri-action reads the version from
   `tauri.conf.json` and targets the release/tag `v__VERSION__` — so the tag you
   push **must** equal that version, or the assets land on a different release.
2. Artifacts: `shipshape_0.2.0_x64-setup.exe`, its `.sig`, and `latest.json`
   (the NSIS installer *is* the updater artifact in Tauri 2). They are attached
   to a **draft** release "shipshape v0.2.0".
3. Download the draft installer and test it on a machine (or VM) that does not
   have the dev toolchain: install, run, activate a licence key, record, dictate.
   Also install the previous public version and confirm it offers the update.
4. **Publish** the release. Only a published, non-prerelease release resolves
   under `/releases/latest/...` — that is the moment the updater starts
   offering it (the app checks on launch, `apps/desktop/src/shell/updater.ts`,
   and installs passively).
5. Landing: `NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS` must point at the installer,
   e.g. `https://github.com/SzymonnSowula/shipshape/releases/latest/download/shipshape_0.2.0_x64-setup.exe`.
   The asset name carries the version, so this URL changes every release —
   update the env var (Vercel → redeploy) unless it already points at a
   `/releases/latest/download/...` URL for the current file. Pointing it at
   `…/releases/latest` (the release page) is the zero-maintenance fallback at
   the cost of one extra click.

Manual run: *Actions → Release → Run workflow* builds the current branch into a
draft named after the version in `tauri.conf.json` — handy for a release
candidate without a tag.

## Testing an update locally

The updater trusts one URL and one public key, so a local test means building
two versions against a local endpoint.

1. In `tauri.conf.json` temporarily set
   `plugins.updater.endpoints = ["http://localhost:8787/latest.json"]` and add
   `"dangerousInsecureTransportProtocol": true` next to it (plain `http` is
   refused otherwise). **Do not commit this.**
2. Export the signing key for the CLI and build the *current* version, then
   install it:
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content C:\Users\szymo\.tauri\shipshape.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   pnpm --filter desktop tauri build
   # installer: apps/desktop/src-tauri/target/release/bundle/nsis/shipshape_<version>_x64-setup.exe
   ```
3. Bump to a higher version (`node scripts/bump-version.mjs 0.2.1`), build
   again, and copy the new `…_x64-setup.exe` and `…_x64-setup.exe.sig` into an
   empty folder together with a hand-written `latest.json`:
   ```json
   {
     "version": "0.2.1",
     "notes": "local update test",
     "pub_date": "2026-09-01T12:00:00Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<paste the contents of the .sig file>",
         "url": "http://localhost:8787/shipshape_0.2.1_x64-setup.exe"
       }
     }
   }
   ```
4. Serve that folder — `npx serve -l 8787 .` or `python -m http.server 8787` —
   and launch the installed older build. It should show the update banner,
   download, verify the signature and relaunch as 0.2.1.
5. Revert the endpoint, the insecure-transport flag and the version bump
   (`git checkout -- apps/desktop/src-tauri/tauri.conf.json` etc.).

## Launch-day checklist

- [ ] Release published (not draft), `https://github.com/SzymonnSowula/shipshape/releases/latest/download/latest.json` resolves and lists the right version.
- [ ] Installed from the public download link on a clean Windows machine; SmartScreen behaviour known and documented on the landing/FAQ.
- [ ] Landing env vars set on the host (currently read in `web/app`; grep `NEXT_PUBLIC_` for the live list):
  - `NEXT_PUBLIC_CHECKOUT_URL` — Polar checkout link for the lifetime licence
  - `NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS` — installer URL (see above)
  - `NEXT_PUBLIC_SITE_URL` — canonical origin (sitemap, robots, OG)
  - contact e-mail, Plausible domain and the X profile URL, if the landing reads them from env by then
- [ ] Polar product live: price, licence-key delivery text, refund policy. Keys come from `node scripts/generate-license.mjs <n>` — they are offline, nothing tracks them, so paste each issued key into the order's notes.
- [ ] Test purchase end to end (Polar sandbox → key → activate in the app → watermark gone).
- [ ] Changelog entry for the version live on the landing; sitemap includes the new pages.
- [ ] Plausible receiving events from the production domain.
- [ ] Private key and certificate backed up; secrets confirmed in the repo.
- [ ] Announcement queued (X, Product Hunt/launch post) with the download link, not the release page.
