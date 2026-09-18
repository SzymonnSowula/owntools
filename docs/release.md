# Releasing owntools

How a version gets from this repo onto a user's PC, and how the app updates
itself afterwards. Everything below assumes the public repo
`SzymonnSowula/owntools` — if the name ever differs, fix the updater endpoint
first (see *One-time setup*).

**The flow in one line:** bump version → commit → push tag `vX.Y.Z` →
`.github/workflows/release.yml` builds the NSIS installer on `windows-latest`
and a universal `.dmg` on `macos-14`, signs the updater artifacts, and uploads
them + `latest.json` to a **draft** GitHub release → you test the installers →
publish → installed apps pick the update up from
`…/releases/latest/download/latest.json`.

The companion doc is **`docs/macos.md`**: the Mac specifics (Apple
certificates, the permissions macOS asks for, what still needs verifying on
real hardware).

## One-time setup

### 1. The repo

`SzymonnSowula/owntools` is public since 2026-09-17 (AGPL-3.0; the README says
what is in it) and `origin` points at it. Installers never go into the tree: a
release's assets live on the GitHub release the workflow drafts (below), which
is also where the updater looks. Public repo = free Actions minutes, macOS
runners included.

CI (`.github/workflows/ci.yml`) runs on every push and PR: typecheck + vitest +
`next build` on Ubuntu, `cargo check` on Windows.

### 2. Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Value | Required |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of `$HOME\.tauri\owntools.key` (generated 2026-09-01 with `pnpm tauri signer generate`, **no password**). | yes |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Empty — the key has no password. The workflow passes an empty string when the secret is missing, so you can also skip it. | no |
| `WINDOWS_CERTIFICATE` | Base64 of a code-signing PFX. Without it the installer is built unsigned. | no |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password of that PFX (leave out if the PFX has none). | no |
| `APPLE_CERTIFICATE` | Base64 of a Developer ID Application `.p12`. Without it the macOS build is unsigned, and a downloaded `.dmg` opens with *"owntools is damaged"*. | for macOS |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12`. | with the above |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)`. | with the above |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | Notarization. `APPLE_PASSWORD` is an **app-specific** password from appleid.apple.com, never the account password. | for macOS |

The macOS job is **opt-in**: it only runs when the repository variable
`MACOS_RELEASE` is `true` (Settings → Secrets and variables → Actions →
Variables). An unsigned `.dmg` opens as "damaged", so the switch stays off until
the Apple secrets above exist; without it a release is Windows only and
`latest.json` lists only `windows-x86_64`.

```powershell
gh secret set TAURI_SIGNING_PRIVATE_KEY < $HOME\.tauri\owntools.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body ""
# optional, only once you have a certificate:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\cert.pfx")) | gh secret set WINDOWS_CERTIFICATE
gh secret set WINDOWS_CERTIFICATE_PASSWORD
```

The matching **public** key is already in
`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`, and the
endpoint there is
`https://github.com/SzymonnSowula/owntools/releases/latest/download/latest.json`.
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

## macOS signing — the short version

Full detail in `docs/macos.md`; what matters at release time:

- The macOS job runs **after** the Windows one. `latest.json` is a single
  release asset that tauri-action merges platform by platform, and two jobs
  writing it at once lose one of them.
- It builds `--target universal-apple-darwin`, so one `.dmg` covers Apple
  Silicon and Intel and `latest.json` gets both `darwin-aarch64` and
  `darwin-x86_64` pointing at the same `.app.tar.gz`.
- **Unsigned is not shippable on macOS.** Windows shows a warning you can
  click past; macOS says *"owntools is damaged and can't be opened"*, which
  reads as malware. The Apple Developer Program is $99/yr and it is the
  difference between a product and a curiosity. Until then testers need
  `xattr -dr com.apple.quarantine /Applications/owntools.app`, and that
  belongs on the download page, not in a support e-mail.
- macOS has no whisper build yet (upstream has never published one). Run
  *Actions → whisper.cpp for macOS* once and paste the three constants it
  prints into `models.ts`; until then Mac users get Parakeet, which is the
  faster dictation engine, and the file/subtitle tools say they are
  unavailable rather than failing.

## Local builds

`bundle.createUpdaterArtifacts` is on, so **every** `tauri build` (not just CI)
needs the updater private key in the environment or it stops with "A public key
has been found, but no private key":

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$HOME\.tauri\owntools.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
pnpm --filter desktop tauri build
```

The build then also writes `…_x64-setup.exe.sig` next to the installer.
From Git Bash pass the key **contents** instead — `TAURI_SIGNING_PRIVATE_KEY="$(cat
~/.tauri/owntools.key)"` — because the CLI does not understand `/c/Users/...`
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
2. Artifacts: `owntools_0.2.0_x64-setup.exe` + `.sig` (the NSIS installer *is*
   the updater artifact in Tauri 2), `owntools_0.2.0_universal.dmg`,
   `owntools.app.tar.gz` + `.sig`, and one merged `latest.json`. All attached
   to a **draft** release "owntools v0.2.0".
