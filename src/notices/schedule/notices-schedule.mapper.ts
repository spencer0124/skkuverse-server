import type { PlaceDisplay } from "../../building/place/display/building-place-display.types";
import type { NoticeScheduleItem } from "../notices.wire";
import { toOccurrences, toTimelineMinute } from "./notices-schedule.rules";
import type { ScheduleItem } from "./notices-schedule.schema";

type StoredEntry = ScheduleItem | NonNullable<ScheduleItem["parts"]>[number];
type ServedEntry = Omit<NoticeScheduleItem, "parts">;
interface PlaceNames { placeIds: readonly string[]; displays: ReadonlyArray<PlaceDisplay | null> }

export const toPlaceIds = (items: readonly ScheduleItem[]): string[] => [...new Set(items.flatMap((item) => [item, ...(item.parts ?? [])]).flatMap((entry) => entry.place?.id ?? []))];

function toServedPlace(place: NonNullable<ScheduleItem["place"]>, { placeIds, displays }: PlaceNames): NonNullable<NoticeScheduleItem["place"]> {
  const display = place.id === undefined ? null : displays[placeIds.indexOf(place.id)];
  const name = display && (display.code ? `${display.name} ${display.code}` : display.name);
  return { text: place.text, name: name ?? null, mapTarget: display?.mapTarget ?? null };
}

// WHY: `evidence` stays in storage until the app shows it; the detail serves the rest with its occurrences.
function toServedEntry({ place, evidence: _evidence, parts: _parts, ...entry }: StoredEntry, names: PlaceNames): ServedEntry {
  return { ...entry, ...(place && { place: toServedPlace(place, names) }), ...toOccurrences(entry) };
}

/** WHY: `displays` holds building's answer for each of `placeIds` at the same position, null where building names none. */
export function toScheduleItems(items: readonly ScheduleItem[], placeIds: readonly string[], displays: ReadonlyArray<PlaceDisplay | null>): NoticeScheduleItem[] {
  const names = { placeIds, displays };
  return items
    .map((item) => ({ item, minute: toTimelineMinute(item) }))
    .sort((a, b) => a.minute - b.minute)
    .map(({ item }) => ({ ...toServedEntry(item, names), ...(item.parts && { parts: item.parts.map((part) => toServedEntry(part, names)) }) }));
}
