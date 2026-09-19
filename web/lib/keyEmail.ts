/**
 * The two e-mails this site sends, as plain functions: data in, subject + text
 * + HTML out. No images, no tracking, nothing loaded from anywhere - the mail
 * of a product whose whole pitch is that it leaves you alone. The plain-text
 * part is the real e-mail; the HTML is the same words with the key in a box.
 *
 * Written so that nobody has to write back: what the key is, where it goes,
 * what happens on a new computer, where to get it again, how to get a refund.
 */

export interface MailLinks {
  /** Canonical origin, no trailing slash. */
  site: string;
  contact: string;
  /** Absolute download links; either may be missing. */
  downloadWindows?: string;
  downloadMac?: string;
  refundDays: number;
}

export interface PurchaseMailInput extends MailLinks {
  key: string;
  /** /thanks for this checkout - shows the key again. Missing when the order has no checkout id. */
  thanksUrl?: string;
}

export interface RecoveredKey {
  key: string;
  /** YYYY-MM-DD the order was made. */
  bought: string;
}

export interface RecoveryMailInput extends MailLinks {
  keys: RecoveredKey[];
}

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const link = (href: string, label = href): string => `<a href="${esc(href)}" style="color:#0a84ff">${esc(label)}</a>`;

function installLine(l: MailLinks): { text: string; html: string } {
  const parts = [
    l.downloadWindows ? { label: "Windows", href: l.downloadWindows } : null,
    l.downloadMac ? { label: "macOS", href: l.downloadMac } : null,
  ].filter((p): p is { label: string; href: string } => p !== null);
  if (parts.length === 0) return { text: `Install owntools: ${l.site}`, html: `Install owntools: ${link(l.site)}` };
  return {
    text: `Install owntools: ${parts.map((p) => `${p.label} ${p.href}`).join("  ·  ")}`,
    html: `Install owntools: ${parts.map((p) => link(p.href, p.label)).join(" · ")}`,
  };
}

function keyBox(key: string): string {
  return `<div style="margin:16px 0;padding:16px 18px;border-radius:12px;background:#1d1d1f;color:#f5f5f7;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;line-height:1.6;word-break:break-all">${esc(key)}</div>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="margin:0;padding:24px 16px;background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Arial,sans-serif;font-size:15px;line-height:1.6"><div style="max-width:560px;margin:0 auto;padding:28px 28px 24px;border-radius:16px;background:#ffffff">${body}<p style="margin:28px 0 0;color:#6e6e73;font-size:13px">owntools - your work. your device.</p></div></body></html>`;
}

const p = (html: string): string => `<p style="margin:0 0 14px">${html}</p>`;

/** The steps and the small print both e-mails share. */
function howTo(l: MailLinks): { text: string[]; html: string } {
  const install = installLine(l);
  return {
    text: [
      `1. ${install.text}`,
      "2. Open Settings -> License, paste the key and press Activate.",
      "3. That is it. The key is checked on your computer: it works offline, never expires and covers every update.",
      "",
      "One key covers one computer at a time. New computer? Paste the same key there - there is nothing to transfer.",
    ],
    html:
      `<ol style="margin:0 0 14px;padding-left:20px"><li>${install.html}</li><li>Open <b>Settings → License</b>, paste the key and press <b>Activate</b>.</li><li>That is it. The key is checked on your computer: it works offline, never expires and covers every update.</li></ol>` +
      p("One key covers one computer at a time. New computer? Paste the same key there - there is nothing to transfer."),
  };
}

export function purchaseEmail(input: PurchaseMailInput): Mail {
  const steps = howTo(input);
  const recover = `${input.site}/key`;
  const refunds = `${input.site}/refunds`;

  const text = [
    "Thank you for buying owntools Pro. This is your key:",
    "",
    input.key,
    "",
    ...steps.text,
    "",
    "Keep this e-mail - it is your copy of the key.",
    ...(input.thanksUrl ? [`The page you saw after paying shows it too: ${input.thanksUrl}`] : []),
    `Lost both one day? ${recover} sends the key to this address again.`,
    "",
    `Not for you? You have ${input.refundDays} days to get your money back: ${refunds}`,
    "Anything else: just reply to this e-mail.",
    "",
    "owntools - your work. your device.",
  ].join("\n");

  const html = page(
    "Your owntools Pro key",
    p("Thank you for buying owntools Pro. This is your key:") +
      keyBox(input.key) +
      steps.html +
      p(
        `Keep this e-mail - it is your copy of the key.${
          input.thanksUrl ? ` ${link(input.thanksUrl, "The page you saw after paying")} shows it too.` : ""
        } Lost both one day? ${link(recover, recover.replace(/^https?:\/\//, ""))} sends the key to this address again.`,
      ) +
      p(`Not for you? You have ${input.refundDays} days to ${link(refunds, "get your money back")}. Anything else: just reply to this e-mail.`),
  );

  return { subject: "Your owntools Pro key", text, html };
}

export function recoveryEmail(input: RecoveryMailInput): Mail {
  const steps = howTo(input);
  const many = input.keys.length > 1;
  const intro = many
    ? `You asked for your owntools Pro keys at ${input.site.replace(/^https?:\/\//, "")}/key. There are ${input.keys.length} orders under this address:`
    : `You asked for your owntools Pro key at ${input.site.replace(/^https?:\/\//, "")}/key. Here it is:`;
  const unasked =
    "Did not ask for this? Then someone typed your address into the form. Nothing else happened: the key is only ever sent here, to the address that paid.";

  const text = [
    intro,
    "",
    ...input.keys.flatMap((k) => (many ? [`Bought ${k.bought}:`, k.key, ""] : [k.key, ""])),
    ...steps.text,
    "",
    unasked,
    "Anything else: just reply to this e-mail.",
    "",
    "owntools - your work. your device.",
  ].join("\n");

  const html = page(
    many ? "Your owntools Pro keys" : "Your owntools Pro key",
    p(esc(intro)) +
      input.keys.map((k) => (many ? p(`<span style="color:#6e6e73">Bought ${esc(k.bought)}</span>`) : "") + keyBox(k.key)).join("") +
      steps.html +
      p(esc(unasked)) +
      p("Anything else: just reply to this e-mail."),
  );

  return { subject: many ? "Your owntools Pro keys, again" : "Your owntools Pro key, again", text, html };
}
