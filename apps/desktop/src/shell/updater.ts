/**
 * The updater lives in @core/updater since Settings → About got a "Check for
 * updates" button (packages cannot import from apps); this keeps the shell's
 * import path.
 */
export { checkForUpdate, checkForUpdateDetailed, type AvailableUpdate, type UpdateCheck } from "@core/updater";
