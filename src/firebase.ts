import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// СЮДА НУЖНО ВСТАВИТЬ КОНФИГУРАЦИЮ ИЗ ВАШЕГО FIREBASE ПРОЕКТА
// (Project Settings -> General -> Your apps -> Firebase SDK snippet -> Config)
// Пока настроек нет, приложение будет выдавать предупреждения в консоль, 
// но код адаптирован под то, чтобы вы могли легко его добавить.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDmM0cLvfb-_EsgH_mw8SG3xCcOW6YvFTU",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "appeng-cafd9.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "appeng-cafd9",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "appeng-cafd9.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "562959685851",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:562959685851:web:45cf3c19adb27f09e1d4fe"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);

// Инициализация сервисов (База данных и Авторизация)
export const db = getFirestore(app);
export const auth = getAuth(app);
