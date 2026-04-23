import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// СЮДА НУЖНО ВСТАВИТЬ КОНФИГУРАЦИЮ ИЗ ВАШЕГО FIREBASE ПРОЕКТА
// (Project Settings -> General -> Your apps -> Firebase SDK snippet -> Config)
// Пока настроек нет, приложение будет выдавать предупреждения в консоль, 
// но код адаптирован под то, чтобы вы могли легко его добавить.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSy_YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "your-project-id.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "your-project-id",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "your-project-id.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "123456789",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:123456789:web:abcdef"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);

// Инициализация сервисов (База данных и Авторизация)
export const db = getFirestore(app);
export const auth = getAuth(app);
