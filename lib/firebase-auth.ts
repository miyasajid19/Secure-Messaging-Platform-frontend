"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  isSignInWithEmailLink,
  RecaptchaVerifier,
  signInWithEmailLink,
  type Auth,
} from "firebase/auth";

let firebaseApp: FirebaseApp | null = null;
let recaptchaVerifier: RecaptchaVerifier | null = null;

function getFirebaseAuth(): Auth {
  if (!firebaseApp) {
    const config = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
    };
    const missing = ["apiKey", "authDomain", "projectId", "appId"].filter(
      (key) => !config[key as keyof typeof config],
    );
    if (missing.length) throw new Error("Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* settings to the frontend environment.");
    firebaseApp = getApps().length ? getApp() : initializeApp(config);
  }
  return getAuth(firebaseApp);
}

/** Browser provides only Firebase's required anti-abuse reCAPTCHA proof.
 * The backend uses it to request the SMS and verifies the code with Firebase.
 */
export async function getPhoneAuthRecaptchaToken(containerId: string): Promise<string> {
  recaptchaVerifier?.clear();
  const verifier = new RecaptchaVerifier(getFirebaseAuth(), containerId, { size: "invisible" });
  recaptchaVerifier = verifier;
  try {
    await verifier.render();
    return await verifier.verify();
  } finally {
    verifier.clear();
    if (recaptchaVerifier === verifier) recaptchaVerifier = null;
  }
}

export function firebasePhoneError(error: unknown): string {
  return error instanceof Error ? error.message : "Phone verification failed.";
}

/** Complete a Firebase email link and return its signed Firebase ID token.
 * The app backend validates that token before issuing its own session JWT.
 */
export async function completeFirebaseEmailLink(email: string, link: string): Promise<string> {
  const auth = getFirebaseAuth();
  if (!isSignInWithEmailLink(auth, link)) throw new Error("This is not a valid Firebase email sign-in link.");
  const credential = await signInWithEmailLink(auth, email, link);
  return credential.user.getIdToken();
}
