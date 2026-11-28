export const NOTICES_BLOCKS_LOG_INTERVAL_MS = 60_000;

// WHY: the brief has at most three bullets, one for each of the writer's fixed questions.
export const MAX_BRIEF_BULLETS = 3;

// WHY: the version is what tells the stored brief of this pipeline from the retired one's, whose `version` was a freeze key.
export const STORED_BRIEF_VERSION = /^brief-2(?:\.|$)/;
