import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIza...",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "...",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "...",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "...",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "...",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "..."
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Для работы оффлайн и сохранения состояния при перезагрузке
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a a time.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support all of the features required to enable persistence");
    }
});
