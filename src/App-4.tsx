/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, PlayCircle, Settings, Plus, X, CheckCircle2, XCircle, 
  ArrowRight, Brain, Type, FlipHorizontal, Check, Loader2, 
  BookOpen, Trash2, FolderPlus, ArrowLeft, Edit3, AlertTriangle, RefreshCw,
  LogOut, Wand2, GraduationCap, Download, Mail, Calendar, RotateCcw, Info,
  ChevronLeft, ChevronRight, UploadCloud, Sparkles, User as UserIcon, Search,
  Volume2, VolumeX, ArrowDown, ArrowUp, Clock, Tag
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, 
  signOut, deleteUser, User, createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail,
  EmailAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, getDoc } from 'firebase/firestore';

export interface Example { text: string; translation: string; }
export interface Word {
  id: string; original: string; translation: string; cambridgeTranslation: string;
  transcriptionUK: string; transcriptionUS: string; examples: Example[];
  groupIds: string[]; createdAt: number; correctAnswers: number;
  incorrectAnswers: number; masteryLevel: number; partOfSpeech?: string;
  translationOptions?: string[]; relatedWords?: any[];
  lastPracticed?: number;
}
export interface Group { id: string; name: string; }
export const LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate", "Upper-Intermediate", "Advanced"];

const translateAuthError = (code: string) => {
   switch(code) {
       case 'auth/user-not-found': return 'Аккаунт с таким email не найден.';
       case 'auth/wrong-password': return 'Неверный пароль.';
       case 'auth/email-already-in-use': return 'Этот email уже используется.';
       case 'auth/invalid-email': return 'Некорректный email адрес.';
       case 'auth/weak-password': return 'Пароль слишком простой (нужно минимум 6 символов).';
       case 'auth/invalid-credential': return 'Неверные данные для входа. Проверьте почту и пароль.';
       case 'auth/invalid-login-credentials': return 'Неверные данные для входа. Проверьте почту и пароль.';
       case 'auth/missing-email': return 'Пожалуйста, укажите email.';
       case 'auth/popup-closed-by-user': return 'Вход был отменен.';
       default: return 'Произошла ошибка. Попробуйте еще раз.';
   }
};

class ApiClient {
  static BASE_URL = '/.netlify/functions';
  static audioCache = new Map<string, string>();
  static autoTtsEnabled = typeof window !== 'undefined' ? localStorage.getItem('autoTtsEnabled') !== 'false' : true;

  static async playTTS(text: string) {
     if (typeof window !== 'undefined' && localStorage.getItem('soundEnabled') === 'false') return;
     try {
        const safeText = (text || '').toLowerCase().trim();
        if (!safeText) return;
        
        let src = this.audioCache.get(safeText);
        if (!src) {
           const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tts', text: safeText }) });
           if (!res.ok) throw new Error('TTS Error');
           const data = await res.json();
           if (data.audio) { src = data.audio; this.audioCache.set(safeText, src); }
        }
        if (src) {
           const a = new Audio(src);
           a.volume = 1.0;
           a.play().catch(()=>{});
        }
     } catch(e) { console.error('TTS Error', e); }
  }

  static async playAutoTTS(text: string) {
      if (!this.autoTtsEnabled) return;
      return this.playTTS(text);
  }

  static async aiGenerateWord(word: string, level?: string): Promise<Partial<Word>> {
    const safeWord = (word || '').toLowerCase().trim();
    const cacheRef = doc(db, 'global_dictionary', safeWord);
    const cacheSnap = await getDoc(cacheRef);
    if (cacheSnap.exists()) return cacheSnap.data() as Partial<Word>;

    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'translate', word: safeWord, level }) });
      if (!res.ok) throw new Error('API Error'); 
      const data = await res.json();
      if (data.original) await setDoc(doc(db, 'global_dictionary', (data.original || '').toLowerCase().trim()), data);
      return data;
    } catch(e) { return { translationOptions: [`${safeWord} (Ошибка ИИ)`], examples: [] }; }
  }

  static async aiGenerateBatchDistractors(words: any[]): Promise<any[]> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'batch_distractors', words }) });
      if (!res.ok) throw new Error('API Error'); 
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  }

  static async aiCheckSentence(word: string, sentence: string): Promise<{ isCorrect: boolean, feedback: string }> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check', word, sentence }) });
      if (!res.ok) throw new Error('API Error'); return await res.json();
    } catch(e) { return { isCorrect: false, feedback: 'Ошибка проверки ИИ.' }; }
  }

  static async aiRegenerateExample(word: string, level?: string): Promise<Example> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'example', word, level }) });
      if (!res.ok) throw new Error('API Error'); return await res.json();
    } catch(e) { return { text: "Network error", translation: "Ошибка сети" }; }
  }

  static async aiGenerateWordsList(topic: string, count: number, text?: string, level?: string): Promise<any[]> {
     try {
       const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate_words', topic, count, text, level }) });
       if (!res.ok) throw new Error('API Error'); 
       const data = await res.json();
       return Array.isArray(data) ? data : [];
     } catch(e) { return []; }
  }
}

export class SoundManager {
  static enabled = typeof window !== 'undefined' ? localStorage.getItem('soundEnabled') !== 'false' : true;
  static play(type: 'correct' | 'wrong' | 'finish' | 'menu' | 'click') {
    if (!this.enabled) return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'click') {
         osc.type = 'sine'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
         gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
         osc.start(now); osc.stop(now + 0.05);
      } else if (type === 'menu') {
         osc.type = 'sine'; osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
         gain.gain.setValueAtTime(0.05, now); gain.gain.linearRampToValueAtTime(0, now + 0.1);
         osc.start(now); osc.stop(now + 0.1);
      } else if (type === 'correct') {
         osc.type = 'sine'; osc.frequency.setValueAtTime(523.25, now); osc.frequency.setValueAtTime(659.25, now + 0.1);
         gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.3);
         osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'wrong') {
         osc.type = 'sine'; osc.frequency.setValueAtTime(350, now); osc.frequency.setValueAtTime(250, now + 0.15);
         gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
         osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'finish') {
         osc.type = 'sine'; osc.frequency.setValueAtTime(440, now); osc.frequency.setValueAtTime(554.37, now + 0.08); osc.frequency.setValueAtTime(659.25, now + 0.16); osc.frequency.setValueAtTime(880, now + 0.24);
         gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.15, now + 0.05); gain.gain.setValueAtTime(0.15, now + 0.24); gain.gain.exponentialRampToValueAtTime(0.001, now + 1.04);
         osc.start(now); osc.stop(now + 1.04);
      }
    } catch(e) {}
  }
}

export const getEffectiveMastery = (word: Partial<Word>) => {
    if (!word) return 0;
    const rawMastery = word.masteryLevel || 0;
    if (!word.lastPracticed) return rawMastery;
    const diffMs = Date.now() - word.lastPracticed;
    const weeksPassed = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
    if (weeksPassed < 1) return rawMastery;
    const decay = 10 + (weeksPassed - 1) * 5;
    return Math.max(0, rawMastery - decay);
};

const updateDailyProgress = async (uid: string, minutes: number) => {
   const today = new Date().toISOString().split('T')[0];
   const profileRef = doc(db, 'users', uid, 'profile', 'data');
   const snap = await getDoc(profileRef);
   if (!snap.exists()) return;
   const data = snap.data();
   const activity = data.activity || {};
   activity[today] = (activity[today] || 0) + minutes;
   let streak = data.streak || 0;
   const goal = data.dailyGoal || 15;
   const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
   if (activity[today] >= goal && (!data.lastGoalDate || data.lastGoalDate !== today)) {
       streak = (data.lastGoalDate === yesterday) ? streak + 1 : 1;
       await updateDoc(profileRef, { activity, streak, lastGoalDate: today });
   } else { await updateDoc(profileRef, { activity }); }
};

const loadPdfJs = async () => {
    if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
    return new Promise((resolve) => {
       const script = document.createElement('script');
       script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
       script.onload = () => {
          (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
          resolve((window as any).pdfjsLib);
       };
       document.head.appendChild(script);
    });
};

// UI Components
function AlertModal({ title, message, type='error', onClose }: any) {
   return (
       <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10 w-full max-w-sm text-center">
              {type === 'error' ? <XCircle className="w-14 h-14 text-[#FCA5A5] mx-auto mb-4"/> : type === 'success' ? <CheckCircle2 className="w-14 h-14 text-[#4ADE80] mx-auto mb-4"/> : <Info className="w-14 h-14 text-sky-400 mx-auto mb-4"/>}
              <h2 className="text-2xl font-black mb-2 text-stone-900">{title}</h2>
              <p className="text-stone-600 font-bold mb-8">{message}</p>
              <button onClick={onClose} className="w-full py-4 bg-[#FDE047] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Понятно</button>
           </motion.div>
       </div>
   )
}

function ConfirmModal({ title, message, onConfirm, onClose }: any) {
   return (
       <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10 w-full max-w-sm text-center">
              <AlertTriangle className="w-14 h-14 text-[#FCA5A5] mx-auto mb-4"/>
              <h2 className="text-2xl font-black mb-2 text-stone-900">{title}</h2>
              <p className="text-stone-600 font-bold mb-8">{message}</p>
              <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Отмена</button>
                  <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-4 bg-[#FCA5A5] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Да, точно</button>
              </div>
           </motion.div>
       </div>
   )
}

function AuthScreen() {
   const [view, setView] = useState<'login'|'register'|'forgot'>('login');
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [name, setName] = useState('');
   const [loading, setLoading] = useState(false);
   const [alertData, setAlertData] = useState<{title:string, message:string, type:'error'|'success'}|null>(null);
   const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);

   const handleGoogle = async () => { 
      try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
      catch(e:any) { if (e.code !== 'auth/popup-closed-by-user') setAlertData({title: "Ошибка", message: translateAuthError(e.code), type: 'error'}); } 
   };
   
   const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault(); setLoading(true);
      try {
         if (view === 'login') {
            const res = await signInWithEmailAndPassword(auth, email, password);
            if (!res.user.emailVerified) { setAlertData({title:"Почта не подтверждена", message: "Мы отправили вам новое письмо.", type:'error'}); await sendEmailVerification(res.user); }
         } else if (view === 'register') {
            const res = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(res.user, { displayName: name });
            await sendEmailVerification(res.user);
            setAlertData({title:"Успех", message:"Регистрация успешна! Проверьте вашу почту.", type:'success'});
         } else if (view === 'forgot') {
            await sendPasswordResetEmail(auth, email);
            setAlertData({title:"Успех", message: "Инструкции отправлены на почту.", type: 'success'}); setView('login');
         }
      } catch(e:any) { 
         if (view === 'login' && (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials')) { setShowRegisterPrompt(true); } 
         else { setAlertData({title:"Ошибка", message: translateAuthError(e.code), type: 'error'}); }
      }
      setLoading(false);
   };

   return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#FEFDF8]">
        {alertData && <AlertModal title={alertData.title} message={alertData.message} type={alertData.type} onClose={()=>setAlertData(null)} />}
        
        {showRegisterPrompt && (
           <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
               <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setShowRegisterPrompt(false)} />
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10 w-full max-w-sm text-center">
                  <UserIcon className="w-14 h-14 text-stone-900 mx-auto mb-4"/>
                  <h2 className="text-2xl font-black mb-2 text-stone-900">Аккаунт не найден</h2>
                  <p className="text-stone-600 font-bold text-sm mb-6">Хотите создать новый аккаунт с этим email?</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => { setShowRegisterPrompt(false); setView('register'); }} className="w-full py-4 bg-[#4ADE80] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Создать аккаунт</button>
                      <button onClick={() => setShowRegisterPrompt(false)} className="w-full py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Отмена</button>
                  </div>
               </motion.div>
           </div>
        )}
        <div className="bg-white p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] w-full max-w-sm flex flex-col items-center">
           <h1 className="text-5xl font-black mb-2 text-center text-stone-900 tracking-tight">Фрогги <span className="text-4xl">🐸</span></h1>
           <p className="text-stone-600 font-bold text-center mb-8">Изучай слова играя!</p>
           <form onSubmit={handleSubmit} className="w-full space-y-4">
              {view === 'register' && <input required value={name} onChange={e=>setName(e.target.value)} type="text" placeholder="Ваше имя" className="w-full bg-white px-4 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold" />}
              <input required value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" className="w-full bg-white px-4 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold" />
              {view !== 'forgot' && <input required value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Пароль" className="w-full bg-white px-4 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold" />}
              <button type="submit" disabled={loading} className="w-full py-4 mt-4 bg-[#4ADE80] border-2 border-stone-900 text-stone-900 font-black text-lg rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50">
                 {loading ? <Loader2 className="animate-spin mx-auto w-6 h-6"/> : view === 'login' ? 'Войти' : view === 'register' ? 'Зарегистрироваться' : 'Восстановить пароль'}
              </button>
           </form>
           <div className="w-full flex justify-between items-center mt-6 text-sm font-black">
              {view !== 'forgot' ? (
                 <><button onClick={()=>setView(view==='login'?'register':'login')} className="text-stone-600 hover:text-stone-900">{view === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт?'}</button>
                 {view === 'login' && <button onClick={()=>setView('forgot')} className="text-[#F9A8D4] hover:text-[#EC4899] drop-shadow-sm">Забыли пароль?</button>}</>
              ) : (<button onClick={()=>setView('login')} className="text-stone-600 mx-auto w-full text-center hover:text-stone-900">Вернуться</button>)}
           </div>
           {view !== 'forgot' && (
              <><div className="w-full border-t-2 border-dashed border-stone-200 my-8"></div>
                 <button onClick={handleGoogle} className="w-full py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-center gap-3"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" /> Войти через Google</button></>
           )}
        </div>
      </div>
   );
}

export default function AppWrapper() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, u => setUser(u)), []);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const btn = target.closest('button');
      const clickableCard = target.closest('.clickable-card');
      if (btn) {
         const sound = btn.getAttribute('data-sound');
         if (sound === 'none') return;
         if (sound) SoundManager.play(sound as any);
         else SoundManager.play('click');
      } else if (clickableCard) { SoundManager.play('click'); }
    };
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center bg-[#FEFDF8]"><Loader2 className="w-12 h-12 animate-spin text-[#4ADE80]" /></div>;
  if (!user) return <AuthScreen />;
  if (!user.emailVerified && user.providerData && user.providerData.length > 0 && user.providerData[0]?.providerId === 'password') {
     return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#FEFDF8] text-center"><Mail className="w-20 h-20 text-[#FDE047] drop-shadow-md mb-6"/><h2 className="text-3xl font-black mb-4 text-stone-900">Подтвердите Email</h2><p className="text-stone-600 font-bold mb-8">Письмо отправлено на {user.email}. Подтвердите почту и обновите страницу.</p><button onClick={()=>signOut(auth)} className="px-8 py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Выйти</button></div>;
  }
  return <MainApp user={user} />;
}

