import type { StyleId } from "../types";
import type { LaunchStyleDef } from "../style";
import { deskStyle } from "./desk";
import { noirStyle } from "./noir";
import { editorialStyle } from "./editorial";
import { terminalStyle } from "./terminal";
import { auroraStyle } from "./aurora";
import { posterStyle } from "./poster";

/** The style library, in the order the picker shows them. */
export const STYLES: LaunchStyleDef[] = [
  deskStyle,
  auroraStyle,
  noirStyle,
  editorialStyle,
  terminalStyle,
  posterStyle,
];

export function styleById(id: StyleId): LaunchStyleDef {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

export { deskStyle, noirStyle, editorialStyle, terminalStyle, auroraStyle, posterStyle };
