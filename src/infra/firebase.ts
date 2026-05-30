import admin from "firebase-admin";
import config from "./config";
import logger from "./logger";

if (config.firebase.serviceAccount && !config.isTest) {
  try {
    const serviceAccount = JSON.parse(
      config.firebase.serviceAccount,
    ) as admin.ServiceAccount;
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: message },
      "[firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT — Firebase auth will be unavailable",
    );
    if (config.isProduction) {
      throw err;
    }
  }
}

export = admin;
