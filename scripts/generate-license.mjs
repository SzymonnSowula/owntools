#!/usr/bin/env node
/**
 * generate-license.mjs [count=1]
 *
 * Prints `count` fresh Pro license keys, one per line:
 *
 *     SCRN-XXXXX-XXXXX-XXXXX
 *
 * Keys are OFFLINE. The app checks format + checksum locally
 * (packages/licensing/src/license.ts) and never calls home, so there is no
 * registry of issued keys anywhere — this script does not remember what it
 * printed. Record every key you hand out in the Polar order notes (order ->
 * key) so refunds, re-sends and "I lost my key" e-mails can be answered.
 *
 * Alphabet: A–Z without I and O, digits 2–9 (32 symbols, no look-alikes).
 * Last character = checksum over the 14 payload characters:
 *   sum += index(ch) * (i % 2 === 0 ? 3 : 7);   check = alphabet[sum % 32]
 */
import { randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAYLOAD_LENGTH = 14;
const MAX_COUNT = 1000;

function checksum(payload) {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    sum += ALPHABET.indexOf(payload[i]) * (i % 2 === 0 ? 3 : 7);
  }
  return ALPHABET[sum % ALPHABET.length];
}

function generateLicenseKey() {
  let payload = "";
  for (let i = 0; i < PAYLOAD_LENGTH; i++) payload += ALPHABET[randomInt(ALPHABET.length)];
  const body = payload + checksum(payload);
  return `SCRN-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}`;
}

const arg = process.argv[2] ?? "1";
if (arg === "-h" || arg === "--help") {
  console.log("Usage: node scripts/generate-license.mjs [count=1]");
  process.exit(0);
}
const count = Number(arg);
if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
  console.error(`Usage: node scripts/generate-license.mjs [count=1]   (1–${MAX_COUNT}, got "${arg}")`);
  process.exit(1);
}
for (let i = 0; i < count; i++) console.log(generateLicenseKey());
