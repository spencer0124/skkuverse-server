const admin = require("firebase-admin");
const config = require("./config");
const logger = require("./logger");

if (config.firebase.serviceAccount && !config.isTest) {
  try {
    const serviceAccount = JSON.parse(config.firebase.serviceAccount);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (err) {
    logger.error({ err: err.message }, "[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT — Firebase auth will be unavailable");
  }
}

module.exports = admin;
