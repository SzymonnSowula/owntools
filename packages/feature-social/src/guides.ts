import type { NetworkId } from "./types";

/**
 * How to get the credential, written out. Every network hides its token in a
 * different drawer, and "Create a free developer app, enable OAuth 2.0 and
 * add the redirect URL" — the note we used to show — is only readable by
 * someone who has done it before.
 *
 * A guide is numbered steps, each with an optional button that opens the
 * exact page and an optional value to copy (the redirect URL, the scopes).
 * `minutes` is there so nobody starts a fifteen-minute developer-portal
 * detour thinking it is a two-field form.
 */

export interface SetupStep {
  text: string;
  /** Opens the page this step happens on. */
  link?: { label: string; url: string };
  /** A value the step needs pasted elsewhere; `REDIRECT` becomes the loopback URL. */
  copy?: { label: string; value: string };
}

export interface SetupGuide {
  /** Honest estimate for someone who has never done it. */
  minutes: number;
  /** What the last step leaves on the clipboard. */
  yields: string;
  steps: SetupStep[];
}

/** Placeholder replaced with the running server's OAuth redirect. */
export const REDIRECT = "__REDIRECT__";

const SCOPES: Partial<Record<NetworkId, string>> = {
  x: "tweet.read tweet.write users.read offline.access media.write",
  linkedin: "openid profile w_member_social",
};

