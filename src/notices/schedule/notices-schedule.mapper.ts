import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { NoticeScheduleItem } from "../detail/notices-detail.wire";
import type { ScheduleItem } from "./notices-schedule.schema";

export const toPlaceIds = (items: readonly ScheduleItem[]): string[] => [...new Set(items.flatMap((item) => item.place?.id ?? []))];

/** WHY: `displays` holds building's answer for each of `placeIds` at the same position, null where building names none. */
export function toScheduleItems(items: readonly ScheduleItem[], placeIds: readonly string[], displays: ReadonlyArray<PlaceDisplay | null>): NoticeScheduleItem[] {
  return items.map(({ place, ...item }) => {
    if (!place) return item;
    const display = place.id === undefined ? null : displays[placeIds.indexOf(place.id)];
    const name = display && (display.code ? `${display.name} ${display.code}` : display.name);
    return { ...item, place: { text: place.text, name: name ?? null, mapTarget: display?.mapTarget ?? null } };
  });
}