3. Download the draft installers and test each on a machine (or VM) that does
   not have the dev toolchain: install, run, activate a licence key, record,
   dictate. On a Mac, work `docs/macos.md` §7 — the port is compiled and
   unit-tested but has never run on Apple hardware.
   Also install the previous public version and confirm it offers the update.
4. **Publish** the release. Only a published, non-prerelease release resolves
   under `/releases/latest/...` — that is the moment the updater starts
   offering it (the app checks on launch and on Settings → About → Check for
   updates, `packages/core/src/updater.ts`, and installs passively).
5. Landing: `NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS` and
   `NEXT_PUBLIC_DOWNLOAD_URL_MACOS` must point at the installer and the `.dmg`,
   e.g. `https://github.com/SzymonnSowula/owntools/releases/latest/download/owntools_0.2.0_x64-setup.exe`.
   The asset name carries the version, so this URL changes every release —
   update the env var (Vercel → redeploy) unless it already points at a
   `/releases/latest/download/...` URL for the current file. Pointing it at
   `…/releases/latest` (the release page) is the zero-maintenance fallback at
   the cost of one extra click.

Manual run: *Actions → Release → Run workflow* builds the current branch into a
draft named after the version in `tauri.conf.json` — handy for a release
candidate without a tag.

## Releasing from this machine

The workflow is the normal road; this is the one taken when it cannot run
(no `TAURI_SIGNING_PRIVATE_KEY` in the repo yet, a runner outage). It makes
the same assets by hand - 0.3.0 shipped this way on 2026-09-18.

1. `node scripts/bump-version.mjs x.y.z`, `cargo check` in `src-tauri`, a
   changelog entry, commit, push.
2. Build with the updater key in the environment (Git Bash; the value is the
   file's contents, `_PATH` is not read):
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/owntools.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   pnpm --filter desktop tauri build
   ```
   → `apps/desktop/src-tauri/target/release/bundle/nsis/owntools_x.y.z_x64-setup.exe` + `.sig`.
3. Write `latest.json` by hand (the shape is in *Testing an update locally*
   below): `version`, `notes`, `pub_date`, and under `platforms.windows-x86_64`
   the `.sig` file's contents as `signature` and
   `https://github.com/SzymonnSowula/owntools/releases/download/vx.y.z/owntools_x.y.z_x64-setup.exe`
   as `url`. Only the platforms you built - a Mac entry pointing at nothing
   would make every Mac fail its update check.
4. Draft, check, publish:
   ```bash
   gh release create vx.y.z --draft --title "owntools vx.y.z" --notes-file notes.md owntools_x.y.z_x64-setup.exe owntools_x.y.z_x64-setup.exe.sig latest.json
   gh release edit vx.y.z --draft=false --latest
   ```
   Publishing creates the tag, which starts `release.yml`; without the
   secret that run fails at its first step and changes nothing on the release.
   With the secret it rebuilds and replaces the assets with the CI-built,
   identically signed ones.

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
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $HOME\.tauri\owntools.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   pnpm --filter desktop tauri build
   # installer: apps/desktop/src-tauri/target/release/bundle/nsis/owntools_<version>_x64-setup.exe
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
         "url": "http://localhost:8787/owntools_0.2.1_x64-setup.exe"
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

- [ ] Release published (not draft), `https://github.com/SzymonnSowula/owntools/releases/latest/download/latest.json` resolves and lists the right version.
- [ ] Installed from the public download link on a clean Windows machine; SmartScreen behaviour known and documented on the landing/FAQ.
- [ ] Installed from the public `.dmg` on a Mac that has never seen the app; Gatekeeper behaviour known and documented (`docs/macos.md`).
- [ ] Landing env vars set on the host (currently read in `web/app`; grep `NEXT_PUBLIC_` for the live list):
  - `NEXT_PUBLIC_CHECKOUT_URL` — Polar checkout link for the lifetime licence
  - `NEXT_PUBLIC_DOWNLOAD_URL_WINDOWS` — installer URL (see above)
  - `NEXT_PUBLIC_DOWNLOAD_URL_MACOS` — the universal `.dmg`; unset, the Mac button says "launching soon" instead of lying
  - `NEXT_PUBLIC_SITE_URL` — canonical origin (sitemap, robots, OG)
  - contact e-mail, Plausible domain and the X profile URL, if the landing reads them from env by then
- [ ] Polar product live: price, licence-key delivery text, refund policy. Buyers' keys are signed on `/thanks` from the Polar order (`web/lib/licenseKey.ts`); `pnpm license:generate <n>` signs gift keys — nothing tracks them, so note where each one went.
- [ ] Test purchase end to end (Polar sandbox → key → activate in the app → the locked tools open).
- [ ] Changelog entry for the version live on the landing; sitemap includes the new pages.
- [ ] Plausible receiving events from the production domain.
- [ ] Private key and certificate backed up; secrets confirmed in the repo.
- [ ] Announcement queued (X, Product Hunt/launch post) with the download link, not the release page.
