/**
 * Re-export of the hardcoded route overlay coords (read-only shared import).
 * The coords array bytes must stay identical to the Express output, so we
 * import the original rather than re-paste the polyline.
 */
export {
  jongro07Coords,
  jongro02Coords,
} from "../../../features/bus/route-overlay.data";
