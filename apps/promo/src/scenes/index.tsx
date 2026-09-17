/**
 * Scene registry: the cut table names a scene, this maps the name to the
 * component. Every scene gets its frame range and the end-card props.
 */
import type { ComponentType } from "react";
import type { SceneFrames, SceneId } from "../cut";
import { Dictate } from "./Dictate";
import { Screeni } from "./Screeni";
import { Focus } from "./Focus";
import { Meet } from "./Meet";
import { Board } from "./Board";
import { Social } from "./Social";
import { Disk } from "./Disk";
import { Capture } from "./Capture";
import { Quick } from "./Quick";
import { Promise } from "./Promise";
import { End } from "./End";

export interface SceneProps {
  scene: SceneFrames;
  priceLine: string;
  site: string;
}

export const SCENES: Record<SceneId, ComponentType<SceneProps>> = {
  dictate: Dictate,
  screeni: Screeni,
  focus: Focus,
  meet: Meet,
  board: Board,
  social: Social,
  disk: Disk,
  capture: Capture,
  quick: Quick,
  promise: Promise,
  end: End,
};