function MainApp({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'dict' | 'groups' | 'train' | 'progress' | 'settings'>('dict');
  const [words, setWords] = useState<Word[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  const [soundEnabled, setSoundEnabled] = useState(SoundManager.enabled);
  const [autoTts, setAutoTts] = useState(ApiClient.autoTtsEnabled);
  const [sortOrder, setSortOrder] = useState<'newest'|'oldest'|'alphaAsc'|'alphaDesc'|'pos'>('newest');
  
  const [appAlert, setAppAlert] = useState<{title:string, message:string, type?:'error'|'success'|'info'}|null>(null);
  const [appConfirm, setAppConfirm] = useState<{title:string, message:string, onConfirm:()=>void}|null>(null);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [dictSearch, setDictSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  useEffect(() => {
    const unsubWords = onSnapshot(collection(db, 'users', user.uid, 'words'), snap => setWords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Word))));
    const unsubGroups = onSnapshot(collection(db, 'users', user.uid, 'groups'), snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group))));
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid, 'profile', 'data'), snap => {
       if (snap.exists()) { const data = snap.data(); setUserProfile(data); if(data.level) localStorage.setItem('userLevel', data.level); } 
       else { setUserProfile({ level: 'Intermediate', onboarded: false, dailyGoal: 15, activity: {}, streak: 0 }); }
       setIsDataLoaded(true);
    });
    return () => { unsubWords(); unsubGroups(); unsubProfile(); };
  }, [user.uid]);

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  
  const [showAddWord, setShowAddWord] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [viewingWordId, setViewingWordId] = useState<string | null>(null);
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [showBulkAddGroup, setShowBulkAddGroup] = useState(false);
  const [showSmartSelection, setShowSmartSelection] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const [activeTrainingMode, setActiveTrainingMode] = useState<'flashcards'|'quiz'|'sentence'|'constructor'|'brainstorm'|'stats'|null>(null);
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });
  const [trainingSnapshot, setTrainingSnapshot] = useState<Word[]>([]);
  const [trainingStartTime, setTrainingStartTime] = useState(0);

  const startTraining = (mode: 'flashcards'|'quiz'|'sentence'|'constructor'|'brainstorm') => {
      let selectedSet = new Set(selectedWordIds);
      words.forEach(w => { if ((w.groupIds || []).some(id => selectedGroupIds.has(id))) selectedSet.add(w.id); });
      const wordsForTrain = Array.from(selectedSet).map(id => words.find(w => w.id === id)).filter(Boolean) as Word[];
      if(wordsForTrain.length === 0) return;
      setTrainingSnapshot(wordsForTrain); setActiveTrainingMode(mode); setSessionStats({correct: 0, total: 0}); setTrainingStartTime(Date.now());
  };

  const closeTraining = async () => {
      if (trainingStartTime > 0) {
          const minutesSpent = Math.ceil((Date.now() - trainingStartTime) / 60000);
          await updateDailyProgress(user.uid, minutesSpent);
      }
      setActiveTrainingMode(null);
  };

  const deleteWords = (ids: string[]) => { ids.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'words', id))); const newSelected = new Set(selectedWordIds); ids.forEach(id => newSelected.delete(id)); setSelectedWordIds(newSelected); };
  const resetProgress = (ids: string[]) => { ids.forEach(id => updateDoc(doc(db, 'users', user.uid, 'words', id), { correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0, lastPracticed: Date.now() })); setSelectedWordIds(new Set()); };
  const resetAllProgress = () => { setAppConfirm({title:"Сбросить прогресс?", message:"Начать всё с чистого листа?", onConfirm: () => { words.forEach(w => updateDoc(doc(db, 'users', user.uid, 'words', w.id), { correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0, lastPracticed: Date.now() })); }}); };
  const resetEntireDictionary = async () => { setAppConfirm({title:"Внимание!", message:"Это удалит ВСЕ слова и папки навсегда! Ты уверен?", onConfirm: async () => { words.forEach(w => deleteDoc(doc(db, 'users', user.uid, 'words', w.id))); groups.forEach(g => deleteDoc(doc(db, 'users', user.uid, 'groups', g.id))); await updateDoc(doc(db, 'users', user.uid, 'profile', 'data'), { activity: {}, streak: 0 }); }}); };

  const handleUpdateProgress = (wordId: string, isCorrect: boolean, mode: string = 'general') => {
    setSessionStats(s => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    const word = words.find(w => w.id === wordId); if (!word) return;
    if (mode === 'sentence' && isCorrect) return; 
    const effectiveMastery = getEffectiveMastery(word);
    let newMastery = effectiveMastery + (isCorrect ? 20 : -10);
    if (newMastery > 100) newMastery = 100; if (newMastery < 0) newMastery = 0;
    updateDoc(doc(db, 'users', user.uid, 'words', wordId), { correctAnswers: (word.correctAnswers || 0) + (isCorrect ? 1 : 0), incorrectAnswers: (word.incorrectAnswers || 0) + (!isCorrect ? 1 : 0), masteryLevel: newMastery, lastPracticed: Date.now() });
  };

  const deleteGroup = (groupId: string) => {
    deleteDoc(doc(db, 'users', user.uid, 'groups', groupId));
    words.forEach(w => { if ((w.groupIds || []).includes(groupId)) updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: (w.groupIds || []).filter(id => id !== groupId) }); });
  };

  const handleDeleteAccount = async () => {
    const isGoogleAuth = user.providerData.some(p => p.providerId === 'google.com');
    if (isGoogleAuth) {
       setAppConfirm({title: "Удаление", message: "Действие необратимо.", onConfirm: async () => { try { const provider = new GoogleAuthProvider(); await reauthenticateWithPopup(user, provider); words.forEach(w => deleteDoc(doc(db, 'users', user.uid, 'words', w.id))); groups.forEach(g => deleteDoc(doc(db, 'users', user.uid, 'groups', g.id))); await deleteUser(user); } catch(e:any) { setAppAlert({title:"Ошибка", message: translateAuthError(e.code), type:'error'}); } }});
    } else { setShowDeleteConfirm(true); }
  };

  const prevMonth = () => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
  const nextMonth = () => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1));
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const currentMonthName = monthNames[calendarDate.getMonth()];
  const currentYear = calendarDate.getFullYear();
  const daysInMonth = new Date(currentYear, calendarDate.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => { let day = new Date(year, month, 1).getDay(); return day === 0 ? 6 : day - 1; };
  const startDay = getFirstDayOfMonth(currentYear, calendarDate.getMonth());

  if (!isDataLoaded) return <div className="min-h-screen flex items-center justify-center bg-[#FEFDF8]"><Loader2 className="w-12 h-12 animate-spin text-[#4ADE80]" /></div>;
  if (userProfile && !userProfile.onboarded) return <OnboardingModal user={user} onSave={(level: string, goal: number) => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, dailyGoal: goal, onboarded: true, activity: {}, streak: 0 }, { merge: true })} />;

  // Сортировка словаря
  let sortedDictWords = words.filter(w => (w.original || '').toLowerCase().includes(dictSearch.toLowerCase()) || (w.translation || '').toLowerCase().includes(dictSearch.toLowerCase()));
  sortedDictWords.sort((a, b) => {
      if (sortOrder === 'alphaAsc') return (a.original||'').localeCompare(b.original||'');
      if (sortOrder === 'alphaDesc') return (b.original||'').localeCompare(a.original||'');
      if (sortOrder === 'pos') return (a.partOfSpeech||'z').localeCompare(b.partOfSpeech||'z');
      if (sortOrder === 'oldest') return (a.createdAt||0) - (b.createdAt||0);
      return (b.createdAt||0) - (a.createdAt||0);
  });

  const filteredGroups = (groups || []).filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));

  return (
    <div className="min-h-screen bg-[#FEFDF8] font-sans text-stone-900 md:flex flex-row relative overflow-hidden">
      {appAlert && <AlertModal title={appAlert.title} message={appAlert.message} type={appAlert.type} onClose={()=>setAppAlert(null)}/>}
      {appConfirm && <ConfirmModal title={appConfirm.title} message={appConfirm.message} onConfirm={appConfirm.onConfirm} onClose={()=>setAppConfirm(null)}/>}
      
      {/* ДЕСКТОПНОЕ МЕНЮ */}
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-white border-r-4 border-stone-900 p-6 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-12 px-2"><h1 className="text-4xl font-black text-stone-900 tracking-tight">Фрогги <span className="text-3xl">🐸</span></h1></div>
          <nav className="flex-1 space-y-4">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); setDictSearch(''); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Папки" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); setGroupSearch(''); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'progress'} icon={<Calendar />} label="Прогресс" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {/* МОБИЛЬНОЕ МЕНЮ (Плавающая пилюля) */}
      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-6 left-4 right-4 bg-white border-4 border-stone-900 rounded-3xl shadow-[4px_4px_0_0_#1C1C1B] flex justify-around items-center px-2 py-3 z-40">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-6 h-6" />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); setDictSearch(''); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-6 h-6" />} label="Папки" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); setGroupSearch(''); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-6 h-6" />} label="Учить" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'progress'} icon={<Calendar className="w-6 h-6" />} label="Прогресс" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-6 h-6" />} label="Меню" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      <main className={`flex-1 flex flex-col h-screen overflow-y-auto hide-scrollbar ${!activeTrainingMode ? 'md:ml-64' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col pb-32">
          
          {!activeTrainingMode && !viewingGroupId && (
            <div className="sticky top-0 z-30 bg-[#FEFDF8]/90 backdrop-blur-md pt-12 md:pt-10 pb-6 px-4 md:px-8">
              <h1 className="text-4xl font-black tracking-tight text-stone-900">
                 {activeTab === 'dict' ? 'Словарь Фрогги' : activeTab === 'groups' ? 'Твои Папки' : activeTab === 'train' ? 'Игровой Зал' : activeTab === 'progress' ? 'Достижения' : 'Настройки'}
              </h1>
            </div>
          )}

          <div className="flex-1 w-full relative px-4 md:px-8">
            <AnimatePresence mode="wait">
               
               {/* 1. Вкладка Словарь */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
                 <motion.div key="tab-dict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-4">
                   
                   {words.length > 0 && (
                      <>
                         <div className="relative mb-2">
                            <Search className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-stone-900" />
                            <input type="text" placeholder="Поиск по словарю..." value={dictSearch} onChange={e => setDictSearch(e.target.value)} className="w-full bg-white pl-14 pr-4 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-lg" />
                         </div>
                         <div className="flex gap-3 mb-6 overflow-x-auto hide-scrollbar pb-2">
                            <button onClick={()=>setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')} className={`px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shrink-0 border-2 border-stone-900 transition-all ${sortOrder.includes('est') ? 'bg-stone-900 text-white shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none' : 'bg-white text-stone-900 shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}><Clock className="w-4 h-4"/> {sortOrder === 'oldest' ? 'Старые' : 'Новые'}</button>
                            <button onClick={()=>setSortOrder(s => s === 'alphaAsc' ? 'alphaDesc' : 'alphaAsc')} className={`px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shrink-0 border-2 border-stone-900 transition-all ${sortOrder.includes('alpha') ? 'bg-stone-900 text-white shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none' : 'bg-white text-stone-900 shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}>{sortOrder === 'alphaDesc' ? <ArrowUp className="w-4 h-4"/> : <ArrowDown className="w-4 h-4"/>} {sortOrder === 'alphaDesc' ? 'Я-А' : 'А-Я'}</button>
                            <button onClick={()=>setSortOrder('pos')} className={`px-4 py-2 rounded-xl text-sm font-black flex items-center gap-2 shrink-0 border-2 border-stone-900 transition-all ${sortOrder==='pos'?'bg-stone-900 text-white shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none':'bg-white text-stone-900 shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none'}`}><Tag className="w-4 h-4"/> Часть речи</button>
                         </div>
                      </>
                   )}

                   {words.length > 0 && (
                      <div className="flex justify-between items-center px-1 mb-2">
                         <button onClick={() => {
                            const allFilteredSelected = sortedDictWords.length > 0 && sortedDictWords.every(w => selectedWordIds.has(w.id));
                            const newSet = new Set(selectedWordIds);
                            if (allFilteredSelected) { sortedDictWords.forEach(w => newSet.delete(w.id)); } 
                            else { sortedDictWords.forEach(w => newSet.add(w.id)); }
                            setSelectedWordIds(newSet);
                         }} className="text-sm font-black text-[#4ADE80] flex items-center gap-2 active:opacity-70 drop-shadow-sm">
                            <CheckCircle2 className="w-5 h-5 text-stone-900"/> 
                            <span className="text-stone-900">{sortedDictWords.length > 0 && sortedDictWords.every(w => selectedWordIds.has(w.id)) ? 'Снять выделение' : 'Выбрать всё'}</span>
                         </button>
                      </div>
                   )}

                   {words.length === 0 ? <div className="text-center text-stone-400 py-12 font-bold text-lg">Словарь пуст, ква! 🐸</div> : sortedDictWords.length === 0 ? <div className="text-center text-stone-400 py-12 font-bold text-lg">Ничего не найдено.</div> : sortedDictWords.map(word => (
                     <div key={word.id} className="bg-white p-5 rounded-[2rem] border-4 border-stone-900 shadow-[4px_4px_0_0_#1C1C1B] flex items-center gap-4 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all clickable-card cursor-pointer" onClick={() => setViewingWordId(word.id)}>
                        <button onClick={(e) => { e.stopPropagation(); const n = new Set(selectedWordIds); n.has(word.id)?n.delete(word.id):n.add(word.id); setSelectedWordIds(n); }} className={`shrink-0 w-8 h-8 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1C1C1B] flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-[#4ADE80]' : 'bg-stone-100'}`}>{selectedWordIds.has(word.id) && <Check className="w-6 h-6 text-stone-900" />}</button>
                        <div className="flex-1">
                          <div className="flex items-center gap-2"><h3 className="text-xl font-black text-stone-900">{(word.original || '').toLowerCase()}</h3> {word.partOfSpeech && <span className="text-[10px] font-black text-stone-900 uppercase bg-[#FDE047] border-2 border-stone-900 px-2 py-0.5 rounded-lg shadow-[2px_2px_0_0_#1C1C1B]">{word.partOfSpeech}</span>}</div>
                          <p className="text-stone-600 font-bold text-sm mt-1 line-clamp-1">{(word.translation || '').toLowerCase()}</p>
                          <MasteryBar masteryLevel={getEffectiveMastery(word)} />
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); ApiClient.playTTS(word.original); }} className="w-12 h-12 flex items-center justify-center bg-[#A7F3D0] border-2 border-stone-900 rounded-full shadow-[2px_2px_0_0_#1C1C1B] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all shrink-0"><Volume2 className="w-6 h-6 text-stone-900"/></button>
                     </div>
                   ))}
                   {selectedWordIds.size === 0 && (
                      <div className="fixed bottom-[100px] md:bottom-8 right-4 md:right-8 flex flex-col gap-4 z-20">
                         <button onClick={() => setShowGenerateModal(true)} className="w-16 h-16 bg-[#D8B4FE] border-4 border-stone-900 text-stone-900 rounded-3xl shadow-[4px_4px_0_0_#1C1C1B] flex items-center justify-center active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all"><Wand2 className="w-8 h-8" /></button>
                         <button onClick={() => setShowAddWord(true)} className="w-16 h-16 bg-[#4ADE80] border-4 border-stone-900 text-stone-900 rounded-3xl shadow-[4px_4px_0_0_#1C1C1B] flex items-center justify-center active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all"><Plus className="w-8 h-8" /></button>
                      </div>
                   )}
                   <BulkActions selectedWordIds={selectedWordIds} onTrain={() => setActiveTab('train')} onDelete={(ids:string[]) => setAppConfirm({title:'Удалить слова?', message:`Удалить навсегда (${ids.length})?`, onConfirm: ()=>deleteWords(ids)})} onReset={(ids:string[]) => setAppConfirm({title:'Сбросить прогресс?', message:`Забыть прогресс для (${ids.length}) слов?`, onConfirm: ()=>resetProgress(ids)})} onAddToGroup={() => setShowBulkAddGroup(true)} />
                 </motion.div>
               )}

               {/* 2. Вкладка Группы */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
                 <motion.div key="tab-groups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-4">
                    <button onClick={() => setShowAddGroup(true)} className="w-full bg-[#FDE047] border-4 border-stone-900 text-stone-900 font-black text-lg py-5 rounded-[2rem] shadow-[4px_4px_0_0_#1C1C1B] flex items-center justify-center gap-2 mb-6 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all"><Plus className="w-6 h-6"/> Создать папку</button>
                    
                    {(groups || []).length > 0 && (
                      <div className="relative mb-6">
                         <Search className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-stone-900" />
                         <input type="text" placeholder="Поиск папок..." value={groupSearch} onChange={e => setGroupSearch(e.target.value)} className="w-full bg-white pl-14 pr-4 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-lg" />
                      </div>
                    )}

                    {(groups || []).length === 0 ? <div className="text-center text-stone-400 py-12 font-bold text-lg">Нет папок.</div> : filteredGroups.length === 0 ? <div className="text-center text-stone-400 py-12 font-bold text-lg">Папки не найдены.</div> : filteredGroups.map(group => (
                      <div key={group.id} onClick={() => setViewingGroupId(group.id)} className="bg-white p-5 rounded-[2rem] border-4 border-stone-900 shadow-[4px_4px_0_0_#1C1C1B] flex items-center gap-4 cursor-pointer active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all clickable-card">
                          <div className="w-14 h-14 bg-[#93C5FD] border-2 border-stone-900 rounded-2xl shadow-[2px_2px_0_0_#1c1c1b] flex items-center justify-center shrink-0"><Layers className="w-7 h-7 text-stone-900" /></div>
                          <div className="flex-1"><h3 className="text-xl font-black text-stone-900">{group.name}</h3><p className="text-stone-600 font-bold text-sm mt-1">{(words||[]).filter(w=>(w.groupIds||[]).includes(group.id)).length} слов</p></div>
                          <div className="w-10 h-10 flex items-center justify-center bg-stone-100 border-2 border-stone-900 rounded-full"><ArrowRight className="w-5 h-5 text-stone-900" /></div>
                      </div>
                    ))}
                 </motion.div>
               )}

               {/* 3. Вкладка Тренировка */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
                 <motion.div key="tab-train" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-4">
                   {(selectedWordIds.size === 0 && selectedGroupIds.size === 0) ? (
                      <div className="mb-8">
                         <p className="text-stone-900 font-black text-lg mb-4">Выбери базу для тренировки:</p>
                         <div className="space-y-4">
                            <button onClick={() => setShowSmartSelection(true)} className="w-full bg-[#D8B4FE] border-4 border-stone-900 text-stone-900 p-6 rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] font-black text-left active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-between">
                               <span className="flex items-center gap-3 text-xl"><Brain className="w-7 h-7"/> Умный подбор</span> <span className="font-bold opacity-80 text-sm">Слабые слова</span>
                            </button>
                            <button onClick={() => setSelectedWordIds(new Set((words||[]).map(w => w.id)))} className="w-full bg-[#4ADE80] border-4 border-stone-900 text-stone-900 p-6 rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] font-black text-left active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-between"><span className="text-xl">Весь словарь</span> <span className="font-bold opacity-80 text-sm">{(words||[]).length} слов</span></button>
                            {(groups || []).map(group => (
                                  <button key={group.id} onClick={() => setSelectedGroupIds(new Set([group.id]))} className="w-full bg-white border-4 border-stone-900 text-stone-900 p-6 rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] font-black text-left active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-between"><span className="text-xl">{group.name}</span> <span className="text-stone-600 font-bold text-sm">{(words||[]).filter(w => (w.groupIds||[]).includes(group.id)).length} слов</span></button>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <>
                         <div className="flex items-center justify-between mb-8 bg-[#FDE047] border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] p-4 rounded-2xl">
                            <p className="text-stone-900 font-bold">Выбрано слов: <span className="font-black text-2xl">{selectedWordIds.size > 0 ? selectedWordIds.size : (words||[]).filter(w => (w.groupIds||[]).some(id => selectedGroupIds.has(id))).length}</span></p>
                            <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-stone-900 font-black bg-white border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] px-4 py-2 rounded-xl active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex items-center gap-1"><X className="w-5 h-5"/> Сбросить</button>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                           <TrainCard title="Карточки" desc="Запоминание" icon={<FlipHorizontal />} bg="bg-[#FDE047]" onClick={() => startTraining('flashcards')} />
                           <TrainCard title="Викторина" desc="Тест вариантов" icon={<CheckCircle2 />} bg="bg-[#F9A8D4]" onClick={() => startTraining('quiz')} />
                           <TrainCard title="Сборка" desc="Пиши сам" icon={<Layers />} bg="bg-[#93C5FD]" onClick={() => startTraining('constructor')} />
                           <TrainCard title="Фразы" desc="Контекст" icon={<Type />} bg="bg-[#C4B5FD]" onClick={() => startTraining('sentence')} />
                           <TrainCard title="Брейншторм" desc="Турбо-режим" icon={<Brain />} bg="bg-[#FCA5A5]" className="col-span-2" onClick={() => startTraining('brainstorm')} />
                         </div>
                      </>
                   )}
                 </motion.div>
               )}

               {/* 4. Вкладка Прогресс */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'progress' && (
                 <motion.div key="tab-progress" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
                     <div className="bg-[#4ADE80] rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] text-center">
                        <div className="text-7xl font-black text-stone-900 mb-2 drop-shadow-md">🔥 {userProfile?.streak || 0}</div>
                        <div className="text-stone-900 font-black uppercase tracking-widest text-sm">Дней подряд</div>
                     </div>
                     <h3 className="font-black text-stone-900 text-2xl mt-8">Активность</h3>
                     <div className="bg-white rounded-[2rem] p-6 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b]">
                        <div className="flex justify-between items-center mb-6">
                           <button onClick={prevMonth} className="p-3 bg-stone-100 border-2 border-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><ChevronLeft className="w-6 h-6 text-stone-900"/></button>
                           <span className="font-black text-xl text-stone-900">{currentMonthName} {currentYear}</span>
                           <button onClick={nextMonth} className="p-3 bg-stone-100 border-2 border-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><ChevronRight className="w-6 h-6 text-stone-900"/></button>
                        </div>
                        <div className="grid grid-cols-7 gap-2">
                           {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><div key={d} className="text-center text-xs font-black text-stone-400 mb-2">{d}</div>)}
                           {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`} />)}
                           {Array.from({ length: daysInMonth }).map((_, i) => {
                               const day = i + 1;
                               const dateStr = `${currentYear}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                               const mins = userProfile?.activity?.[dateStr] || 0;
                               const isGoalReached = mins >= (userProfile?.dailyGoal || 15);
                               return <div key={i} className={`aspect-square rounded-2xl flex items-center justify-center text-sm font-black border-2 ${isGoalReached ? 'bg-[#FDE047] text-stone-900 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]' : mins > 0 ? 'bg-[#93C5FD] text-stone-900 border-stone-900' : 'bg-stone-50 text-stone-300 border-transparent'}`}>{day}</div>
                           })}
                        </div>
                     </div>
                 </motion.div>
               )}

               {/* 5. Вкладка Настройки */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
                 <motion.div key="tab-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
                     <div className="bg-white rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b]">
                        <div className="font-black text-2xl text-stone-900 mb-1">{user?.displayName || 'Игрок 1'}</div>
                        <div className="text-stone-500 font-bold text-sm mb-8">{user?.email || 'Скрытый email'}</div>
                        
                        <div className="border-t-4 border-stone-900 pt-6">
                           <h3 className="font-black text-stone-900 text-xl mb-4">Уровень</h3>
                           <div className="grid grid-cols-2 gap-3 mb-8">
                             {LEVELS.map((lvl) => <button key={lvl} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), level: lvl }, { merge: true })} className={`py-4 text-sm font-black rounded-2xl border-2 border-stone-900 transition-all ${userProfile?.level === lvl ? 'bg-[#4ADE80] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b]' : 'bg-stone-50 text-stone-600 hover:bg-stone-100'}`}>{lvl}</button>)}
                           </div>
                           <h3 className="font-black text-stone-900 text-xl mb-4">Ежедневная цель</h3>
                           <div className="flex gap-3">
                              {[5,10,15,30].map((m) => <button key={m} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), dailyGoal: m }, { merge: true })} className={`flex-1 py-4 text-lg font-black rounded-2xl border-2 border-stone-900 transition-all ${userProfile?.dailyGoal === m ? 'bg-[#FDE047] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b]' : 'bg-stone-50 text-stone-600 hover:bg-stone-100'}`}>{m}</button>)}
                           </div>
                        </div>
                     </div>

                     <h3 className="font-black text-stone-900 text-2xl mb-4 mt-8">Оформление и звук</h3>
                     <button onClick={() => { 
                         const newVal = !soundEnabled;
                         setSoundEnabled(newVal);
                         localStorage.setItem('soundEnabled', String(newVal));
                         SoundManager.enabled = newVal;
                         if(newVal) SoundManager.play('click');
                     }} className="w-full bg-white p-5 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] flex justify-between items-center font-black text-stone-900 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all mb-4">
                         <span className="flex items-center gap-3 text-lg">{soundEnabled ? <Volume2 className="w-6 h-6 text-[#4ADE80]"/> : <VolumeX className="w-6 h-6 text-stone-400"/>} Звуки в приложении</span>
                         <div className={`w-12 h-6 rounded-full border-2 border-stone-900 flex items-center p-1 ${soundEnabled ? 'bg-[#4ADE80]' : 'bg-stone-200'}`}><div className={`w-4 h-4 bg-stone-900 rounded-full transition-all ${soundEnabled ? 'translate-x-5' : ''}`}/></div>
                     </button>
                     <button onClick={() => { 
                         const newVal = !autoTts;
                         setAutoTts(newVal);
                         ApiClient.autoTtsEnabled = newVal;
                         localStorage.setItem('autoTtsEnabled', String(newVal));
                     }} className="w-full bg-white p-5 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] flex justify-between items-center font-black text-stone-900 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                         <span className="flex items-center gap-3 text-lg">{autoTts ? <Volume2 className="w-6 h-6 text-[#93C5FD]"/> : <VolumeX className="w-6 h-6 text-stone-400"/>} Автоозвучка слов</span>
                         <div className={`w-12 h-6 rounded-full border-2 border-stone-900 flex items-center p-1 ${autoTts ? 'bg-[#93C5FD]' : 'bg-stone-200'}`}><div className={`w-4 h-4 bg-stone-900 rounded-full transition-all ${autoTts ? 'translate-x-5' : ''}`}/></div>
                     </button>

                     <h3 className="font-black text-rose-500 text-2xl mb-4 mt-12">Опасная зона</h3>
                     <div className="space-y-4">
                       <button onClick={resetAllProgress} className="w-full py-5 bg-[#FCA5A5] border-4 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-center gap-3 text-lg"><RotateCcw className="w-6 h-6"/> Сбросить прогресс</button>
                       <button onClick={resetEntireDictionary} className="w-full py-5 bg-[#FCA5A5] border-4 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex items-center justify-center gap-3 text-lg"><Trash2 className="w-6 h-6"/> Очистить словарь</button>
                       <button onClick={() => setAppConfirm({title:"Выйти?", message:"Уверены, что хотите выйти из Фрогги?", onConfirm:()=>signOut(auth)})} className="w-full py-5 bg-stone-900 border-4 border-stone-900 text-white font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all flex justify-center items-center gap-3 mt-8 text-lg"><LogOut className="w-6 h-6"/> Выйти</button>
                       <button onClick={handleDeleteAccount} className="w-full py-4 text-stone-400 hover:text-rose-500 font-bold text-sm transition-colors">Навсегда удалить аккаунт</button>
                     </div>
                 </motion.div>
               )}
            </AnimatePresence>
          </div>

          {/* МОДАЛЬНЫЕ ОКНА */}
          <AnimatePresence>
            {showGenerateModal && <GenerateWordsModal words={words} user={user} groups={groups} userProfile={userProfile} onClose={() => setShowGenerateModal(false)} onWordClick={(id:string)=>{setShowGenerateModal(false); setViewingWordId(id);}} onSaveWord={(w:any) => { const id=doc(collection(db,'users',user.uid,'words')).id; setDoc(doc(db,'users',user.uid,'words',id),{...w,id,createdAt:Date.now(),masteryLevel:0, lastPracticed: Date.now()}); }} />}
            {showAddWord && <AddWordModal words={words} user={user} userProfile={userProfile} groups={groups} onClose={() => setShowAddWord(false)} onWordClick={(id:string)=>{setShowAddWord(false); setViewingWordId(id);}} onSaveWord={(w:any) => { const id=doc(collection(db,'users',user.uid,'words')).id; setDoc(doc(db,'users',user.uid,'words',id),{...w,id,createdAt:Date.now(),masteryLevel:0, lastPracticed: Date.now()}); }} />}
            
            {viewingWordId && !editingWordId && <WordViewModal words={words} word={(words||[]).find(w=>w.id===viewingWordId)!} groups={groups} onClose={() => setViewingWordId(null)} onEdit={() => { setEditingWordId(viewingWordId); setViewingWordId(null); }} onWordClick={(id:string)=>setViewingWordId(id)} />}
            {editingWordId && <WordEditorModal words={words} word={(words||[]).find(w=>w.id===editingWordId)!} groups={groups} userProfile={userProfile} user={user} onClose={() => setEditingWordId(null)} onReset={() => setAppConfirm({title:"Сбросить?", message:"Забыть прогресс этого слова?", onConfirm: ()=>resetProgress([editingWordId])})} onWordClick={(id:string)=>{setEditingWordId(null); setViewingWordId(id);}} onSave={(w:any) => { updateDoc(doc(db,'users',user.uid,'words',w.id),w); }} onDelete={() => { setAppConfirm({title:"Удаление", message:"Сжечь это слово?", onConfirm:()=>{deleteWords([editingWordId!]); setEditingWordId(null);}}) }} />}
            
            {showAddGroup && <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { const id=doc(collection(db,'users',user.uid,'groups')).id; setDoc(doc(db,'users',user.uid,'groups',id),{id,name:n}); setShowAddGroup(false); }} />}
            {showBulkAddGroup && <BulkAddGroupModal groups={groups} onClose={() => setShowBulkAddGroup(false)} onOpenAddGroup={() => { setShowAddGroup(true); }} onSave={(gid:string) => { (words||[]).forEach(w=>{if(selectedWordIds.has(w.id)&&!(w.groupIds||[]).includes(gid)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),gid]});}); setShowBulkAddGroup(false); setSelectedWordIds(new Set()); }} />}
            {showSmartSelection && <SmartSelectionModal words={words} onClose={() => setShowSmartSelection(false)} onSelect={(pickedIds: string[]) => { setSelectedWordIds(new Set(pickedIds)); setSelectedGroupIds(new Set()); setShowSmartSelection(false); }} />}
            
            {/* РЕЖИМ ПРОСМОТРА ГРУППЫ */}
            {viewingGroupId && <GroupView sortOrder={sortOrder} setSortOrder={setSortOrder} group={(groups||[]).find(g=>g.id===viewingGroupId)!} words={(words||[]).filter(w=>(w.groupIds||[]).includes(viewingGroupId!))} onClose={()=>setViewingGroupId(null)} onDeleteGroup={()=>setAppConfirm({title:"Удаление папки", message:"Слова останутся в словаре. Удалить папку?", onConfirm:()=>{deleteGroup(viewingGroupId); setViewingGroupId(null);}})} onRemoveFromGroup={(wid:string)=>{ const w=(words||[]).find(x=>x.id===wid); if(w) updateDoc(doc(db,'users',user.uid,'words',wid),{groupIds:(w.groupIds||[]).filter(g=>g!==viewingGroupId)}); }} selectedWordIds={selectedWordIds} setSelectedWordIds={setSelectedWordIds} onTrain={()=>{ setActiveTab('train'); setViewingGroupId(null); }} onWordClick={(id:string)=>setViewingWordId(id)} />}
            
            {showDeleteConfirm && <DeleteAccountModal onClose={() => setShowDeleteConfirm(false)} onDelete={async (pwd: string) => { try { const cred = EmailAuthProvider.credential(user.email!, pwd); await reauthenticateWithCredential(user, cred); await resetEntireDictionary(); await deleteUser(user); } catch(e:any) { setAppAlert({title:"Ошибка", message:"Неверный пароль. Попробуйте еще раз.", type:"error"}); } }} />}
          </AnimatePresence>
        </div>
      </main>

      {/* ЭКРАНЫ ТРЕНИРОВОК */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div key="training-overlay" initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed inset-0 bg-[#FEFDF8] z-50 flex flex-col">
               <div className="flex justify-between items-center p-4 md:p-8 bg-[#FEFDF8] border-b-4 border-stone-900 z-10">
                  <span className="font-black text-stone-900 text-xl tracking-tight capitalize">{activeTrainingMode === 'stats' ? 'Итоги' : activeTrainingMode}</span>
                  {activeTrainingMode !== 'stats' && <button onClick={() => setActiveTrainingMode('stats')} className="px-4 py-2 bg-[#FCA5A5] border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] text-stone-900 font-black rounded-xl active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex items-center gap-2">Закончить <X className="w-5 h-5" /></button>}
                  {activeTrainingMode === 'stats' && <button onClick={closeTraining} className="p-3 bg-white border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] rounded-xl active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><X className="w-6 h-6 text-stone-900" /></button>}
               </div>
               <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center">
                  {activeTrainingMode === 'stats' ? <SessionStats stats={sessionStats} onClose={closeTraining} /> : (
                     <div className="w-full max-w-sm">
                        {activeTrainingMode === 'flashcards' && <ModeFlashcards words={trainingSnapshot} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'quiz' && <ModeQuiz words={trainingSnapshot} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'constructor' && <ModeConstructor words={trainingSnapshot} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'sentence' && <ModeSentence words={trainingSnapshot} onProgress={(w: string, c: boolean) => handleUpdateProgress(w, c, 'sentence')} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'brainstorm' && <ModeBrainstorm words={trainingSnapshot} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                     </div>
                  )}
               </div>
            </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}

// --- КОМПОНЕНТЫ И МОДАЛКИ ---
function SidebarItem({ active, icon, label, onClick }: any) { 
   return <button data-sound="menu" onClick={onClick} className={`flex items-center w-full px-5 py-4 gap-4 rounded-2xl transition-all border-4 ${active ? 'bg-[#4ADE80] border-stone-900 shadow-[4px_4px_0_0_#1C1C1B] text-stone-900 font-black translate-x-1' : 'border-transparent text-stone-600 font-bold hover:bg-[#A7F3D0] hover:border-stone-900 hover:shadow-[4px_4px_0_0_#1C1C1B] hover:text-stone-900'} `}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-7 h-7" })}</div><span className="text-lg">{label}</span></button>; 
}
function NavItem({ active, icon, label, onClick }: any) { 
   return <button data-sound="menu" onClick={onClick} className={`flex flex-col items-center flex-1 py-2 gap-1 transition-all rounded-2xl ${active ? 'bg-[#4ADE80] border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] text-stone-900 font-black -translate-y-1' : 'text-stone-500 font-bold hover:text-stone-900'}`}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-6 h-6" })}</div><span className="text-[10px] tracking-wide uppercase">{label}</span></button>; 
}
function MasteryBar({ masteryLevel }: { masteryLevel: number }) { 
   return <div className="mt-3 w-full bg-stone-100 rounded-full h-2.5 border-2 border-stone-900 overflow-hidden shadow-inner"><div className={`h-full border-r-2 border-stone-900 ${masteryLevel > 70 ? 'bg-[#4ADE80]' : masteryLevel > 30 ? 'bg-[#FDE047]' : 'bg-[#FCA5A5]'} transition-all duration-700`} style={{ width: `${masteryLevel}%` }} /></div>; 
}
function TrainCard({ title, desc, icon, bg, className="", onClick }: any) { 
   return <div onClick={onClick} className={`p-6 rounded-[2rem] border-4 border-stone-900 shadow-[4px_4px_0_0_#1C1C1B] flex flex-col gap-4 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all cursor-pointer clickable-card ${bg} ${className}`}><div className="w-14 h-14 rounded-2xl bg-white border-2 border-stone-900 flex items-center justify-center shadow-[2px_2px_0_0_#1c1c1b]">{React.cloneElement(icon, { className: "w-7 h-7 text-stone-900" })}</div><div><div className="font-black text-stone-900 text-xl">{title}</div><div className="text-sm text-stone-800 font-bold">{desc}</div></div></div>; 
}
function BulkActions({ selectedWordIds, onTrain, onDelete, onReset, onAddToGroup }: any) {
  if (selectedWordIds.size === 0) return null;
  return (
    <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-[100px] md:bottom-8 left-1/2 -translate-x-1/2 bg-white border-4 border-stone-900 rounded-[2rem] shadow-[8px_8px_0_0_#1c1c1b] p-2 flex items-center justify-around z-30 w-[90%] max-w-md">
      <button onClick={() => onDelete(Array.from(selectedWordIds))} className="flex flex-col items-center p-3 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors flex-1"><Trash2 className="w-6 h-6 mb-1 text-stone-900" /> <span className="text-[10px] font-black text-stone-900">Удалить</span></button>
      <button onClick={() => onReset(Array.from(selectedWordIds))} className="flex flex-col items-center p-3 text-orange-500 hover:bg-orange-50 rounded-xl transition-colors flex-1 border-l-2 border-stone-100"><RotateCcw className="w-6 h-6 mb-1 text-stone-900" /> <span className="text-[10px] font-black text-stone-900">Сбросить</span></button>
      <button onClick={onAddToGroup} className="flex flex-col items-center p-3 text-sky-600 hover:bg-sky-50 rounded-xl transition-colors flex-1 border-l-2 border-stone-100"><FolderPlus className="w-6 h-6 mb-1 text-stone-900" /> <span className="text-[10px] font-black text-stone-900">В папку</span></button>
      <button onClick={onTrain} className="flex flex-col items-center p-3 bg-[#4ADE80] border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] rounded-xl active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex-1 ml-2"><PlayCircle className="w-6 h-6 mb-1 text-stone-900" /> <span className="text-[10px] font-black text-stone-900">Учить</span></button>
    </motion.div>
  );
}

function DeleteAccountModal({ onClose, onDelete }: any) {
   const [pwd, setPwd] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10 text-center">
           <AlertTriangle className="w-14 h-14 text-[#FCA5A5] mx-auto mb-4" />
           <h2 className="text-2xl font-black mb-2 text-stone-900">Удаление аккаунта</h2>
           <p className="text-stone-600 font-bold mb-6 text-sm">Это действие нельзя отменить. Все ваши слова, папки и прогресс сгорят.</p>
           <input autoFocus type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Текущий пароль" className="w-full bg-white px-4 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-center" />
           <div className="mt-8 flex gap-3">
              <button onClick={onClose} className="flex-1 py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">Отмена</button>
              <button onClick={() => pwd && onDelete(pwd)} className="flex-1 py-4 bg-[#FCA5A5] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50" disabled={!pwd}>Удалить</button>
           </div>
        </motion.div>
      </div>
   );
}

function SmartSelectionModal({ words, onClose, onSelect }: any) {
   const safeWords = words || [];
   const [inputVal, setInputVal] = useState(String(Math.min(10, safeWords.length)));

   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10">
           <h2 className="text-2xl font-black mb-2 text-stone-900">Умный подбор</h2>
           <p className="text-stone-600 font-bold text-sm mb-6">Тренируем самые слабые слова.</p>
           <div className="bg-white p-6 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] mb-8">
              <div className="flex justify-between text-sm font-black text-stone-900 mb-2 uppercase"><span>Количество</span><span>Всего: {safeWords.length}</span></div>
              <input 
                 type="number" 
                 value={inputVal} 
                 onChange={e => setInputVal(e.target.value)} 
                 onBlur={() => {
                    let val = parseInt(inputVal);
                    if (isNaN(val) || val < 1) val = 1;
                    if (val > safeWords.length) val = safeWords.length;
                    setInputVal(String(val));
                 }}
                 className="w-full text-5xl font-black bg-transparent outline-none text-stone-900 text-center" 
              />
           </div>
           <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">Отмена</button>
              <button onClick={() => { 
                 const count = parseInt(inputVal) || 1;
                 const sorted = [...safeWords].sort((a, b) => getEffectiveMastery(a) - getEffectiveMastery(b)); 
                 onSelect(sorted.slice(0, count).map((w: any) => w.id)); 
              }} className="flex-1 py-4 bg-[#D8B4FE] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex justify-center items-center gap-2 text-lg"><Brain className="w-6 h-6"/> Выбрать</button>
           </div>
        </motion.div>
      </div>
   );
}

function GenerateWordsModal({ words, userProfile, groups, onClose, onSaveWord, onWordClick }: any) {
  const [tabs, setTabs] = useState<any[]>([{ id: 'generator', type: 'list', generatedWords: [] }]);
  const [activeTabId, setActiveTabId] = useState('generator');

  const [topic, setTopic] = useState('');
  const [count, setCount] = useState('10');
  const [genLevel, setGenLevel] = useState(userProfile?.level || 'Intermediate');
  const [extractedText, setExtractedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingWord, setLoadingWord] = useState<string|null>(null);

  const [selectedGenWords, setSelectedGenWords] = useState<Set<string>>(new Set());
  const [loadingBatch, setLoadingBatch] = useState(false);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const handleFileUpload = async (e: any) => {
     const file = e.target.files[0];
     if(!file) return;
     if (file.size > 5 * 1024 * 1024) { alert('Файл слишком большой. Макс 5 МБ.'); return; }
     setFileName(file.name);
     if (file.type === 'application/pdf') {
         setLoading(true);
         try {
             const pdfjsLib = await loadPdfJs();
             const arrayBuffer = await file.arrayBuffer();
             const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
             let fullText = '';
             const maxPages = Math.min(pdf.numPages, 5);
             for(let i=1; i<=maxPages; i++) {
                 const page = await pdf.getPage(i);
                 const textContent = await page.getTextContent();
                 fullText += textContent.items.map((s:any)=>s.str).join(' ') + ' ';
             }
             setExtractedText(fullText);
         } catch(err) { alert('Ошибка PDF.'); }
         setLoading(false);
     } else {
         const text = await file.text();
         setExtractedText(text);
     }
  };

  const handleGenerate = async () => {
     const c = Math.min(15, parseInt(count) || 10);
     if (!(topic || '').trim() && !(extractedText || '').trim()) return alert('Нужна тема или текст');
     setLoading(true);
     const result = await ApiClient.aiGenerateWordsList(topic, c, extractedText, genLevel);
     setTabs(prev => prev.map(t => t.id === 'generator' ? { ...t, generatedWords: result } : t));
     setLoading(false);
  };

  const handleAnalyzeWord = async (w: any) => {
     const safeWWord = (w.word || '').toLowerCase();
     setLoadingWord(safeWWord);
     
     let tabIdToUse = activeTab.type === 'word' ? activeTabId : Date.now().toString();
     if (activeTab.type !== 'word') {
         setTabs(prev => [...prev, { id: tabIdToUse, type: 'word', original: safeWWord, status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }]);
         setActiveTabId(tabIdToUse);
     } else {
         updateWordTab(tabIdToUse, { status: 'analyzing' });
     }
     
     const result = await ApiClient.aiGenerateWord(safeWWord, userProfile?.level);
     setTabs(prev => prev.map(t => t.id === tabIdToUse ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || w.translation || '').toLowerCase() } : t));
     setLoadingWord(null);
  };

  const updateWordTab = (id: string, data: any) => { setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t)); };

  const handleSaveTab = () => {
     if (activeTab.type !== 'word') return;
     const wToSave = { 
        original: (activeTab.wordData?.original || activeTab.original || '').toLowerCase(), 
        ...activeTab.wordData, 
        translation: (activeTab.selectedTranslation || '').toLowerCase(), 
        groupIds: Array.from(activeTab.groupIds || []) 
     };
     onSaveWord(wToSave);
     handleCloseTab(activeTabId);
  };

  const handleCloseTab = (id: string, e?: React.MouseEvent) => {
     if(e) e.stopPropagation();
     const newTabs = tabs.filter(t => t.id !== id);
     setTabs(newTabs); 
     if(activeTabId === id) { const nextWordTab = newTabs.find(t => t.type === 'word'); if (nextWordTab) setActiveTabId(nextWordTab.id); else setActiveTabId('generator'); }
  };

  const handleReset = () => { updateWordTab('generator', {generatedWords: []}); setTopic(''); setExtractedText(''); setFileName(''); setCount('10'); setSelectedGenWords(new Set()); };
  const toggleSelect = (word: string) => { const newSet = new Set(selectedGenWords); if(newSet.has(word)) newSet.delete(word); else newSet.add(word); setSelectedGenWords(newSet); };
  const selectAll = () => { if (selectedGenWords.size === (activeTab.generatedWords || []).length) setSelectedGenWords(new Set()); else setSelectedGenWords(new Set((activeTab.generatedWords || []).map((w:any) => w.word))); };

  const handleAddSelectedToTabs = async () => {
      const wordsToAdd = (activeTab.generatedWords || []).filter((w:any) => selectedGenWords.has(w.word));
      if(wordsToAdd.length === 0) return;
      setLoadingBatch(true);
      const newTabs = wordsToAdd.map((w:any, i:number) => ({ id: Date.now().toString() + i, type: 'word', original: (w.word || '').toLowerCase(), status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }));
      setTabs(prev => [...prev, ...newTabs]);
      setActiveTabId(newTabs[0].id);
      setSelectedGenWords(new Set());
      await Promise.all(newTabs.map(async (tab: any, i: number) => {
          const w = wordsToAdd[i];
          const result = await ApiClient.aiGenerateWord((w.word || '').toLowerCase(), userProfile?.level);
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || w.translation || '').toLowerCase() } : t));
      }));
      setLoadingBatch(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-[#FEFDF8] w-full max-w-xl rounded-t-[2.5rem] p-6 border-t-4 border-x-4 border-stone-900 shadow-[0_-8px_0_0_#1c1c1b] flex flex-col max-h-[90vh] relative z-10">
        
        {/* Панель вкладок */}
        <div className="flex overflow-x-auto gap-3 pb-4 mb-2 hide-scrollbar">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black shrink-0 cursor-pointer border-2 border-stone-900 transition-all ${activeTabId === t.id ? 'bg-[#D8B4FE] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b] -translate-y-1' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
                  {t.id === 'generator' ? <Sparkles className="w-5 h-5"/> : (t.wordData?.original || t.original || 'Слово').toLowerCase()}
                  {t.id !== 'generator' && <button onClick={(e) => handleCloseTab(t.id, e)} className="p-1 rounded-full bg-stone-900 text-white ml-2"><X className="w-3 h-3"/></button>}
               </div>
           ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar relative px-1">
          {/* TAB: GENERATOR LIST */}
          {activeTab.type === 'list' && (
             <div className="space-y-6">
                {(activeTab.generatedWords || []).length === 0 ? (
                   <>
                      <div className="space-y-3">
                          <label className="text-sm font-black text-stone-900 uppercase">Уровень сложности</label>
                          <div className="flex overflow-x-auto gap-3 pb-2 hide-scrollbar">
                             {LEVELS.map(l => (
                                <button key={l} onClick={() => setGenLevel(l)} className={`px-5 py-3 rounded-2xl text-sm font-black shrink-0 border-2 border-stone-900 transition-all ${genLevel === l ? 'bg-[#4ADE80] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b]' : 'bg-white text-stone-600'}`}>{l}</button>
                             ))}
                          </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                         <div className="col-span-2 space-y-2">
                             <label className="text-sm font-black text-stone-900 uppercase">Тема (или пусто)</label>
                             <textarea value={topic} onChange={e => { setTopic(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }} placeholder="Напр. Путешествия" className="w-full bg-white px-5 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none font-bold resize-none" rows={1} style={{ minHeight: '60px' }} />
                         </div>
                         <div className="col-span-1 space-y-2"><label className="text-sm font-black text-stone-900 uppercase">Слов</label><input type="number" min="1" max="30" value={count} onChange={e => setCount(e.target.value)} className="w-full bg-white px-5 py-4 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none font-bold text-center" /></div>
                      </div>
                      
                      <div className="space-y-2 mt-4">
                         <label className="text-sm font-black text-stone-900 uppercase block">Или извлечь из файла (PDF/TXT)</label>
                         <label className="w-full flex items-center justify-center gap-3 bg-[#FDE047] border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] py-5 rounded-2xl cursor-pointer active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all font-black text-lg">
                            <UploadCloud className="w-6 h-6"/> {fileName || 'Загрузить файл'}
                            <input type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileUpload} />
                         </label>
                      </div>
                      <button onClick={handleGenerate} disabled={loading} className="w-full py-6 mt-8 bg-[#D8B4FE] border-4 border-stone-900 text-stone-900 font-black text-xl rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50 flex justify-center items-center gap-3">
                         {loading ? <><Loader2 className="w-6 h-6 animate-spin"/> Магия ИИ...</> : <><Sparkles className="w-6 h-6"/> Создать магию</>}
                      </button>
                   </>
                ) : (
                   <div className="pb-24">
                      <div className="flex justify-between items-center mb-6">
                         <button onClick={selectAll} className="text-sm font-black text-[#4ADE80] drop-shadow-sm flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-stone-900"/> <span className="text-stone-900">{selectedGenWords.size === (activeTab.generatedWords || []).length ? 'Снять всё' : 'Выбрать всё'}</span></button>
                         <button onClick={handleReset} className="text-sm font-black text-stone-500 hover:text-stone-900 bg-stone-200 px-3 py-1 rounded-lg">Сброс</button>
                      </div>
                      <div className="space-y-3">
                         {(activeTab.generatedWords || []).map((w:any, i:number) => {
                            const cleanWWord = (w.word || '').toLowerCase();
                            const alreadyInTabs = tabs.some(t => t.id !== 'generator' && (t.wordData?.original || t.original || '').toLowerCase() === cleanWWord);
                            const existingInDict = (words||[]).find((x:any) => (x.original || '').toLowerCase() === cleanWWord);
                            return (
                               <div key={i} className="flex items-center justify-between bg-white p-5 rounded-2xl border-2 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] gap-4">
                                  <button onClick={() => toggleSelect(w.word)} className={`w-8 h-8 rounded-xl border-2 flex shrink-0 items-center justify-center transition-colors ${selectedGenWords.has(w.word) ? 'bg-[#4ADE80] border-stone-900' : 'border-stone-300 bg-stone-100'}`}>
                                      {selectedGenWords.has(w.word) && <Check className="w-6 h-6 text-stone-900" />}
                                  </button>
                                  <div className="flex-1 cursor-pointer" onClick={() => toggleSelect(w.word)}>
                                     <span className="font-black text-stone-900 text-xl">{cleanWWord}</span>
                                     <div className="text-sm text-stone-600 font-bold mt-1">{(w.translation || '').toLowerCase()}</div>
                                  </div>
                                  {existingInDict ? (
                                     <button onClick={() => onWordClick(existingInDict.id)} className="px-4 py-2 bg-stone-900 text-white rounded-xl text-sm font-black shrink-0">В словаре</button>
                                  ) : (
                                     <button onClick={()=>handleAnalyzeWord(w)} disabled={alreadyInTabs || loadingWord === w.word} className="w-12 h-12 flex shrink-0 items-center justify-center bg-[#FDE047] border-2 border-stone-900 text-stone-900 rounded-full shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 transition-all">
                                        {loadingWord === w.word ? <Loader2 className="w-6 h-6 animate-spin"/> : alreadyInTabs ? <Check className="w-6 h-6"/> : <Plus className="w-6 h-6"/>}
                                     </button>
                                  )}
                               </div>
                            )
                         })}
                      </div>
                      
                      <AnimatePresence>
                         {selectedGenWords.size > 0 && (
                            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-white p-3 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] flex items-center z-50">
                               <button onClick={handleAddSelectedToTabs} disabled={loadingBatch} className="w-full py-5 bg-[#D8B4FE] border-2 border-stone-900 text-stone-900 font-black text-lg rounded-2xl active:translate-x-[2px] active:translate-y-[2px] shadow-[2px_2px_0_0_#1c1c1b] active:shadow-none transition-all flex justify-center items-center gap-3">
                                  {loadingBatch ? <Loader2 className="w-6 h-6 animate-spin"/> : `Анализировать (${selectedGenWords.size})`}
                               </button>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </div>
                )}
             </div>
          )}

          {/* TAB: WORD CARD */}
          {activeTab.type === 'word' && (
             <>
                {activeTab.status === 'analyzing' && <div className="py-20 flex flex-col items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#D8B4FE] mb-4 drop-shadow-md" /><span className="font-black text-stone-600">Спрашиваем умную жабу...</span></div>}
                
                {activeTab.status === 'done' && (
                   activeTab.wordData?.translationOptions?.[0]?.includes('Ошибка ИИ') ? (
                      <div className="bg-[#FCA5A5] p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] text-center mt-4">
                         <AlertTriangle className="w-16 h-16 text-stone-900 mx-auto mb-4" />
                         <h3 className="text-2xl font-black text-stone-900 mb-2">Ой-ой! Ошибка</h3>
                         <p className="text-stone-900 font-bold text-sm mb-8 opacity-80">Жаба не поняла слово. Возможно, опечатка или сбой сети.</p>
                         <button onClick={() => handleAnalyzeWord({word: activeTab.original})} className="w-full py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex justify-center items-center gap-2"><RefreshCw className="w-5 h-5"/> Перезапустить</button>
                      </div>
                   ) : (
                      <div className="space-y-6">
                         <div className="bg-white p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b]">
                            <div className="flex items-center justify-between mb-6">
                               <div className="w-12"></div>
                               <div className="flex items-center gap-3">
                                  <h3 className="text-4xl font-black text-stone-900 tracking-tight">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                                  {activeTab.wordData?.partOfSpeech && <span className="bg-[#FDE047] border-2 border-stone-900 text-stone-900 font-black px-3 py-1 rounded-xl text-xs uppercase shadow-[2px_2px_0_0_#1c1c1b]">{activeTab.wordData.partOfSpeech}</span>}
                               </div>
                               <button onClick={() => ApiClient.playTTS(activeTab.wordData?.original || activeTab.original)} className="w-12 h-12 flex items-center justify-center bg-[#A7F3D0] border-2 border-stone-900 text-stone-900 rounded-full shadow-[2px_2px_0_0_#1c1c1b] hover:bg-[#4ADE80] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                                  <Volume2 className="w-6 h-6"/>
                               </button>
                            </div>
                            <div className="space-y-6">
                                <div>
                                   <div className="text-[10px] font-black text-stone-400 uppercase text-center mb-3">Главный перевод</div>
                                   <div className="flex flex-wrap justify-center gap-3 mb-2">
                                      {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                                         <button key={i} onClick={()=>updateWordTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-5 py-3 rounded-2xl text-lg font-black border-2 border-stone-900 transition-all ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-[#4ADE80] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b] scale-105' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>{(opt || '').toLowerCase()}</button>
                                      ))}
                                   </div>
                                </div>
                                <div className="pt-6 border-t-4 border-dashed border-stone-200"><div className="text-[10px] font-black text-stone-400 uppercase text-center mb-2">Определение</div><div className="text-stone-700 font-bold text-center text-md leading-relaxed">{activeTab.wordData?.cambridgeTranslation}</div></div>
                                <div className="pt-6 border-t-4 border-dashed border-stone-200"><div className="text-[10px] font-black text-stone-400 uppercase text-center mb-3">Транскрипция</div><div className="flex justify-center gap-4 text-md font-black text-stone-700"><span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                            </div>
                            {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className="mt-8 p-6 bg-[#93C5FD] border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] rounded-[2rem] text-center"><div className="text-[10px] font-black text-stone-900 uppercase mb-3 opacity-60">Как применять</div><div className="font-black text-stone-900 mb-3 text-2xl">"{ex.text}"</div><div className="text-md font-bold text-stone-900 opacity-80">{(ex.translation || '').toLowerCase()}</div></div>)}
                            
                            {relatedList.length > 0 && (
                               <div className="mt-8 pt-6 border-t-4 border-dashed border-stone-200 text-center">
                                  <div className="text-[10px] font-black text-stone-400 uppercase mb-4">Связанные слова</div>
                                  <div className="space-y-3">
                                     {relatedList.map((rw:any, i:number) => {
                                        const cleanRW = (rw.word || '').toLowerCase();
                                        const alreadyInTabs = tabs.some(t => (t.wordData?.original || t.original || '').toLowerCase() === cleanRW);
                                        return (
                                           <div key={i} className="flex items-center justify-between bg-white p-4 rounded-2xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">
                                              <div className="text-left"><span className="font-black text-stone-900 text-lg">{cleanRW}</span> <span className="text-[10px] text-stone-900 font-black bg-[#FDE047] px-2 py-1 rounded border-2 border-stone-900 ml-2 uppercase">{rw.partOfSpeech}</span><div className="text-sm font-bold text-stone-600 mt-1">{(rw.translation || '').toLowerCase()}</div></div>
                                              <button onClick={()=>handleAddRelated(rw)} disabled={alreadyInTabs} className="w-10 h-10 flex shrink-0 items-center justify-center bg-[#4ADE80] border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] text-stone-900 rounded-full active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:bg-stone-200 transition-all">{alreadyInTabs ? <Check className="w-5 h-5"/> : <Plus className="w-5 h-5"/>}</button>
                                           </div>
                                        );
                                     })}
                                  </div>
                               </div>
                            )}
                         </div>
                         {(groups || []).length > 0 && <div className="px-2 pt-2"><h3 className="text-sm font-black text-stone-600 mb-4">В какую папку положить?</h3><div className="flex flex-wrap gap-3">{(groups || []).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateWordTab(activeTabId, { groupIds: s }); }} className={`px-5 py-3 rounded-2xl text-sm font-black border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] transition-all flex items-center gap-2 ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-[#93C5FD] text-stone-900 translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-stone-600'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-5 h-5"/>} {g.name}</button>)}</div></div>}
                         <button onClick={handleSaveTab} className="w-full py-6 mt-6 bg-[#4ADE80] border-4 border-stone-900 text-stone-900 font-black text-xl rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Добавить в словарь</button>
                      </div>
                   )
                )}
             </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AddWordModal({ words, userProfile, groups, onClose, onSaveWord, onWordClick }: any) {
  const [tabs, setTabs] = useState<any[]>([{ id: Date.now().toString(), original: '', status: 'idle', wordData: {}, selectedTranslation: '', groupIds: new Set() }]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const updateTab = (id: string, data: any) => { setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t)); };

  const handleAnalyze = async () => {
    if (!(activeTab.original || '').trim()) return;
    updateTab(activeTabId, { status: 'analyzing' });
    const result = await ApiClient.aiGenerateWord((activeTab.original || '').toLowerCase(), userProfile?.level);
    updateTab(activeTabId, { status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || '').toLowerCase() });
  };

  const handleAddRelated = async (rw: any) => {
     const newId = Date.now().toString();
     const cleanRW = (rw.word || '').toLowerCase();
     setTabs(prev => [...prev, { id: newId, original: cleanRW, status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }]);
     setActiveTabId(newId);
     const result = await ApiClient.aiGenerateWord(cleanRW, userProfile?.level);
     setTabs(prev => prev.map(t => t.id === newId ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || rw.translation || '').toLowerCase() } : t));
  };

  const handleSaveTab = () => {
     const wToSave = { original: (activeTab.wordData?.original || activeTab.original || '').toLowerCase(), ...activeTab.wordData, translation: (activeTab.selectedTranslation || '').toLowerCase(), groupIds: Array.from(activeTab.groupIds || []) };
     onSaveWord(wToSave);
     const newTabs = tabs.filter(t => t.id !== activeTabId);
     if (newTabs.length === 0) onClose();
     else { setTabs(newTabs); setActiveTabId(newTabs[newTabs.length - 1].id); }
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
     e.stopPropagation();
     const newTabs = tabs.filter(t => t.id !== id);
     if (newTabs.length === 0) onClose();
     else { setTabs(newTabs); if(activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id); }
  };

  const relatedList = activeTab.wordData?.relatedWords || [];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-[#FEFDF8] w-full max-w-xl rounded-t-[2.5rem] p-6 border-t-4 border-x-4 border-stone-900 shadow-[0_-8px_0_0_#1c1c1b] flex flex-col max-h-[90vh] relative z-10">
        
        {/* Панель вкладок */}
        <div className="flex overflow-x-auto gap-3 pb-4 mb-2 hide-scrollbar">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-black shrink-0 cursor-pointer border-2 border-stone-900 transition-all clickable-card ${activeTabId === t.id ? 'bg-[#D8B4FE] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b] -translate-y-1' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>
                  {(t.wordData?.original || t.original || 'Новое слово').toLowerCase()}
                  {tabs.length > 1 && <button onClick={(e) => handleCloseTab(e, t.id)} className="p-1 rounded-full bg-stone-900 text-white ml-2"><X className="w-3 h-3"/></button>}
               </div>
           ))}
           <button onClick={() => { const newId = Date.now().toString(); setTabs([...tabs, { id: newId, original: '', status: 'idle', wordData: {}, selectedTranslation: '', groupIds: new Set() }]); setActiveTabId(newId); }} className="px-4 py-3 text-stone-900 font-black bg-[#FDE047] border-2 border-stone-900 rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><Plus className="w-5 h-5"/></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar px-1">
          {activeTab.status === 'idle' && (
             <div className="pt-4">
                <input autoFocus placeholder="Введите слово..." value={(activeTab.original || '').toLowerCase()} onChange={e => updateTab(activeTabId, { original: (e.target.value || '').toLowerCase() })} className="w-full bg-white px-6 py-6 rounded-[2rem] text-3xl font-black border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] outline-none focus:translate-x-[4px] focus:translate-y-[4px] focus:shadow-none transition-all text-center mb-8" />
                <button onClick={handleAnalyze} disabled={!(activeTab.original || '').trim()} className="w-full py-6 bg-[#4ADE80] text-stone-900 border-4 border-stone-900 font-black text-2xl rounded-[2rem] shadow-[8px_8px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all disabled:opacity-50">Узнать перевод</button>
             </div>
          )}
          
          {activeTab.status === 'analyzing' && <div className="py-20 flex flex-col items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#4ADE80] mb-4 drop-shadow-md" /><span className="font-black text-stone-600">Спрашиваем умную жабу...</span></div>}
          
          {activeTab.status === 'done' && (
             activeTab.wordData?.translationOptions?.[0]?.includes('Ошибка ИИ') ? (
                <div className="bg-[#FCA5A5] p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] text-center mt-4">
                   <AlertTriangle className="w-16 h-16 text-stone-900 mx-auto mb-4" />
                   <h3 className="text-2xl font-black text-stone-900 mb-2">Ой-ой! Ошибка</h3>
                   <p className="text-stone-900 font-bold text-sm mb-8 opacity-80">Жаба не поняла слово. Возможно, опечатка или сбой сети.</p>
                   <button onClick={handleAnalyze} className="w-full py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex justify-center items-center gap-2"><RefreshCw className="w-5 h-5"/> Перезапустить</button>
                </div>
             ) : (
                <div className="space-y-6">
                   <div className="bg-white p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b]">
                      <div className="flex items-center justify-between mb-6">
                         <div className="w-12"></div>
                         <div className="flex items-center gap-3">
                            <h3 className="text-4xl font-black text-stone-900 tracking-tight">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                            {activeTab.wordData?.partOfSpeech && <span className="bg-[#FDE047] border-2 border-stone-900 text-stone-900 font-black px-3 py-1 rounded-xl text-xs uppercase shadow-[2px_2px_0_0_#1c1c1b]">{activeTab.wordData.partOfSpeech}</span>}
                         </div>
                         <button onClick={() => ApiClient.playTTS(activeTab.wordData?.original || activeTab.original)} className="w-12 h-12 flex items-center justify-center bg-[#A7F3D0] border-2 border-stone-900 text-stone-900 rounded-full shadow-[2px_2px_0_0_#1c1c1b] hover:bg-[#4ADE80] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                            <Volume2 className="w-6 h-6"/>
                         </button>
                      </div>
                      <div className="space-y-6">
                          <div>
                             <div className="text-[10px] font-black text-stone-400 uppercase text-center mb-3">Главный перевод</div>
                             <div className="flex flex-wrap justify-center gap-3 mb-2">
                                {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                                   <button key={i} onClick={()=>updateTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-5 py-3 rounded-2xl text-lg font-black border-2 border-stone-900 transition-all ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-[#4ADE80] text-stone-900 shadow-[4px_4px_0_0_#1c1c1b] scale-105' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>{(opt || '').toLowerCase()}</button>
                                ))}
                             </div>
                          </div>
                          <div className="pt-6 border-t-4 border-dashed border-stone-200"><div className="text-[10px] font-black text-stone-400 uppercase text-center mb-2">Определение</div><div className="text-stone-700 font-bold text-center text-md leading-relaxed">{activeTab.wordData?.cambridgeTranslation}</div></div>
                          <div className="pt-6 border-t-4 border-dashed border-stone-200"><div className="text-[10px] font-black text-stone-400 uppercase text-center mb-3">Транскрипция</div><div className="flex justify-center gap-4 text-md font-black text-stone-700"><span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                      </div>
                      {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className="mt-8 p-6 bg-[#93C5FD] border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] rounded-[2rem] text-center"><div className="text-[10px] font-black text-stone-900 uppercase mb-3 opacity-60">Как применять</div><div className="font-black text-stone-900 mb-3 text-2xl">"{ex.text}"</div><div className="text-md font-bold text-stone-900 opacity-80">{(ex.translation || '').toLowerCase()}</div></div>)}
                      
                      {relatedList.length > 0 && (
                         <div className="mt-8 pt-6 border-t-4 border-dashed border-stone-200 text-center">
                            <div className="text-[10px] font-black text-stone-400 uppercase mb-4">Связанные слова (открыть вкладку)</div>
                            <div className="space-y-3">
                               {relatedList.map((rw:any, i:number) => {
                                  const cleanRW = (rw.word || '').toLowerCase();
                                  const alreadyInTabs = tabs.some(t => (t.wordData?.original || t.original || '').toLowerCase() === cleanRW);
                                  return (
                                     <div key={i} className="flex items-center justify-between bg-white p-4 rounded-2xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">
                                        <div className="text-left"><span className="font-black text-stone-900 text-lg">{cleanRW}</span> <span className="text-[10px] text-stone-900 font-black bg-[#FDE047] px-2 py-1 rounded border-2 border-stone-900 ml-2 uppercase">{rw.partOfSpeech}</span><div className="text-sm font-bold text-stone-600 mt-1">{(rw.translation || '').toLowerCase()}</div></div>
                                        <button onClick={()=>handleAddRelated(rw)} disabled={alreadyInTabs} className="w-10 h-10 flex shrink-0 items-center justify-center bg-[#4ADE80] border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] text-stone-900 rounded-full active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:bg-stone-200 transition-all">{alreadyInTabs ? <Check className="w-5 h-5"/> : <Plus className="w-5 h-5"/>}</button>
                                     </div>
                                  );
                               })}
                            </div>
                         </div>
                      )}
                   </div>
                   {(groups || []).length > 0 && <div className="px-2 pt-2"><h3 className="text-sm font-black text-stone-600 mb-4">В какую папку положить?</h3><div className="flex flex-wrap gap-3">{(groups || []).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateTab(activeTabId, { groupIds: s }); }} className={`px-5 py-3 rounded-2xl text-sm font-black border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] transition-all flex items-center gap-2 ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-[#93C5FD] text-stone-900 translate-x-[1px] translate-y-[1px] shadow-none' : 'bg-white text-stone-600'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-5 h-5"/>} {g.name}</button>)}</div></div>}
                   <button onClick={handleSaveTab} className="w-full py-6 mt-6 bg-[#4ADE80] border-4 border-stone-900 text-stone-900 font-black text-xl rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all">Добавить в словарь</button>
                </div>
             )
          )}
        </div>
      </motion.div>
    </div>
  );
}

function WordViewModal({ word, words, groups, onClose, onEdit, onWordClick }: any) {
  if (!word) return null;
  const relatedTabs = word.relatedWords || [];

  return (
     <div className="fixed inset-0 z-[100] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-[#FEFDF8] w-full max-w-lg rounded-t-[2.5rem] p-6 border-t-4 border-x-4 border-stone-900 shadow-[0_-8px_0_0_#1c1c1b] flex flex-col max-h-[90vh] relative z-10">

           <div className="flex justify-between items-center mb-8 shrink-0 px-2">
              <h2 className="text-2xl font-black text-stone-900 flex items-center gap-3"><BookOpen className="w-6 h-6 text-[#93C5FD]"/> Карточка</h2>
              <div className="flex items-center gap-3">
                 <button onClick={onEdit} className="p-3 bg-white border-2 border-stone-900 text-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><Edit3 className="w-5 h-5" /></button>
                 <button onClick={onClose} className="p-3 bg-[#FCA5A5] border-2 border-stone-900 text-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><X className="w-5 h-5" /></button>
              </div>
           </div>

           <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar px-1">
              <div className="bg-white p-8 rounded-[2rem] border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b]">
                 <div className="flex items-center justify-between mb-4">
                    <div className="w-12"></div>
                    <div className="flex items-center gap-3">
                       <h3 className="text-4xl font-black text-stone-900 tracking-tight">{(word.original || '').toLowerCase()}</h3>
                       {word.partOfSpeech && <span className="bg-[#FDE047] border-2 border-stone-900 text-stone-900 font-black px-3 py-1 rounded-xl text-xs uppercase shadow-[2px_2px_0_0_#1c1c1b]">{word.partOfSpeech}</span>}
                    </div>
                    <button onClick={() => ApiClient.playTTS(word.original)} className="w-12 h-12 flex items-center justify-center bg-[#A7F3D0] border-2 border-stone-900 text-stone-900 rounded-full shadow-[2px_2px_0_0_#1c1c1b] hover:bg-[#4ADE80] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">
                       <Volume2 className="w-6 h-6"/>
                    </button>
                 </div>

                 <div className="text-center mb-8">
                    <div className="text-2xl font-black text-[#4ADE80] drop-shadow-sm">{(word.translation || '').toLowerCase()}</div>
                 </div>

                 {word.cambridgeTranslation && (
                    <div className="pt-6 border-t-4 border-dashed border-stone-200">
                       <div className="text-[10px] font-black text-stone-400 uppercase text-center mb-2">Определение</div>
                       <div className="text-stone-700 font-bold text-center text-md leading-relaxed">{word.cambridgeTranslation}</div>
                    </div>
                 )}

                 {(word.transcriptionUK || word.transcriptionUS) && (
                    <div className="pt-6 border-t-4 border-dashed border-stone-200">
                       <div className="text-[10px] font-black text-stone-400 uppercase text-center mb-3">Транскрипция</div>
                       <div className="flex justify-center gap-4 text-md font-black text-stone-700">
                          {word.transcriptionUK && <span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">UK: [{word.transcriptionUK}]</span>}
                          {word.transcriptionUS && <span className="bg-white px-4 py-2 rounded-xl border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b]">US: [{word.transcriptionUS}]</span>}
                       </div>
                    </div>
                 )}

                 {(word.examples || []).map((ex:any, i:number) => (
                    <div key={i} className="mt-8 p-6 bg-[#93C5FD] border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] rounded-[2rem] text-center">
                       <div className="text-[10px] font-black text-stone-900 uppercase mb-3 opacity-60">Как применять</div>
                       <div className="font-black text-stone-900 mb-3 text-2xl">"{ex.text}"</div>
                       <div className="text-md font-bold text-stone-900 opacity-80">{(ex.translation || '').toLowerCase()}</div>
                    </div>
                 ))}

                 {relatedTabs.length > 0 && (
                    <div className="mt-8 pt-6 border-t-4 border-dashed border-stone-200 text-center">
                       <div className="text-[10px] font-black text-stone-400 uppercase mb-4">Связанные слова</div>
                       <div className="flex flex-wrap justify-center gap-3">
                          {relatedTabs.map((rw: any, i: number) => {
                             const cleanRW = (rw.word || '').toLowerCase();
                             const existing = (words||[]).find((w:any) => (w.original || '').toLowerCase() === cleanRW);
                             if (existing) {
                                return <button key={i} onClick={() => onWordClick(existing.id)} className="px-4 py-2 bg-stone-900 text-white rounded-xl text-sm font-black active:scale-95 transition-all shadow-[2px_2px_0_0_#1c1c1b]">{cleanRW}</button>;
                             }
                             return <span key={i} className="px-4 py-2 bg-stone-100 border-2 border-stone-900 text-stone-500 rounded-xl text-sm font-black">{cleanRW}</span>;
                          })}
                       </div>
                    </div>
                 )}

                 {(word.groupIds || []).length > 0 && (
                    <div className="mt-8 pt-6 border-t-4 border-dashed border-stone-200 text-center">
                       <div className="text-[10px] font-black text-stone-400 uppercase mb-4">Папки</div>
                       <div className="flex flex-wrap justify-center gap-3">
                          {(word.groupIds || []).map((gid: string) => {
                             const g = (groups || []).find((x:Group) => x.id === gid);
                             return g ? <span key={gid} className="px-4 py-2 bg-[#D8B4FE] border-2 border-stone-900 text-stone-900 rounded-xl text-sm font-black shadow-[2px_2px_0_0_#1c1c1b]">{g.name}</span> : null;
                          })}
                       </div>
                    </div>
                 )}
              </div>
           </div>
        </motion.div>
     </div>
  );
}

function WordEditorModal({ word, words, groups, userProfile, onClose, onSave, onDelete, onReset, onWordClick }: any) {
  if (!word) return null;

  const [original, setOriginal] = useState(word.original || '');
  const [translation, setTranslation] = useState(word.translation || '');
  const [cambridgeTranslation, setCambridgeTranslation] = useState(word.cambridgeTranslation || '');
  const [transcriptionUK, setTranscriptionUK] = useState(word.transcriptionUK || '');
  const [transcriptionUS, setTranscriptionUS] = useState(word.transcriptionUS || '');
  const [exampleText, setExampleText] = useState(word.examples?.[0]?.text || '');
  const [exampleTranslation, setExampleTranslation] = useState(word.examples?.[0]?.translation || '');
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(word.groupIds || []));
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [loadingRelated, setLoadingRelated] = useState<string | null>(null);

  useEffect(() => {
     if(word) {
        setOriginal(word.original || ''); setTranslation(word.translation || ''); setCambridgeTranslation(word.cambridgeTranslation || '');
        setTranscriptionUK(word.transcriptionUK || ''); setTranscriptionUS(word.transcriptionUS || '');
        setExampleText(word.examples?.[0]?.text || ''); setExampleTranslation(word.examples?.[0]?.translation || '');
        setGroupIds(new Set(word.groupIds || []));
     }
  }, [word]);

  const handleRegenerateExample = async () => {
     setIsRegenerating(true);
     const newEx = await ApiClient.aiRegenerateExample(original, userProfile?.level);
     if (newEx.text) { setExampleText(newEx.text); setExampleTranslation(newEx.translation); }
     setIsRegenerating(false);
  };

  const handleSave = () => {
     onSave({ ...word, original: (original || '').toLowerCase().trim(), translation: (translation || '').toLowerCase().trim(), cambridgeTranslation, transcriptionUK, transcriptionUS, groupIds: Array.from(groupIds || []), examples: exampleText ? [{ text: exampleText, translation: exampleTranslation }] : [] });
     onClose();
  };

  const handleAddRelated = async (rw: any) => {
     const cleanRW = (rw.word || '').toLowerCase();
     setLoadingRelated(cleanRW);
     const result = await ApiClient.aiGenerateWord(cleanRW, userProfile?.level);
     const id = doc(collection(db, 'users', auth.currentUser!.uid, 'words')).id;
     await setDoc(doc(db, 'users', auth.currentUser!.uid, 'words', id), { ...result, id, original: cleanRW, translation: (result.translationOptions?.[0] || result.translation || rw.translation || '').toLowerCase(), createdAt: Date.now(), masteryLevel: 0, lastPracticed: Date.now() });
     setLoadingRelated(null);
     onWordClick(id); 
  };

  const relatedTabs = word.relatedWords || [];

  return (
     <div className="fixed inset-0 z-[100] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-[#FEFDF8] w-full max-w-lg rounded-t-[2.5rem] p-6 border-t-4 border-x-4 border-stone-900 shadow-[0_-8px_0_0_#1c1c1b] flex flex-col max-h-[90vh] relative z-10">
           
           {/* ВКЛАДКИ (Формы слова) */}
           {relatedTabs.length > 0 && (
              <div className="flex overflow-x-auto gap-3 pb-4 mb-2 hide-scrollbar">
                  <button className="px-5 py-3 bg-[#4ADE80] border-2 border-stone-900 text-stone-900 rounded-2xl text-sm font-black shrink-0 shadow-[4px_4px_0_0_#1c1c1b] -translate-y-1">{(word.original || '').toLowerCase()}</button>
                  {relatedTabs.map((rw: any, i: number) => {
                      const cleanRW = (rw.word || '').toLowerCase();
                      const existing = (words||[]).find((w:any) => (w.original || '').toLowerCase() === cleanRW);
                      if (existing) {
                           return <button key={i} onClick={() => onWordClick(existing.id)} className="px-5 py-3 bg-white border-2 border-stone-900 text-stone-600 hover:bg-stone-50 rounded-2xl text-sm font-black shrink-0 transition-all">{cleanRW}</button>
                      } else {
                           return <button key={i} onClick={() => handleAddRelated(rw)} disabled={loadingRelated === cleanRW} className="px-5 py-3 bg-white border-2 border-stone-900 border-dashed text-stone-400 rounded-2xl text-sm font-black shrink-0 flex items-center gap-2 active:translate-x-[2px] active:translate-y-[2px] transition-all disabled:opacity-50">{loadingRelated === cleanRW ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4"/>} {cleanRW}</button>
                      }
                  })}
              </div>
           )}

           <div className="flex justify-between items-center mb-8 shrink-0 px-2">
              <h2 className="text-2xl font-black text-stone-900 flex items-center gap-3"><Edit3 className="w-6 h-6 text-[#FDE047]"/> Редактор</h2>
              <div className="flex items-center gap-3">
                 <button onClick={()=>{ onReset(); onClose(); }} className="p-3 bg-[#FDE047] border-2 border-stone-900 text-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><RotateCcw className="w-5 h-5" /></button>
                 <button onClick={onDelete} className="p-3 bg-[#FCA5A5] border-2 border-stone-900 text-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><Trash2 className="w-5 h-5" /></button>
                 <button onClick={onClose} className="p-3 bg-white border-2 border-stone-900 text-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><X className="w-5 h-5" /></button>
              </div>
           </div>
           
           <div className="flex-1 overflow-y-auto space-y-5 pb-6 hide-scrollbar px-1">
              <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">Слово (англ)</label><input value={(original || '').toLowerCase()} onChange={e => setOriginal((e.target.value || '').toLowerCase())} className="w-full bg-white px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-black text-lg" /></div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">UK Транскрипция</label><input value={transcriptionUK} onChange={e => setTranscriptionUK(e.target.value)} className="w-full bg-white px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold" /></div>
                  <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">US Транскрипция</label><input value={transcriptionUS} onChange={e => setTranscriptionUS(e.target.value)} className="w-full bg-white px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold" /></div>
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">Перевод</label><input value={(translation || '').toLowerCase()} onChange={e => setTranslation((e.target.value || '').toLowerCase())} className="w-full bg-[#A7F3D0] px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-black text-stone-900 text-lg" /></div>
              <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">Cambridge Dictionary</label><textarea value={cambridgeTranslation} onChange={e => setCambridgeTranslation(e.target.value)} className="w-full bg-white px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-sm min-h-[80px]" /></div>
              <div className="space-y-2">
                 <div className="flex justify-between items-center"><label className="text-[10px] font-black text-stone-400 uppercase">Пример ИИ</label><button onClick={handleRegenerateExample} disabled={isRegenerating} className="text-[10px] font-black text-[#D8B4FE] flex items-center gap-1 active:scale-95"><RefreshCw className={`w-3 h-3 ${isRegenerating?'animate-spin':''}`}/> Переписать</button></div>
                 <textarea value={exampleText} onChange={e => setExampleText(e.target.value)} className="w-full bg-[#93C5FD] px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-black text-stone-900 text-lg min-h-[80px]" />
              </div>
              <div className="space-y-2"><label className="text-[10px] font-black text-stone-400 uppercase">Перевод примера</label><textarea value={exampleTranslation} onChange={e => setExampleTranslation(e.target.value)} className="w-full bg-[#BFDBFE] px-5 py-4 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-stone-900 text-sm min-h-[60px]" /></div>
              <div className="pt-6 border-t-4 border-dashed border-stone-200 mt-6"><label className="text-[10px] font-black text-stone-400 uppercase mb-4 block">Лежит в папках</label><div className="flex flex-wrap gap-3 mb-6">{(groups||[]).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(groupIds); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setGroupIds(s); }} className={`px-5 py-3 rounded-2xl text-sm font-black border-2 border-stone-900 shadow-[2px_2px_0_0_#1c1c1b] transition-all flex items-center gap-2 ${(groupIds||new Set()).has(g.id) ? 'bg-[#D8B4FE] text-stone-900 translate-x-[2px] translate-y-[2px] shadow-none' : 'bg-white text-stone-600 hover:bg-stone-50'}`}>{(groupIds||new Set()).has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>
           </div>
           <button onClick={handleSave} className="w-full py-6 mt-4 bg-stone-900 text-white font-black rounded-[2rem] shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all text-xl shrink-0">Сохранить правки</button>
        </motion.div>
     </div>
  );
}

function AddGroupModal({ onClose, onSave }: any) {
   const [name, setName] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-8 border-4 border-stone-900 shadow-[8px_8px_0_0_#1c1c1b] relative z-10">
           <h2 className="text-2xl font-black mb-6 text-stone-900">Новая папка</h2>
           <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Название..." className="w-full bg-white px-5 py-5 rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] outline-none focus:translate-x-[2px] focus:translate-y-[2px] focus:shadow-none transition-all font-bold text-lg" />
           <div className="mt-8 flex gap-4">
              <button onClick={onClose} className="flex-1 py-4 bg-white border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all">Отмена</button>
              <button onClick={() => name && onSave(name)} className="flex-1 py-4 bg-[#4ADE80] border-2 border-stone-900 text-stone-900 font-black rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all disabled:opacity-50" disabled={!name}>Создать</button>
           </div>
        </motion.div>
      </div>
   );
}

function BulkAddGroupModal({ groups, onClose, onSave, onOpenAddGroup }: any) {
   return (
      <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="bg-[#FEFDF8] w-full max-w-md rounded-t-[2.5rem] p-8 border-t-4 border-x-4 border-stone-900 shadow-[0_-8px_0_0_#1c1c1b] relative z-10">
           <div className="flex justify-between items-center mb-6"><h2 className="text-2xl font-black text-stone-900">Раскидать по папкам</h2><button onClick={onClose} className="p-3 bg-white border-2 border-stone-900 rounded-xl shadow-[2px_2px_0_0_#1c1c1b] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"><X className="w-5 h-5 text-stone-900"/></button></div>
           <button onClick={onOpenAddGroup} className="w-full mb-6 py-5 bg-[#FDE047] text-stone-900 font-black text-lg rounded-2xl border-4 border-stone-900 shadow-[4px_4px_0_0_#1c1c1b] flex justify-center items-center gap-3 active:translate-x-[4px] active:translate-y-[4px] active:shadow-none transition-all"><Plus className="w-6 h-6"/> Новая папка</button>
           <div className="space-y-3 max-h-[40vh] overflow-y-auto hide-scrollbar px-1">
              {(groups||[]).map((g: Group) => <button key={g.id} onClick={() => onSave(g.id)} className="w-full text-left p-5 bg-white border-2 border-stone-900 rounded-2xl shadow-[4px_4px_0_0_#1c1c1b] font-black text-lg active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all flex items-center justify-between text-stone-900">{g.name} <ArrowRight className="w-6 h-6 text-stone-900"/></button>)}
           </div>
        </motion.div>
      </div>
   );
}