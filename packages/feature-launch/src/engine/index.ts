/**
 * The launch-video engine: URL/brief → a Remotion composition that renders and
 * exports identically in the desktop app and on the web.
 */

export * from "./types";
export * from "./brand";
export * from "./take";
export * from "./script";
export * from "./style";
export * from "./layout";
export { LaunchVideo, type LaunchVideoProps } from "./LaunchVideo";
export { STYLES, styleById } from "./styles";
export { compositionFor, renderLaunchVideo, exportFileName, type RenderOptions } from "./render";
export { defaultLaunchInput } from "./defaults";
