import { ObjectId } from "mongodb";
import { getEventsCollection } from "./ad.data";
import type { AdEventType, Placement } from "./types";

// adId 문자열은 호출자(ad.routes.ts)에서 24-hex regex로 미리 검증됨. 무효한
// 값이 여기까지 도달하면 `new ObjectId(adId)`가 throw — fail-loud로 위쪽 핸들러
// 에서 500을 만들도록 의도적으로 try/catch 없이 그대로 둠.
async function recordEvent(
  placement: Placement,
  event: AdEventType,
  adId: string | null,
): Promise<void> {
  const col = getEventsCollection();
  const doc = {
    adId: adId ? new ObjectId(adId) : null,
    placement,
    event,
    impressionId: null,
    timestamp: new Date(),
  };
  await col.insertOne(doc);
}

export { recordEvent };
