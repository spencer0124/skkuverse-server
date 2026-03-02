const admin = require("./firebase");
const config = require("./config");

const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10000;

// Evict expired entries every 5 minutes to prevent unbounded growth
const _cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache) {
    if (now - value.time >= CACHE_TTL) tokenCache.delete(key);
  }
}, CACHE_TTL);
_cleanupInterval.unref(); // don't block process exit

/**
 * Verify Firebase idToken from Authorization header.
 * Sets req.uid on success. If no token is provided or Firebase
 * is not configured, continues without uid (rate limiter falls back to req.ip).
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  // Firebase not configured — skip verification, pass through
  if (!config.firebase.serviceAccount) {
    return next();
  }

  const idToken = authHeader.split("Bearer ")[1];

  // Check cache first
  const cached = tokenCache.get(idToken);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    req.uid = cached.uid;
    return next();
  }

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    if (tokenCache.size >= MAX_CACHE_SIZE) tokenCache.clear();
    tokenCache.set(idToken, { uid: decoded.uid, time: Date.now() });
    next();
  } catch {
    return res.error(401, "AUTH_INVALID", "Invalid auth token");
  }
}

module.exports = verifyToken;
