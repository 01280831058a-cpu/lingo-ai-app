import { initializeApp } from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDmM0cLvfb-_EsgH_mw8SG3xCcOW6YvFTU",
  authDomain: "appeng-cafd9.firebaseapp.com",
  projectId: "appeng-cafd9",
  storageBucket: "appeng-cafd9.firebasestorage.app",
  messagingSenderId: "562959685851",
  appId: "1:562959685851:web:45cf3c19adb27f09e1d4fe"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Кэширование для работы оффлайн
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Multiple tabs open, persistence can only be enabled in one tab at a time.");
    } else if (err.code == 'unimplemented') {
        console.warn("The current browser does not support all of the features required to enable persistence");
    }
});