const GUIDES: Partial<Record<NetworkId, SetupGuide>> = {
  bluesky: {
    minutes: 1,
    yields: "an app password (four groups of four characters)",
    steps: [
      {
        text: "Open Bluesky settings → Privacy and security → App passwords.",
        link: { label: "Open app passwords", url: "https://bsky.app/settings/app-passwords" },
      },
      { text: "Add an app password, name it “owntools”, and copy it." },
      { text: "Paste it here together with your handle. Your real password never leaves Bluesky." },
    ],
  },
  mastodon: {
    minutes: 2,
    yields: "an authorisation code from your instance",
    steps: [
      { text: "Type your instance below — mastodon.social, pol.social, your own server." },
      { text: "Press Sign in with the browser. owntools registers itself on that instance; no developer account, no forms." },
      { text: "Approve it in the browser, then copy the code the page shows and paste it back here." },
    ],
  },
  telegram: {
    minutes: 3,
    yields: "a bot token, then the channel you want it to post to",
    steps: [
      {
        text: "Write to @BotFather on Telegram and send /newbot. He asks for a name, then a username, and answers with a token.",
        link: { label: "Open @BotFather", url: "https://t.me/BotFather" },
      },
      { text: "Paste the token below — it looks like 123456789:AA…" },
      { text: "Add the bot to your channel or group as an administrator (Manage → Administrators → Add)." },
      { text: "Press Find my chats and pick it from the list, or type @yourchannel yourself." },
    ],
  },
  discord: {
    minutes: 1,
    yields: "a webhook URL",
    steps: [
      { text: "In Discord: right-click the channel → Edit Channel → Integrations → Webhooks." },
      { text: "New Webhook → Copy Webhook URL." },
      { text: "Paste it below. That URL is the whole connection — nothing else to fill in." },
    ],
  },
  slack: {
    minutes: 3,
    yields: "an incoming webhook URL",
    steps: [
      {
        text: "Create a Slack app for your workspace (From scratch is fine).",
        link: { label: "Open Slack apps", url: "https://api.slack.com/apps" },
      },
      { text: "Features → Incoming Webhooks → turn it on → Add New Webhook to Workspace, pick the channel." },
      { text: "Copy the webhook URL and paste it below. Slack webhooks post text only." },
    ],
  },
  mattermost: {
    minutes: 2,
    yields: "an incoming webhook URL",
    steps: [
      { text: "Main menu → Integrations → Incoming Webhooks → Add Incoming Webhook." },
      { text: "Pick the channel, save, and copy the URL." },
      { text: "Paste it below." },
    ],
  },
  devto: {
    minutes: 1,
    yields: "an API key",
    steps: [
      {
        text: "Dev.to → Settings → Extensions → DEV Community API Keys.",
        link: { label: "Open Dev.to API keys", url: "https://dev.to/settings/extensions" },
      },
      { text: "Generate a key named “owntools” and copy it." },
      { text: "Paste it below. Posts go out as articles written from your Markdown." },
    ],
  },
  medium: {
    minutes: 2,
    yields: "an integration token",
    steps: [
      {
        text: "Medium → Settings → Security and apps → Integration tokens.",
        link: { label: "Open Medium settings", url: "https://medium.com/me/settings/security" },
      },
      { text: "Create a token and copy it." },
      { text: "Paste it below. Medium stopped issuing tokens to some newer accounts — if the page has no such section, that is why." },
    ],
  },
  x: {
    minutes: 10,
    yields: "an OAuth 2.0 Client ID",
    steps: [
      {
        text: "Sign in to the X developer portal and create a free project + app (any name).",
        link: { label: "Open the X developer portal", url: "https://developer.x.com/en/portal/dashboard" },
      },
      { text: "In the app: User authentication settings → Set up. App permissions = Read and write, Type of App = Native App (public client)." },
      { text: "Paste this as the Callback URI / Redirect URL:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Website URL can be anything you own — https://owntools.app works." },
      { text: "Save, then copy the OAuth 2.0 Client ID from the Keys and tokens tab into the field below.", copy: { label: "Scopes X asks for", value: SCOPES.x! } },
      { text: "Press Sign in with the browser and approve the app for your own account." },
    ],
  },
  linkedin: {
    minutes: 12,
    yields: "a Client ID and a Client Secret",
    steps: [
      {
        text: "Create an app in the LinkedIn developer portal. It has to be attached to a LinkedIn Page you administer (a page for yourself is fine).",
        link: { label: "Open LinkedIn developers", url: "https://www.linkedin.com/developers/apps" },
      },
      { text: "Products tab → request Sign In with LinkedIn using OpenID Connect and Share on LinkedIn. Both are granted automatically." },
      { text: "Auth tab → Authorized redirect URLs → add:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Copy the Client ID and Client Secret from the same tab into the fields below.", copy: { label: "Scopes", value: SCOPES.linkedin! } },
      { text: "Press Sign in with the browser and approve it." },
    ],
  },
  reddit: {
    minutes: 5,
    yields: "a client id (and secret for a web app)",
    steps: [
      {
        text: "Reddit → preferences → apps → create another app. Type: installed app.",
        link: { label: "Open Reddit apps", url: "https://www.reddit.com/prefs/apps" },
      },
      { text: "Redirect uri:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Copy the id shown under the app name into the field below." },
    ],
  },
  threads: {
    minutes: 15,
    yields: "an app id and secret from Meta",
    steps: [
      {
        text: "Create an app at developers.facebook.com, use case “Threads API”.",
        link: { label: "Open Meta developers", url: "https://developers.facebook.com/apps/" },
      },
      { text: "Add the Threads API product, then Threads → Settings → Redirect callback URLs:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Add yourself as a Threads tester and accept the invite in your Threads account settings." },
      { text: "Copy the app id and secret below." },
    ],
  },
  instagram: {
    minutes: 20,
    yields: "an app id and secret from Meta",
    steps: [
      { text: "Instagram publishing needs a Business or Creator account linked to a Facebook Page.", link: { label: "Open Meta developers", url: "https://developers.facebook.com/apps/" } },
      { text: "Create an app with the Instagram Graph API product and add the redirect URL:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Copy the app id and secret below." },
    ],
  },
  facebook: {
    minutes: 20,
    yields: "an app id and secret from Meta",
    steps: [
      { text: "Create an app with the Facebook Login and Pages products.", link: { label: "Open Meta developers", url: "https://developers.facebook.com/apps/" } },
      { text: "Add the redirect URL:", copy: { label: "Redirect URL", value: REDIRECT } },
      { text: "Copy the app id and secret below." },
    ],
  },
  hashnode: {
    minutes: 2,
    yields: "a personal access token",
    steps: [
      { text: "Hashnode → Settings → Developer → Generate new token.", link: { label: "Open Hashnode developer settings", url: "https://hashnode.com/settings/developer" } },
      { text: "Copy the token and paste it below, with your publication's host (yourname.hashnode.dev)." },
    ],
  },
  ghost: {
    minutes: 3,
    yields: "an Admin API key",
    steps: [
      { text: "Ghost admin → Settings → Integrations → Add custom integration." },
      { text: "Copy the Admin API key (id:secret) and the API URL." },
      { text: "Paste both below." },
    ],
  },
  wordpress: {
    minutes: 3,
    yields: "an application password",
    steps: [
      { text: "WordPress admin → Users → Profile → Application Passwords." },
      { text: "Add one named “owntools” and copy it." },
      { text: "Paste it below with your site URL and username." },
    ],
  },
  lemmy: {
    minutes: 1,
    yields: "your instance, username and password",
    steps: [
      { text: "Lemmy has no developer app: owntools signs in the same way the website does." },
      { text: "Fill in your instance URL, username and password below." },
    ],
  },
};

/**
 * The guide for a network, with `REDIRECT` swapped for the loopback URL the
 * agent server answers on (null while it is still starting).
 */
export function guideFor(id: NetworkId, redirect: string | null): SetupGuide | null {
  const guide = GUIDES[id];
  if (!guide) return null;
  const url = redirect ?? "starting the local server…";
  return {
    ...guide,
    steps: guide.steps.map((s) => (s.copy?.value === REDIRECT ? { ...s, copy: { ...s.copy, value: url } } : s)),
  };
}

/** "about a minute" / "about 10 minutes" — for the header of the connect form. */
export function effortLabel(minutes: number): string {
  if (minutes <= 1) return "about a minute";
  if (minutes <= 3) return `about ${minutes} minutes`;
  return `about ${minutes} minutes, most of it on their website`;
}
