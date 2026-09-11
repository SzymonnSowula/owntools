/**
 * Brand voice — one Markdown document at `<AppData>/social/voice.md`.
 *
 * It is the place every agent reads how this person sounds before writing
 * a word: `get_brand_voice` / `set_brand_voice` over MCP, the
 * `owntools://social/voice` resource, and the `plan_a_week` prompt all
 * point here, and the composer's model-backed "fit to each network" passes
 * it along. Editable in social → Settings. The store owns reading and
 * writing; this module is the file name and the empty-state template.
 */

export const VOICE_FILE = "voice.md";

/** What the Settings editor shows as a placeholder and `get_brand_voice` returns as a hint when the file is empty. */
export const VOICE_TEMPLATE = `# Brand voice

## Who is speaking
One person building owntools, writing as themselves. First person, present tense.

## Tone
Plain, specific, unhurried. Name what the thing does and what it protects; never who the reader is.

## Always
- Say the concrete thing (a number, a file name, what changed) over the adjective.
- One idea per post. Links at the end.
- Lowercase product names: owntools, screeni, dictate.

## Never
- No "makers / founders / people who ship".
- No exclamation marks, no emoji strings, no hashtags beyond #buildinpublic.
- No claims we have not measured.

## Examples that sound right
- "Dictation took 5 s because the model loaded on every take. Now it stays resident: 0.7 s."
- "Everything you record stays on your device. No cloud, no account."
`;

export function voiceIsEmpty(markdown: string | null | undefined): boolean {
  return !markdown || !markdown.trim();
}

/** Word count for the Settings card — a voice doc that is one line long is a hint, not a voice. */
export function voiceWords(markdown: string): number {
  return markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
}
