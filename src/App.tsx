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
  Volume2, VolumeX
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

// ==========================================
// МЕНЕДЖЕР ЗВУКОВ (WEB AUDIO API)
// ==========================================
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
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;

      if (type === 'click') {
         osc.type = 'sine';
         osc.frequency.setValueAtTime(600, now);
         osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
         gain.gain.setValueAtTime(0.05, now);
         gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
         osc.start(now); osc.stop(now + 0.05);
      } else if (type === 'menu') {
         osc.type = 'sine';
         osc.frequency.setValueAtTime(400, now);
         osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
         gain.gain.setValueAtTime(0.05, now);
         gain.gain.linearRampToValueAtTime(0, now + 0.1);
         osc.start(now); osc.stop(now + 0.1);
      } else if (type === 'correct') {
         osc.type = 'sine';
         osc.frequency.setValueAtTime(523.25, now); // C5
         osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
         gain.gain.setValueAtTime(0.1, now);
         gain.gain.linearRampToValueAtTime(0, now + 0.3);
         osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'wrong') {
         osc.type = 'sine'; 
         osc.frequency.setValueAtTime(350, now);
         osc.frequency.setValueAtTime(250, now + 0.15); 
         gain.gain.setValueAtTime(0.1, now);
         gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
         osc.start(now); osc.stop(now + 0.3);
      } else if (type === 'finish') {
         osc.type = 'sine';
         osc.frequency.setValueAtTime(440, now);           
         osc.frequency.setValueAtTime(554.37, now + 0.08);  
         osc.frequency.setValueAtTime(659.25, now + 0.16);  
         osc.frequency.setValueAtTime(880, now + 0.24);     
         gain.gain.setValueAtTime(0, now);
         gain.gain.linearRampToValueAtTime(0.15, now + 0.05); 
         gain.gain.setValueAtTime(0.15, now + 0.24); 
         gain.gain.exponentialRampToValueAtTime(0.001, now + 1.04);
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
   } else {
       await updateDoc(profileRef, { activity });
   }
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

// --- CUSTOM MODALS ---
function AlertModal({ title, message, type='error', onClose }: any) {
   return (
       <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card p-6 relative z-10 w-full max-w-sm text-center">
              {type === 'error' ? <XCircle className="w-16 h-16 text-[#D99C3B] mx-auto mb-4"/> : type === 'success' ? <CheckCircle2 className="w-16 h-16 text-[#88D64F] mx-auto mb-4"/> : <Info className="w-16 h-16 text-[#A235D8] mx-auto mb-4"/>}
              <h2 className="text-2xl font-marker mb-2 text-[#111111]">{title}</h2>
              <p className="text-[#111111] text-sm mb-6 font-bold">{message}</p>
              <button onClick={onClose} className="w-full py-4 bg-[#88D64F] text-[#111111] zine-btn">ОК</button>
           </motion.div>
       </div>
   )
}

function ConfirmModal({ title, message, onConfirm, onClose }: any) {
   return (
       <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card p-6 relative z-10 w-full max-w-sm text-center">
              <AlertTriangle className="w-16 h-16 text-[#D99C3B] mx-auto mb-4"/>
              <h2 className="text-2xl font-marker mb-2 text-[#111111]">{title}</h2>
              <p className="text-[#111111] text-sm mb-6 font-bold">{message}</p>
              <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-4 bg-[#F2EDE4] text-[#111111] zine-btn">Отмена</button>
                  <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-4 bg-[#D99C3B] text-[#111111] zine-btn">Подтвердить</button>
              </div>
           </motion.div>
       </div>
   )
}

// --- AUTH COMPONENT ---
function AuthScreen() {
   const [view, setView] = useState<'login'|'register'|'forgot'>('login');
   const [email, setEmail] = useState('');
   const [password, setPassword] = useState('');
   const [name, setName] = useState('');
   const [loading, setLoading] = useState(false);
   const [alertData, setAlertData] = useState<{title:string, message:string, type:'error'|'success'}|null>(null);
   const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);

   const handleGoogle = async () => { 
      try { 
         await signInWithPopup(auth, new GoogleAuthProvider()); 
      } catch(e:any) { 
         if (e.code !== 'auth/popup-closed-by-user') {
            setAlertData({title: "Ошибка", message: translateAuthError(e.code), type: 'error'}); 
         }
      } 
   };
   
   const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault(); setLoading(true);
      try {
         if (view === 'login') {
            const res = await signInWithEmailAndPassword(auth, email, password);
            if (!res.user.emailVerified) { setAlertData({title:"Почта не подтверждена", message: "Мы отправили вам новое письмо. Подтвердите почту.", type:'error'}); await sendEmailVerification(res.user); }
         } else if (view === 'register') {
            const res = await createUserWithEmailAndPassword(auth, email, password);
            await updateProfile(res.user, { displayName: name });
            await sendEmailVerification(res.user);
            setAlertData({title:"Успех", message:"Регистрация успешна! Проверьте вашу почту (и папку Спам) для подтверждения.", type:'success'});
         } else if (view === 'forgot') {
            await sendPasswordResetEmail(auth, email);
            setAlertData({title:"Успех", message: "Инструкции по восстановлению отправлены на вашу почту.", type: 'success'});
            setView('login');
         }
      } catch(e:any) { 
         if (view === 'login' && (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential' || e.code === 'auth/invalid-login-credentials')) {
             setShowRegisterPrompt(true);
         } else {
             setAlertData({title:"Ошибка", message: translateAuthError(e.code), type: 'error'}); 
         }
      }
      setLoading(false);
   };

   return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-[#F2EDE4]">
        {alertData && <AlertModal title={alertData.title} message={alertData.message} type={alertData.type} onClose={()=>setAlertData(null)} />}
        
        {showRegisterPrompt && (
           <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
               <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowRegisterPrompt(false)} />
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card p-6 relative z-10 w-full max-w-sm text-center">
                  <UserIcon className="w-16 h-16 text-[#A235D8] mx-auto mb-4"/>
                  <h2 className="text-2xl font-marker mb-2 text-[#111111]">Аккаунт не найден</h2>
                  <p className="text-[#111111] font-bold text-sm mb-6">Кажется, вы еще не зарегистрированы или ввели неверный пароль. Хотите создать новый аккаунт с этим email?</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => { setShowRegisterPrompt(false); setView('register'); }} className="w-full py-4 bg-[#88D64F] text-[#111111] zine-btn">Создать аккаунт</button>
                      <button onClick={() => setShowRegisterPrompt(false)} className="w-full py-4 bg-[#F2EDE4] text-[#111111] zine-btn">Попробовать снова</button>
                  </div>
               </motion.div>
           </div>
        )}

        <div className="zine-card p-8 w-full max-w-sm flex flex-col items-center rotate-1">
           <BookOpen className="w-16 h-16 text-[#A235D8] mb-4 -rotate-6" />
           <h1 className="text-5xl font-marker mb-2 text-center text-[#111111] uppercase">Фрогги</h1>
           <p className="text-[#111111] font-bold text-center mb-8 text-sm">ТВОЙ ИИ-РЕПЕТИТОР.</p>
           
           <form onSubmit={handleSubmit} className="w-full space-y-4">
              {view === 'register' && <input required value={name} onChange={e=>setName(e.target.value)} type="text" placeholder="Ваше имя" className="w-full px-4 py-4 zine-input text-lg font-bold" />}
              <input required value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" className="w-full px-4 py-4 zine-input text-lg font-bold" />
              {view !== 'forgot' && <input required value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Пароль" className="w-full px-4 py-4 zine-input text-lg font-bold" />}
              
              <button type="submit" disabled={loading} className="w-full py-4 bg-[#88D64F] text-[#111111] zine-btn disabled:opacity-50 mt-4">
                 {loading ? <Loader2 className="animate-spin mx-auto w-6 h-6"/> : view === 'login' ? 'Войти в систему' : view === 'register' ? 'Зарегистрироваться' : 'Восстановить пароль'}
              </button>
           </form>

           <div className="w-full flex justify-between items-center mt-6 text-sm font-bold text-[#111111]">
              {view !== 'forgot' ? (
                 <>
                    <button onClick={()=>setView(view==='login'?'register':'login')} className="hover:text-[#A235D8] underline decoration-2">{view === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт?'}</button>
                    {view === 'login' && <button onClick={()=>setView('forgot')} className="hover:text-[#D99C3B] underline decoration-2">Забыли пароль?</button>}
                 </>
              ) : (
                 <button onClick={()=>setView('login')} className="mx-auto w-full text-center underline decoration-2 hover:text-[#A235D8]">Вернуться ко входу</button>
              )}
           </div>

           {view !== 'forgot' && (
              <>
                 <div className="w-full border-t-[3px] border-black my-6 border-dashed"></div>
                 <button onClick={handleGoogle} className="w-full py-4 bg-[#F2EDE4] text-[#111111] zine-btn flex items-center justify-center gap-3">
                   <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" /> Google
                 </button>
              </>
           )}
        </div>
      </div>
   );
}

// --- MAIN WRAPPER ---
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
      } else if (clickableCard) {
         SoundManager.play('click');
      }
    };
    document.addEventListener('click', handleGlobalClick, true);
    return () => document.removeEventListener('click', handleGlobalClick, true);
  }, []);

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;
  if (!user) return <AuthScreen />;
  
  if (!user.emailVerified && user.providerData && user.providerData.length > 0 && user.providerData[0]?.providerId === 'password') {
     return <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center text-[#F2EDE4]"><Mail className="w-20 h-20 text-[#D99C3B] mb-6"/><h2 className="text-3xl font-marker mb-4 text-[#88D64F]">Подтвердите Email</h2><p className="font-bold mb-8 text-lg">Письмо отправлено на {user.email}. Подтвердите почту и обновите страницу.</p><button onClick={()=>signOut(auth)} className="px-8 py-4 bg-[#A235D8] text-[#111111] zine-btn">Выйти</button></div>;
  }
  return <MainApp user={user} />;
}

// --- MAIN APP ---
function MainApp({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'dict' | 'groups' | 'train' | 'progress' | 'settings'>('dict');
  const [words, setWords] = useState<Word[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(SoundManager.enabled);
  
  const [appAlert, setAppAlert] = useState<{title:string, message:string, type?:'error'|'success'|'info'}|null>(null);
  const [appConfirm, setAppConfirm] = useState<{title:string, message:string, onConfirm:()=>void}|null>(null);

  const [calendarDate, setCalendarDate] = useState(new Date());
  const [dictSearch, setDictSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');

  useEffect(() => {
    const unsubWords = onSnapshot(collection(db, 'users', user.uid, 'words'), snap => setWords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Word))));
    const unsubGroups = onSnapshot(collection(db, 'users', user.uid, 'groups'), snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group))));
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid, 'profile', 'data'), snap => {
       if (snap.exists()) {
           const data = snap.data(); setUserProfile(data);
           if(data.level) localStorage.setItem('userLevel', data.level);
       } else { setUserProfile({ level: 'Intermediate', onboarded: false, dailyGoal: 15, activity: {}, streak: 0 }); }
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
      setTrainingSnapshot(wordsForTrain);
      setActiveTrainingMode(mode);
      setSessionStats({correct: 0, total: 0});
      setTrainingStartTime(Date.now());
  };

  const closeTraining = async () => {
      if (trainingStartTime > 0) {
          const minutesSpent = Math.ceil((Date.now() - trainingStartTime) / 60000);
          await updateDailyProgress(user.uid, minutesSpent);
      }
      setActiveTrainingMode(null);
  };

  const deleteWords = (ids: string[]) => {
    ids.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'words', id)));
    const newSelected = new Set(selectedWordIds); ids.forEach(id => newSelected.delete(id)); setSelectedWordIds(newSelected);
  };
  const resetProgress = (ids: string[]) => {
     ids.forEach(id => updateDoc(doc(db, 'users', user.uid, 'words', id), { correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0, lastPracticed: Date.now() }));
     setSelectedWordIds(new Set());
  };
  const resetAllProgress = () => {
     setAppConfirm({title:"Сброс прогресса", message:"Сбросить весь прогресс изучения? Слова останутся в словаре.", onConfirm: () => {
        words.forEach(w => updateDoc(doc(db, 'users', user.uid, 'words', w.id), { correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0, lastPracticed: Date.now() }));
     }});
  };
  const resetEntireDictionary = async () => {
     setAppConfirm({title:"Очистка словаря", message:"ВНИМАНИЕ! Это удалит ВСЕ слова и группы навсегда! Вы уверены?", onConfirm: async () => {
        words.forEach(w => deleteDoc(doc(db, 'users', user.uid, 'words', w.id)));
        groups.forEach(g => deleteDoc(doc(db, 'users', user.uid, 'groups', g.id)));
        await updateDoc(doc(db, 'users', user.uid, 'profile', 'data'), { activity: {}, streak: 0 });
     }});
  };

  const handleUpdateProgress = (wordId: string, isCorrect: boolean, mode: string = 'general') => {
    setSessionStats(s => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    const word = words.find(w => w.id === wordId); if (!word) return;
    if (mode === 'sentence' && isCorrect) return; 

    const effectiveMastery = getEffectiveMastery(word);
    let newMastery = effectiveMastery + (isCorrect ? 20 : -10);
    if (newMastery > 100) newMastery = 100; if (newMastery < 0) newMastery = 0;
    
    updateDoc(doc(db, 'users', user.uid, 'words', wordId), { 
       correctAnswers: (word.correctAnswers || 0) + (isCorrect ? 1 : 0), 
       incorrectAnswers: (word.incorrectAnswers || 0) + (!isCorrect ? 1 : 0), 
       masteryLevel: newMastery,
       lastPracticed: Date.now()
    });
  };

  const deleteGroup = (groupId: string) => {
    deleteDoc(doc(db, 'users', user.uid, 'groups', groupId));
    words.forEach(w => { if ((w.groupIds || []).includes(groupId)) updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: (w.groupIds || []).filter(id => id !== groupId) }); });
  };

  const handleDeleteAccount = async () => {
    const isGoogleAuth = user.providerData.some(p => p.providerId === 'google.com');
    if (isGoogleAuth) {
       setAppConfirm({title: "Удаление аккаунта", message: "Действие необратимо. Подтвердите удаление через ваш Google-аккаунт.", onConfirm: async () => {
           try {
              const provider = new GoogleAuthProvider();
              await reauthenticateWithPopup(user, provider);
              words.forEach(w => deleteDoc(doc(db, 'users', user.uid, 'words', w.id)));
              groups.forEach(g => deleteDoc(doc(db, 'users', user.uid, 'groups', g.id)));
              await deleteUser(user);
           } catch(e:any) { setAppAlert({title:"Ошибка", message: translateAuthError(e.code), type:'error'}); }
       }});
    } else {
       setShowDeleteConfirm(true);
    }
  };

  const prevMonth = () => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1));
  const nextMonth = () => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1));
  const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  const currentMonthName = monthNames[calendarDate.getMonth()];
  const currentYear = calendarDate.getFullYear();
  const daysInMonth = new Date(currentYear, calendarDate.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => { let day = new Date(year, month, 1).getDay(); return day === 0 ? 6 : day - 1; };
  const startDay = getFirstDayOfMonth(currentYear, calendarDate.getMonth());

  if (!isDataLoaded) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;
  if (userProfile && !userProfile.onboarded) return <OnboardingModal user={user} onSave={(level: string, goal: number) => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, dailyGoal: goal, onboarded: true, activity: {}, streak: 0 }, { merge: true })} />;

  const filteredDictWords = words.filter(w => (w.original || '').toLowerCase().includes(dictSearch.toLowerCase()) || (w.translation || '').toLowerCase().includes(dictSearch.toLowerCase()));
  const filteredGroups = (groups || []).filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));

  return (
    <div className="min-h-screen font-mono text-[#F2EDE4] md:flex flex-row relative overflow-hidden">
      {appAlert && <AlertModal title={appAlert.title} message={appAlert.message} type={appAlert.type} onClose={()=>setAppAlert(null)}/>}
      {appConfirm && <ConfirmModal title={appConfirm.title} message={appConfirm.message} onConfirm={appConfirm.onConfirm} onClose={()=>setAppConfirm(null)}/>}
      
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-[#1E1B24] border-r-[4px] border-black p-4 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4 text-[#88D64F] -rotate-2"><BookOpen className="w-10 h-10" /> <span className="text-4xl font-marker">Фрогги</span></div>
          <nav className="flex-1 space-y-4 mt-8">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); setDictSearch(''); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); setGroupSearch(''); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Панк-Тест" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'progress'} icon={<Calendar />} label="Прогресс" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Меню" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-[#1E1B24] border-t-[4px] border-black flex justify-around items-center px-2 z-40 pb-safe">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-7 h-7" />} label="СЛОВАРЬ" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); setDictSearch(''); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-7 h-7" />} label="ГРУППЫ" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); setGroupSearch(''); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-7 h-7" />} label="УЧИТЬ" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'progress'} icon={<Calendar className="w-7 h-7" />} label="УСПЕХ" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-7 h-7" />} label="НАСТРОЙКИ" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      <main className={`flex-1 flex flex-col h-screen overflow-y-auto ${!activeTrainingMode ? 'md:ml-64 pb-24 md:pb-0' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col">
          {!activeTrainingMode && !viewingGroupId && (
            <div className="sticky top-0 z-30 pt-12 md:pt-8 pb-4 px-4 md:px-8 border-b-[4px] border-black bg-[#1E1B24]">
              <h1 className="text-4xl font-marker tracking-tight text-[#88D64F] -rotate-1">
                 {activeTab === 'dict' ? 'Твой Словарь' : activeTab === 'groups' ? 'Группы' : activeTab === 'train' ? 'Панк-Тренировка' : activeTab === 'progress' ? 'Твой Путь' : 'Настройки'}
              </h1>
            </div>
          )}

          <div className="flex-1 w-full relative">
            <AnimatePresence mode="wait">
               {/* 1. Вкладка Словарь */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
                 <motion.div key="tab-dict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 space-y-4 pb-32 md:pb-8">
                   
                   {words.length > 0 && (
                      <div className="relative mb-6">
                         <Search className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]" />
                         <input type="text" placeholder="Искать..." value={dictSearch} onChange={e => setDictSearch(e.target.value)} className="w-full pl-14 pr-4 py-4 zine-input text-xl font-bold" />
                      </div>
                   )}

                   {words.length > 0 && (
                      <div className="flex justify-between items-center px-1 mb-4">
                         <button onClick={() => {
                            const allFilteredSelected = filteredDictWords.length > 0 && filteredDictWords.every(w => selectedWordIds.has(w.id));
                            const newSet = new Set(selectedWordIds);
                            if (allFilteredSelected) { filteredDictWords.forEach(w => newSet.delete(w.id)); } 
                            else { filteredDictWords.forEach(w => newSet.add(w.id)); }
                            setSelectedWordIds(newSet);
                         }} className="text-lg font-bold text-[#88D64F] flex items-center gap-2 underline decoration-2 uppercase">
                            <CheckCircle2 className="w-6 h-6"/> 
                            {filteredDictWords.length > 0 && filteredDictWords.every(w => selectedWordIds.has(w.id)) ? 'Снять все' : 'Выбрать все'}
                         </button>
                      </div>
                   )}

                   {words.length === 0 ? <div className="text-center text-[#F2EDE4] text-xl font-bold py-12 rotate-2">Словарь пуст, чувак.</div> : filteredDictWords.length === 0 ? <div className="text-center text-[#F2EDE4] font-bold text-xl py-12 -rotate-2">Глухо. Ничего нет.</div> : filteredDictWords.map((word, index) => (
                     <div key={word.id} className={`zine-card p-5 mb-4 flex items-center gap-4 cursor-pointer clickable-card ${index % 2 === 0 ? 'rotate-1' : '-rotate-1'}`} onClick={() => setViewingWordId(word.id)}>
                        <button onClick={(e) => { e.stopPropagation(); const n = new Set(selectedWordIds); n.has(word.id)?n.delete(word.id):n.add(word.id); setSelectedWordIds(n); }} className={`shrink-0 w-8 h-8 rounded-none border-[3px] border-black flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-[#88D64F]' : 'bg-white'}`}>{selectedWordIds.has(word.id) && <Check className="w-6 h-6 text-[#111111] font-black" />}</button>
                        <div className="flex-1">
                          <div className="flex items-center gap-3"><h3 className="text-2xl font-black uppercase text-[#111111]">{(word.original || '').toLowerCase()}</h3> {word.partOfSpeech && <span className="text-[12px] font-bold text-[#F2EDE4] uppercase bg-[#111111] px-2 py-1 rounded-none border-[2px] border-black">{word.partOfSpeech}</span>}</div>
                          <p className="text-[#111111] font-bold text-lg mt-1 line-clamp-1">{(word.translation || '').toLowerCase()}</p>
                          <MasteryBar masteryLevel={getEffectiveMastery(word)} />
                        </div>
                     </div>
                   ))}
                   {selectedWordIds.size === 0 && (
                      <div className="fixed bottom-24 md:bottom-8 right-5 md:right-8 flex flex-col gap-4 z-20">
                         <button onClick={() => setShowGenerateModal(true)} className="w-16 h-16 bg-[#A235D8] text-[#111111] zine-btn flex items-center justify-center"><Wand2 className="w-8 h-8" /></button>
                         <button onClick={() => setShowAddWord(true)} className="w-16 h-16 bg-[#88D64F] text-[#111111] zine-btn flex items-center justify-center"><Plus className="w-8 h-8 font-black" /></button>
                      </div>
                   )}
                   <BulkActions selectedWordIds={selectedWordIds} onTrain={() => setActiveTab('train')} onDelete={(ids:string[]) => setAppConfirm({title:'Удаление', message:`Удалить (${ids.length}) слов?`, onConfirm: ()=>deleteWords(ids)})} onReset={(ids:string[]) => setAppConfirm({title:'Сброс', message:`Обнулить (${ids.length}) слов?`, onConfirm: ()=>resetProgress(ids)})} onAddToGroup={() => setShowBulkAddGroup(true)} />
                 </motion.div>
               )}

               {/* 2. Вкладка Группы */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
                 <motion.div key="tab-groups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 space-y-4 pb-32 md:pb-8">
                    <button onClick={() => setShowAddGroup(true)} className="w-full bg-[#88D64F] text-[#111111] py-5 zine-btn flex items-center justify-center gap-3 mb-8 text-xl"><Plus className="w-7 h-7"/> Создать Группу</button>
                    
                    {(groups || []).length > 0 && (
                      <div className="relative mb-6">
                         <Search className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]" />
                         <input type="text" placeholder="Найти группу..." value={groupSearch} onChange={e => setGroupSearch(e.target.value)} className="w-full pl-14 pr-4 py-4 zine-input text-xl font-bold" />
                      </div>
                    )}

                    {(groups || []).length === 0 ? <div className="text-center text-[#F2EDE4] font-bold text-xl py-12 rotate-2">Пусто. Создай уже группу!</div> : filteredGroups.length === 0 ? <div className="text-center text-[#F2EDE4] font-bold text-xl py-12 -rotate-2">Ничего не найдено.</div> : filteredGroups.map((group, i) => (
                      <div key={group.id} onClick={() => setViewingGroupId(group.id)} className={`zine-card p-6 mb-4 flex items-center gap-4 cursor-pointer clickable-card ${i % 2 === 0 ? '-rotate-1' : 'rotate-1'}`}>
                          <div className="w-14 h-14 border-[3px] border-black bg-[#A235D8] flex items-center justify-center shrink-0"><Layers className="w-8 h-8 text-[#111111]" /></div>
                          <div className="flex-1"><h3 className="text-2xl font-black text-[#111111] uppercase">{group.name}</h3><p className="text-[#111111] font-bold text-sm mt-1 bg-[#F2EDE4] border-2 border-black inline-block px-2">{(words||[]).filter(w=>(w.groupIds||[]).includes(group.id)).length} слов</p></div>
                          <ArrowRight className="w-8 h-8 text-[#111111]" />
                      </div>
                    ))}
                 </motion.div>
               )}

               {/* 3. Вкладка Тренировка */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
                 <motion.div key="tab-train" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                   {(selectedWordIds.size === 0 && selectedGroupIds.size === 0) ? (
                      <div className="mb-8">
                         <p className="text-[#F2EDE4] font-bold text-xl mb-6 bg-[#111111] inline-block px-3 py-1 border-2 border-[#F2EDE4] -rotate-1">Выбери базу для жести:</p>
                         <div className="space-y-4">
                            <button onClick={() => setShowSmartSelection(true)} className="w-full bg-[#A235D8] text-[#111111] p-6 zine-btn text-left flex items-center justify-between text-xl rotate-1">
                               <span className="flex items-center gap-3"><Brain className="w-8 h-8"/> ИИ ПОДБОР</span> <span className="font-bold border-[2px] border-black bg-white px-2 py-1 text-sm">Слабые</span>
                            </button>
                            <button onClick={() => setSelectedWordIds(new Set((words||[]).map(w => w.id)))} className="w-full bg-[#88D64F] text-[#111111] p-6 zine-btn text-left flex items-center justify-between text-xl -rotate-1">
                               <span>ВЕСЬ СЛОВАРЬ</span> <span className="font-bold border-[2px] border-black bg-white px-2 py-1 text-sm">{(words||[]).length} слов</span>
                            </button>
                            {(groups || []).map((group, i) => (
                                  <button key={group.id} onClick={() => setSelectedGroupIds(new Set([group.id]))} className={`w-full bg-[#F2EDE4] text-[#111111] p-6 zine-btn text-left flex items-center justify-between text-xl ${i%2===0?'rotate-1':'-rotate-1'}`}>
                                      <span className="uppercase">{group.name}</span> <span className="font-bold border-[2px] border-black bg-white px-2 py-1 text-sm">{(words||[]).filter(w => (w.groupIds||[]).includes(group.id)).length} слов</span>
                                  </button>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <>
                         <div className="flex items-center justify-between mb-8 zine-card bg-[#F2EDE4] p-5 rotate-1">
                            <p className="text-[#111111] font-bold text-xl uppercase">Выбрано: <span className="font-black text-[#A235D8] border-b-4 border-[#A235D8]">{selectedWordIds.size > 0 ? selectedWordIds.size : (words||[]).filter(w => (w.groupIds||[]).some(id => selectedGroupIds.has(id))).length}</span></p>
                            <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-[#111111] font-bold bg-[#D99C3B] px-4 py-2 border-[3px] border-black flex items-center gap-2 uppercase active:translate-y-1"><X className="w-5 h-5"/> Сброс</button>
                         </div>
                         <div className="grid grid-cols-2 gap-6">
                           <TrainCard title="КАРТОЧКИ" desc="База" icon={<FlipHorizontal />} bg="bg-[#F2EDE4]" onClick={() => startTraining('flashcards')} rotate="-rotate-1" />
                           <TrainCard title="ТЕСТ" desc="Выбор из 4" icon={<CheckCircle2 />} bg="bg-[#88D64F]" onClick={() => startTraining('quiz')} rotate="rotate-2" />
                           <TrainCard title="СБОРКА" desc="Напиши сам" icon={<Layers />} bg="bg-[#D99C3B]" onClick={() => startTraining('constructor')} rotate="rotate-1" />
                           <TrainCard title="ФРАЗЫ" desc="Твой контекст" icon={<Type />} bg="bg-[#A235D8]" onClick={() => startTraining('sentence')} rotate="-rotate-2" />
                           <TrainCard title="ШТУРМ" desc="Комбо-режим" icon={<Brain />} bg="bg-[#F2EDE4]" className="col-span-2" onClick={() => startTraining('brainstorm')} rotate="-rotate-1" />
                         </div>
                      </>
                   )}
                 </motion.div>
               )}

               {/* 4. Вкладка Прогресс */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'progress' && (
                 <motion.div key="tab-progress" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                     <div className="zine-card bg-[#F2EDE4] p-8 mb-8 text-center rotate-1">
                        <div className="text-7xl font-marker text-[#D99C3B] mb-2 drop-shadow-[4px_4px_0_#111111]">🔥 {userProfile?.streak || 0}</div>
                        <div className="text-[#111111] font-bold uppercase tracking-widest text-lg bg-[#A235D8] text-white border-2 border-black inline-block px-4 py-1 -rotate-2">Дней Подряд</div>
                     </div>
                     <h3 className="font-marker text-[#F2EDE4] mb-6 text-3xl">Календарь</h3>
                     <div className="zine-card bg-[#F2EDE4] p-6 -rotate-1">
                        <div className="flex justify-between items-center mb-8 border-b-[4px] border-black pb-4">
                           <button onClick={prevMonth} className="p-2 bg-[#D99C3B] border-2 border-black active:translate-y-1"><ChevronLeft className="w-8 h-8 text-[#111111]"/></button>
                           <span className="font-black text-[#111111] text-xl uppercase">{currentMonthName} {currentYear}</span>
                           <button onClick={nextMonth} className="p-2 bg-[#D99C3B] border-2 border-black active:translate-y-1"><ChevronRight className="w-8 h-8 text-[#111111]"/></button>
                        </div>
                        <div className="grid grid-cols-7 gap-2 md:gap-3">
                           {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><div key={d} className="text-center font-bold text-[#111111] mb-2 text-lg">{d}</div>)}
                           {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`} />)}
                           {Array.from({ length: daysInMonth }).map((_, i) => {
                               const day = i + 1;
                               const dateStr = `${currentYear}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                               const mins = userProfile?.activity?.[dateStr] || 0;
                               const isGoalReached = mins >= (userProfile?.dailyGoal || 15);
                               return <div key={i} className={`aspect-square border-[3px] border-black flex items-center justify-center text-xl font-bold ${isGoalReached ? 'bg-[#88D64F] text-[#111111]' : mins > 0 ? 'bg-[#D99C3B] text-[#111111]' : 'bg-white text-[#111111]'} ${day%2===0?'rotate-2':'-rotate-2'}`}>{day}</div>
                           })}
                        </div>
                     </div>
                 </motion.div>
               )}

               {/* 5. Вкладка Настройки */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
                 <motion.div key="tab-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                     <div className="zine-card bg-[#F2EDE4] p-8 mb-8 rotate-1">
                        <div className="font-black text-2xl text-[#111111] mb-2 uppercase">{user?.displayName || 'Аноним'}</div>
                        <div className="text-[#111111] font-bold text-lg mb-8 bg-[#88D64F] border-[2px] border-black inline-block px-3 py-1 -rotate-2">{user?.email || 'Скрытый email'}</div>
                        
                        <div className="border-t-[4px] border-black border-dashed pt-8">
                           <h3 className="font-marker text-[#111111] mb-6 text-2xl">Твой Уровень</h3>
                           <div className="grid grid-cols-2 gap-4 mb-8">
                             {LEVELS.map((lvl, i) => <button key={lvl} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), level: lvl }, { merge: true })} className={`py-4 text-sm font-black border-[3px] border-black uppercase transition-transform active:translate-y-1 ${i%2===0?'rotate-1':'-rotate-1'} ${userProfile?.level === lvl ? 'bg-[#A235D8] text-[#F2EDE4]' : 'bg-white text-[#111111] hover:bg-[#E0D8C3]'}`}>{lvl}</button>)}
                           </div>
                           <h3 className="font-marker text-[#111111] mb-6 text-2xl">Цель (минут)</h3>
                           <div className="flex gap-3">
                              {[5,10,15,30].map((m, i) => <button key={m} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), dailyGoal: m }, { merge: true })} className={`flex-1 py-4 text-lg font-black border-[3px] border-black transition-transform active:translate-y-1 ${i%2===0?'-rotate-2':'rotate-2'} ${userProfile?.dailyGoal === m ? 'bg-[#D99C3B] text-[#111111]' : 'bg-white text-[#111111] hover:bg-[#E0D8C3]'}`}>{m}</button>)}
                           </div>
                        </div>
                     </div>

                     <h3 className="font-marker text-[#F2EDE4] mb-4 mt-8 text-3xl">Звук</h3>
                     <button onClick={() => { 
                         const newVal = !soundEnabled;
                         setSoundEnabled(newVal);
                         localStorage.setItem('soundEnabled', String(newVal));
                         SoundManager.enabled = newVal;
                         if(newVal) SoundManager.play('click');
                     }} className="w-full zine-btn bg-[#F2EDE4] p-6 flex justify-between items-center font-black text-[#111111] text-xl -rotate-1 mb-8">
                         <span className="flex items-center gap-4">{soundEnabled ? <Volume2 className="w-8 h-8 text-[#88D64F]"/> : <VolumeX className="w-8 h-8 text-[#111111]"/>} Эффекты</span>
                         <span className={`px-4 py-1 border-[2px] border-black ${soundEnabled ? 'bg-[#88D64F]' : 'bg-white'}`}>{soundEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
                     </button>

                     <h3 className="font-marker text-[#D99C3B] mb-6 mt-12 text-3xl">Опасная Зона</h3>
                     <div className="space-y-4">
                       <button onClick={resetAllProgress} className="w-full py-5 bg-[#F2EDE4] text-[#111111] zine-btn flex items-center justify-center gap-3 text-lg rotate-1"><RotateCcw className="w-6 h-6"/> Обнулить прогресс</button>
                       <button onClick={resetEntireDictionary} className="w-full py-5 bg-[#D99C3B] text-[#111111] zine-btn flex items-center justify-center gap-3 text-lg -rotate-1"><Trash2 className="w-6 h-6"/> Сжечь словарь</button>
                       <button onClick={() => setAppConfirm({title:"Побег?", message:"Уходишь?", onConfirm:()=>signOut(auth)})} className="w-full py-6 bg-[#111111] text-[#F2EDE4] border-[4px] border-[#F2EDE4] font-black uppercase text-xl shadow-[6px_6px_0px_#F2EDE4] active:translate-y-1 active:translate-x-1 active:shadow-none transition-all flex justify-center items-center gap-3 mt-12 rotate-2"><LogOut className="w-6 h-6"/> Выйти</button>
                       <button onClick={handleDeleteAccount} className="w-full py-6 text-[#F2EDE4] font-black uppercase text-sm mt-4 underline decoration-4 hover:text-[#D99C3B]">Удалить аккаунт навсегда</button>
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
            {editingWordId && <WordEditorModal words={words} word={(words||[]).find(w=>w.id===editingWordId)!} groups={groups} userProfile={userProfile} user={user} onClose={() => setEditingWordId(null)} onReset={() => setAppConfirm({title:"Сброс прогресса", message:"Сбросить прогресс этого слова?", onConfirm: ()=>resetProgress([editingWordId])})} onWordClick={(id:string)=>{setEditingWordId(null); setViewingWordId(id);}} onSave={(w:any) => { updateDoc(doc(db,'users',user.uid,'words',w.id),w); }} onDelete={() => { setAppConfirm({title:"Удаление", message:"Удалить это слово из словаря?", onConfirm:()=>{deleteWords([editingWordId!]); setEditingWordId(null);}}) }} />}
            
            {showAddGroup && <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { const id=doc(collection(db,'users',user.uid,'groups')).id; setDoc(doc(db,'users',user.uid,'groups',id),{id,name:n}); setShowAddGroup(false); }} />}
            {showBulkAddGroup && <BulkAddGroupModal groups={groups} onClose={() => setShowBulkAddGroup(false)} onOpenAddGroup={() => { setShowAddGroup(true); }} onSave={(gid:string) => { (words||[]).forEach(w=>{if(selectedWordIds.has(w.id)&&!(w.groupIds||[]).includes(gid)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),gid]});}); setShowBulkAddGroup(false); setSelectedWordIds(new Set()); }} />}
            {showSmartSelection && <SmartSelectionModal words={words} onClose={() => setShowSmartSelection(false)} onSelect={(pickedIds: string[]) => { setSelectedWordIds(new Set(pickedIds)); setSelectedGroupIds(new Set()); setShowSmartSelection(false); }} />}
            {viewingGroupId && <GroupView group={(groups||[]).find(g=>g.id===viewingGroupId)!} words={(words||[]).filter(w=>(w.groupIds||[]).includes(viewingGroupId!))} onClose={()=>setViewingGroupId(null)} onDeleteGroup={()=>setAppConfirm({title:"Удаление", message:"Удалить группу?", onConfirm:()=>{deleteGroup(viewingGroupId); setViewingGroupId(null);}})} onRemoveFromGroup={(wid:string)=>{ const w=(words||[]).find(x=>x.id===wid); if(w) updateDoc(doc(db,'users',user.uid,'words',wid),{groupIds:(w.groupIds||[]).filter(g=>g!==viewingGroupId)}); }} selectedWordIds={selectedWordIds} setSelectedWordIds={setSelectedWordIds} onTrain={()=>{ setActiveTab('train'); setViewingGroupId(null); }} onWordClick={(id:string)=>setViewingWordId(id)} />}
            {showDeleteConfirm && <DeleteAccountModal onClose={() => setShowDeleteConfirm(false)} onDelete={async (pwd: string) => { try { const cred = EmailAuthProvider.credential(user.email!, pwd); await reauthenticateWithCredential(user, cred); await resetEntireDictionary(); await deleteUser(user); } catch(e:any) { setAppAlert({title:"Ошибка", message:"Неверный пароль. Попробуйте еще раз.", type:"error"}); } }} />}
          </AnimatePresence>
        </div>
      </main>

      {/* ЭКРАНЫ ТРЕНИРОВОК */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div key="training-overlay" initial={{ opacity: 0, y: '10%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '10%' }} className="fixed inset-0 bg-[#1E1B24] z-50 flex flex-col noise-bg">
               <div className="flex justify-between items-center p-4 md:p-8 border-b-[4px] border-black bg-[#88D64F]">
                  <span className="font-marker text-3xl text-[#111111] uppercase">{activeTrainingMode === 'stats' ? 'ИТОГИ' : activeTrainingMode}</span>
                  {activeTrainingMode !== 'stats' && <button onClick={() => setActiveTrainingMode('stats')} className="px-5 py-3 bg-[#111111] text-[#F2EDE4] border-[3px] border-black uppercase font-black flex items-center gap-2 active:translate-y-1">СТОП <X className="w-6 h-6" /></button>}
                  {activeTrainingMode === 'stats' && <button onClick={closeTraining} className="p-3 bg-[#111111] text-[#F2EDE4] border-[3px] border-black active:translate-y-1"><X className="w-8 h-8" /></button>}
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
function SidebarItem({ active, icon, label, onClick }: any) { return <button data-sound="menu" onClick={onClick} className={`flex items-center w-full px-6 py-5 gap-4 transition-transform border-[3px] border-transparent font-black uppercase text-xl ${active ? 'bg-[#A235D8] text-[#111111] zine-card' : 'text-[#F2EDE4] hover:bg-[#111111] hover:border-black'} `}><div className={`${active ? 'scale-125' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-8 h-8" })}</div><span>{label}</span></button>; }
function NavItem({ active, icon, label, onClick }: any) { return <button data-sound="menu" onClick={onClick} className={`flex flex-col items-center flex-1 py-3 gap-1 transition-colors ${active ? 'text-[#88D64F] font-black' : 'text-[#F2EDE4] font-bold'}`}><div className={`${active ? 'scale-125' : 'scale-100'} transition-transform`}>{icon}</div><span className="text-[12px] font-marker tracking-widest">{label}</span></button>; }
function MasteryBar({ masteryLevel }: { masteryLevel: number }) { return <div className="mt-4 w-full bg-[#F2EDE4] border-[3px] border-black h-4 overflow-hidden relative rotate-1"><div className={`h-full border-r-[3px] border-black ${masteryLevel > 70 ? 'bg-[#88D64F]' : masteryLevel > 30 ? 'bg-[#A235D8]' : 'bg-[#D99C3B]'}`} style={{ width: `${masteryLevel}%` }} /></div>; }
function TrainCard({ title, desc, icon, bg, className="", onClick, rotate }: any) { return <div onClick={onClick} className={`zine-card ${bg} p-6 flex flex-col gap-5 cursor-pointer text-[#111111] ${rotate} ${className}`}><div className={`w-16 h-16 border-[3px] border-black bg-white flex items-center justify-center`}><div className="scale-125">{icon}</div></div><div><div className="font-black uppercase text-2xl mb-1">{title}</div><div className="text-sm font-bold bg-[#111111] text-[#F2EDE4] inline-block px-2 border-2 border-black uppercase">{desc}</div></div></div>; }

function BulkActions({ selectedWordIds, onTrain, onDelete, onReset, onAddToGroup }: any) {
  if (selectedWordIds.size === 0) return null;
  return (
    <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 zine-card bg-[#F2EDE4] p-2 flex items-center justify-around z-30 w-[90%] max-w-md rotate-1">
      <button onClick={() => onDelete(Array.from(selectedWordIds))} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-[#D99C3B] border-2 border-black mr-2"><Trash2 className="w-6 h-6 mb-2" /> <span className="text-[12px] uppercase">Удалить</span></button>
      <button onClick={() => onReset(Array.from(selectedWordIds))} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-white border-2 border-black mr-2"><RotateCcw className="w-6 h-6 mb-2" /> <span className="text-[12px] uppercase">Сброс</span></button>
      <button onClick={onAddToGroup} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-white border-2 border-black mr-2"><FolderPlus className="w-6 h-6 mb-2" /> <span className="text-[12px] uppercase">В группу</span></button>
      <button onClick={onTrain} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-[#88D64F] border-2 border-black"><PlayCircle className="w-6 h-6 mb-2" /> <span className="text-[12px] uppercase">Учить</span></button>
    </motion.div>
  );
}

function DeleteAccountModal({ onClose, onDelete }: any) {
   const [pwd, setPwd] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card bg-[#F2EDE4] w-full max-w-sm p-8 relative z-10 text-center">
           <AlertTriangle className="w-16 h-16 text-[#D99C3B] mx-auto mb-6" />
           <h2 className="text-3xl font-marker mb-4 text-[#111111]">Уничтожение</h2>
           <p className="text-[#111111] font-bold text-sm mb-6">Всё сгорит. Абсолютно всё. Назад пути нет.</p>
           <input autoFocus type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="ПАРОЛЬ" className="w-full bg-white px-4 py-4 zine-input text-center text-xl uppercase font-black" />
           <div className="mt-8 flex gap-4"><button onClick={onClose} className="flex-1 py-4 bg-white text-[#111111] zine-btn">ОТМЕНА</button><button onClick={() => pwd && onDelete(pwd)} className="flex-1 py-4 bg-[#D99C3B] text-[#111111] zine-btn disabled:opacity-50" disabled={!pwd}>СЖЕЧЬ</button></div>
        </motion.div>
      </div>
   );
}

function SmartSelectionModal({ words, onClose, onSelect }: any) {
   const safeWords = words || [];
   const [inputVal, setInputVal] = useState(String(Math.min(10, safeWords.length)));

   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card bg-[#F2EDE4] w-full max-w-sm p-8 relative z-10 rotate-1">
           <h2 className="text-3xl font-marker mb-2 text-[#111111]">Умный подбор</h2><p className="text-[#111111] font-bold text-sm mb-8 bg-[#88D64F] inline-block px-2 border-2 border-black">Слабые слова.</p>
           <div className="bg-white p-4 border-[3px] border-black mb-8 rotate-1">
              <div className="flex justify-between text-sm font-black text-[#111111] mb-2 uppercase"><span>Кол-во</span><span>Всего: {safeWords.length}</span></div>
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
                 className="w-full text-5xl font-black bg-transparent outline-none text-[#111111] border-b-4 border-black" 
              />
           </div>
           <div className="flex gap-4">
              <button onClick={onClose} className="flex-1 py-5 bg-white text-[#111111] zine-btn">ОТМЕНА</button>
              <button onClick={() => { 
                 const count = parseInt(inputVal) || 1;
                 const sorted = [...safeWords].sort((a, b) => getEffectiveMastery(a) - getEffectiveMastery(b)); 
                 onSelect(sorted.slice(0, count).map((w: any) => w.id)); 
              }} className="flex-1 py-5 bg-[#A235D8] text-[#111111] zine-btn flex justify-center items-center gap-2">ВЫБРАТЬ</button>
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
     if (file.size > 5 * 1024 * 1024) return alert('Много весит. Давай до 5 МБ.');
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
         } catch(err) { alert('Ошибка чтения PDF.'); }
         setLoading(false);
     } else { const text = await file.text(); setExtractedText(text); }
  };

  const handleGenerate = async () => {
     const c = Math.min(15, parseInt(count) || 10);
     if (!(topic || '').trim() && !(extractedText || '').trim()) return alert('Где тема или текст?');
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
     } else { updateWordTab(tabIdToUse, { status: 'analyzing' }); }
     const result = await ApiClient.aiGenerateWord(safeWWord, userProfile?.level);
     setTabs(prev => prev.map(t => t.id === tabIdToUse ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || w.translation || '').toLowerCase() } : t));
     setLoadingWord(null);
  };

  const updateWordTab = (id: string, data: any) => setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
  const handleSaveTab = () => {
     if (activeTab.type !== 'word') return;
     onSaveWord({ original: (activeTab.wordData?.original || activeTab.original || '').toLowerCase(), ...activeTab.wordData, translation: (activeTab.selectedTranslation || '').toLowerCase(), groupIds: Array.from(activeTab.groupIds || []) });
     handleCloseTab(activeTabId);
  };
  const handleCloseTab = (id: string, e?: React.MouseEvent) => {
     if(e) e.stopPropagation();
     const newTabs = tabs.filter(t => t.id !== id);
     setTabs(newTabs); 
     if(activeTabId === id) { const next = newTabs.find(t => t.type === 'word'); setActiveTabId(next ? next.id : 'generator'); }
  };
  const handleReset = () => { updateWordTab('generator', {generatedWords: []}); setTopic(''); setExtractedText(''); setFileName(''); setCount('10'); setSelectedGenWords(new Set()); };
  const toggleSelect = (word: string) => { const n = new Set(selectedGenWords); n.has(word)?n.delete(word):n.add(word); setSelectedGenWords(n); };
  const selectAll = () => { if (selectedGenWords.size === (activeTab.generatedWords || []).length) setSelectedGenWords(new Set()); else setSelectedGenWords(new Set((activeTab.generatedWords || []).map((w:any) => w.word))); };
  const handleAddSelectedToTabs = async () => {
      const wordsToAdd = (activeTab.generatedWords || []).filter((w:any) => selectedGenWords.has(w.word));
      if(wordsToAdd.length === 0) return;
      setLoadingBatch(true);
      const newTabs = wordsToAdd.map((w:any, i:number) => ({ id: Date.now().toString() + i, type: 'word', original: (w.word || '').toLowerCase(), status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }));
      setTabs(prev => [...prev, ...newTabs]); setActiveTabId(newTabs[0].id); setSelectedGenWords(new Set());
      await Promise.all(newTabs.map(async (tab: any, i: number) => {
          const w = wordsToAdd[i]; const result = await ApiClient.aiGenerateWord((w.word || '').toLowerCase(), userProfile?.level);
          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || w.translation || '').toLowerCase() } : t));
      }));
      setLoadingBatch(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-[#F2EDE4] border-t-[6px] border-l-[6px] border-r-[6px] border-black w-full max-w-xl rounded-t-[3rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
        <div className="flex overflow-x-auto gap-3 pb-4 mb-4 hide-scrollbar border-b-[4px] border-black border-dashed">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-5 py-3 border-[3px] border-black text-sm font-black uppercase shrink-0 cursor-pointer transition-transform active:translate-y-1 ${activeTabId === t.id ? 'bg-[#A235D8] text-[#111111] rotate-1' : 'bg-white text-[#111111] -rotate-1'}`}>
                  {t.id === 'generator' ? <Sparkles className="w-5 h-5"/> : (t.wordData?.original || t.original || 'Новое слово').toLowerCase()}
                  {t.id !== 'generator' && <button onClick={(e) => handleCloseTab(t.id, e)} className="p-1 bg-black text-white ml-2"><X className="w-4 h-4"/></button>}
               </div>
           ))}
        </div>
        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar relative">
          {activeTab.type === 'list' && (
             <div className="space-y-6">
                {(activeTab.generatedWords || []).length === 0 ? (
                   <>
                      <div className="space-y-3">
                          <label className="text-xl font-marker text-[#111111] uppercase">Сложность</label>
                          <div className="flex overflow-x-auto gap-3 pb-2 hide-scrollbar">
                             {LEVELS.map(l => <button key={l} onClick={() => setGenLevel(l)} className={`px-4 py-3 font-black uppercase shrink-0 border-[3px] border-black transition-transform active:translate-y-1 ${genLevel === l ? 'bg-[#88D64F] text-[#111111] rotate-1' : 'bg-white text-[#111111] -rotate-1'}`}>{l}</button>)}
                          </div>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                         <div className="col-span-2 space-y-2">
                             <label className="text-xl font-marker text-[#111111] uppercase">Тема</label>
                             <textarea value={topic} onChange={e => { setTopic(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }} placeholder="Напр. Грязь и панк" className="w-full zine-input px-4 py-4 font-bold text-lg resize-none" rows={1} style={{ minHeight: '60px' }} />
                         </div>
                         <div className="col-span-1 space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">Слов</label><input type="number" min="1" max="30" value={count} onChange={e => setCount(e.target.value)} className="w-full zine-input px-4 py-4 font-bold text-lg text-center" /></div>
                      </div>
                      <div className="space-y-2 mt-4">
                         <label className="text-xl font-marker text-[#111111] uppercase block">Из файла (PDF/TXT)</label>
                         <label className="w-full flex items-center justify-center gap-3 bg-[#111111] text-[#F2EDE4] border-[4px] border-[#111111] py-5 cursor-pointer active:translate-y-1 transition-transform font-black text-lg rotate-1">
                            <UploadCloud className="w-6 h-6"/> {fileName || 'ВЫБРАТЬ ФАЙЛ'}
                            <input type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileUpload} />
                         </label>
                      </div>
                      <button onClick={handleGenerate} disabled={loading} className="w-full py-6 mt-6 bg-[#A235D8] text-[#111111] zine-btn disabled:opacity-50 flex justify-center items-center gap-3 text-xl">
                         {loading ? <><Loader2 className="w-6 h-6 animate-spin"/> МАГИЯ ИИ...</> : <><Wand2 className="w-6 h-6"/> СГЕНЕРИРОВАТЬ</>}
                      </button>
                   </>
                ) : (
                   <div className="pb-24">
                      <div className="flex justify-between items-center mb-6">
                         <button onClick={selectAll} className="text-lg font-black text-[#111111] bg-[#88D64F] px-3 border-2 border-black uppercase flex items-center gap-2 rotate-1"><CheckCircle2 className="w-5 h-5"/> {selectedGenWords.size === (activeTab.generatedWords || []).length ? 'Снять всё' : 'Выбрать всё'}</button>
                         <button onClick={handleReset} className="text-lg font-black text-[#111111] bg-white px-3 border-2 border-black uppercase -rotate-1">СБРОС</button>
                      </div>
                      <div className="space-y-4">
                         {(activeTab.generatedWords || []).map((w:any, i:number) => {
                            const cleanWWord = (w.word || '').toLowerCase();
                            const alreadyInTabs = tabs.some(t => t.id !== 'generator' && (t.wordData?.original || t.original || '').toLowerCase() === cleanWWord);
                            const existingInDict = (words||[]).find((x:any) => (x.original || '').toLowerCase() === cleanWWord);
                            return (
                               <div key={i} className={`flex items-center justify-between bg-white p-5 border-[3px] border-black gap-4 ${i%2===0?'rotate-1':'-rotate-1'}`}>
                                  <button onClick={() => toggleSelect(w.word)} className={`w-8 h-8 border-[3px] border-black flex shrink-0 items-center justify-center transition-colors ${selectedGenWords.has(w.word) ? 'bg-[#A235D8]' : 'bg-white'}`}>{selectedGenWords.has(w.word) && <Check className="w-6 h-6 text-[#111111] font-black" />}</button>
                                  <div className="flex-1 cursor-pointer clickable-card" onClick={() => toggleSelect(w.word)}>
                                     <span className="font-black text-[#111111] text-2xl uppercase">{cleanWWord}</span>
                                     <div className="text-lg font-bold text-[#111111] bg-[#F2EDE4] inline-block px-2 border-2 border-black mt-1">{(w.translation || '').toLowerCase()}</div>
                                  </div>
                                  {existingInDict ? (
                                     <button onClick={() => onWordClick(existingInDict.id)} className="px-4 py-2 bg-[#111111] text-[#F2EDE4] font-black uppercase text-sm border-[2px] border-black">В словаре</button>
                                  ) : (
                                     <button onClick={()=>handleAnalyzeWord(w)} disabled={alreadyInTabs || loadingWord === w.word} className="w-12 h-12 flex shrink-0 items-center justify-center bg-[#88D64F] border-[3px] border-black text-[#111111] active:translate-y-1 disabled:opacity-50">
                                        {loadingWord === w.word ? <Loader2 className="w-6 h-6 animate-spin"/> : alreadyInTabs ? <Check className="w-6 h-6"/> : <Plus className="w-6 h-6 font-black"/>}
                                     </button>
                                  )}
                               </div>
                            )
                         })}
                      </div>
                      <AnimatePresence>
                         {selectedGenWords.size > 0 && (
                            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-[#111111] p-3 border-[4px] border-white flex items-center z-50 rotate-1">
                               <button onClick={handleAddSelectedToTabs} disabled={loadingBatch} className="w-full py-5 bg-[#A235D8] text-[#111111] zine-btn flex justify-center items-center gap-3 text-xl">
                                  {loadingBatch ? <Loader2 className="w-6 h-6 animate-spin"/> : `ОТКРЫТЬ ВКЛАДКИ (${selectedGenWords.size})`}
                               </button>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </div>
                )}
             </div>
          )}

          {activeTab.type === 'word' && (
             <>
                {activeTab.status === 'analyzing' && <div className="py-20 flex flex-col items-center justify-center text-[#111111]"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F] mb-4" /> <span className="font-black text-xl uppercase">Думаю...</span></div>}
                {activeTab.status === 'done' && (
                   activeTab.wordData?.translationOptions?.[0]?.includes('Ошибка ИИ') ? (
                      <div className="bg-[#D99C3B] p-8 border-[4px] border-black text-center rotate-1">
                         <AlertTriangle className="w-16 h-16 text-[#111111] mx-auto mb-4" />
                         <h3 className="text-3xl font-marker text-[#111111] mb-2">ФЕЙЛ ИИ</h3>
                         <p className="text-[#111111] font-bold text-lg mb-8 bg-white border-[2px] border-black p-2 -rotate-1">Мозг сломался. Давай еще раз.</p>
                         <button onClick={() => handleAnalyzeWord({word: activeTab.original})} className="w-full py-5 bg-[#111111] text-[#F2EDE4] border-[3px] border-black font-black uppercase flex justify-center items-center gap-3"><RefreshCw className="w-6 h-6"/> Повторить</button>
                      </div>
                   ) : (
                     <div className="space-y-6">
                        <div className="bg-white p-8 border-[4px] border-black rotate-1">
                           <div className="flex items-center justify-center gap-3 mb-8">
                              <h3 className="text-4xl font-black text-[#111111] uppercase">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                              {activeTab.wordData?.partOfSpeech && <span className="bg-[#111111] text-[#F2EDE4] font-black px-3 py-1 border-[2px] border-black text-sm uppercase -rotate-2">{activeTab.wordData.partOfSpeech}</span>}
                           </div>
                           <div className="space-y-6">
                               <div>
                                  <div className="text-lg font-marker text-[#111111] uppercase text-center mb-4">ВЫБЕРИ ПЕРЕВОД</div>
                                  <div className="flex flex-wrap justify-center gap-3 mb-4">
                                     {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                                        <button key={i} onClick={()=>updateWordTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-5 py-3 font-black text-lg border-[3px] border-black uppercase transition-transform active:translate-y-1 ${i%2===0?'-rotate-1':'rotate-1'} ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-[#88D64F] text-[#111111]' : 'bg-[#F2EDE4] text-[#111111]'}`}>{(opt || '').toLowerCase()}</button>
                                     ))}
                                  </div>
                               </div>
                               <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-2">Cambridge Dictionary</div><div className="text-[#111111] font-bold text-center text-lg bg-[#E0D8C3] p-4 border-[2px] border-black -rotate-1">{activeTab.wordData?.cambridgeTranslation}</div></div>
                               <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-4">Транскрипция</div><div className="flex justify-center gap-6 font-black text-[#111111] text-xl"><span className="bg-white px-4 py-2 border-[3px] border-black rotate-2">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-[#111111] text-white px-4 py-2 border-[3px] border-black -rotate-2">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                           </div>
                           {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className={`mt-8 p-6 bg-[#A235D8] border-[4px] border-black text-center text-[#111111] ${i%2===0?'rotate-2':'-rotate-1'}`}><div className="text-xl font-marker bg-white inline-block px-3 py-1 border-[2px] border-black mb-4">Пример</div><div className="font-black mb-3 text-2xl uppercase">"{ex.text}"</div><div className="text-lg font-bold bg-[#F2EDE4] inline-block px-3 py-1 border-[2px] border-black">{(ex.translation || '').toLowerCase()}</div></div>)}
                        </div>
                        {(groups || []).length > 0 && <div className="px-2 pt-4"><h3 className="text-xl font-marker text-[#111111] mb-4">В какую группу?</h3><div className="flex flex-wrap gap-3">{(groups || []).map((g: Group, i) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateWordTab(activeTabId, { groupIds: s }); }} className={`px-5 py-3 font-black text-lg border-[3px] border-black uppercase transition-transform flex items-center gap-2 ${i%2===0?'rotate-1':'-rotate-2'} ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-[#88D64F] text-[#111111]' : 'bg-white text-[#111111]'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-6 h-6"/>} {g.name}</button>)}</div></div>}
                        <button onClick={handleSaveTab} className="w-full py-6 mt-6 bg-[#111111] text-[#F2EDE4] zine-btn text-xl">В СЛОВАРЬ И ЗАКРЫТЬ</button>
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
  const updateTab = (id: string, data: any) => setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
  const handleAnalyze = async () => {
    if (!(activeTab.original || '').trim()) return;
    updateTab(activeTabId, { status: 'analyzing' });
    const result = await ApiClient.aiGenerateWord((activeTab.original || '').toLowerCase(), userProfile?.level);
    updateTab(activeTabId, { status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || '').toLowerCase() });
  };
  const handleAddRelated = async (rw: any) => {
     const newId = Date.now().toString(); const cleanRW = (rw.word || '').toLowerCase();
     setTabs(prev => [...prev, { id: newId, original: cleanRW, status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }]); setActiveTabId(newId);
     const result = await ApiClient.aiGenerateWord(cleanRW, userProfile?.level);
     setTabs(prev => prev.map(t => t.id === newId ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || rw.translation || '').toLowerCase() } : t));
  };
  const handleSaveTab = () => {
     onSaveWord({ original: (activeTab.wordData?.original || activeTab.original || '').toLowerCase(), ...activeTab.wordData, translation: (activeTab.selectedTranslation || '').toLowerCase(), groupIds: Array.from(activeTab.groupIds || []) });
     const newTabs = tabs.filter(t => t.id !== activeTabId);
     if (newTabs.length === 0) onClose(); else { setTabs(newTabs); setActiveTabId(newTabs[newTabs.length - 1].id); }
  };
  const handleCloseTab = (e: React.MouseEvent, id: string) => { e.stopPropagation(); const newTabs = tabs.filter(t => t.id !== id); if (newTabs.length === 0) onClose(); else { setTabs(newTabs); if(activeTabId === id) setActiveTabId(newTabs[newTabs.length - 1].id); } };
  const relatedList = activeTab.wordData?.relatedWords || [];

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-[#F2EDE4] border-t-[6px] border-l-[6px] border-r-[6px] border-black w-full max-w-xl rounded-t-[3rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
        <div className="flex overflow-x-auto gap-3 pb-4 mb-4 hide-scrollbar border-b-[4px] border-black border-dashed">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-5 py-3 border-[3px] border-black text-sm font-black uppercase shrink-0 cursor-pointer transition-transform active:translate-y-1 ${activeTabId === t.id ? 'bg-[#88D64F] text-[#111111] rotate-1' : 'bg-white text-[#111111] -rotate-1'}`}>
                  {(t.wordData?.original || t.original || 'НОВОЕ СЛОВО').toLowerCase()}
                  {tabs.length > 1 && <button onClick={(e) => handleCloseTab(e, t.id)} className="p-1 bg-black text-white ml-2"><X className="w-4 h-4"/></button>}
               </div>
           ))}
           <button onClick={() => { const newId = Date.now().toString(); setTabs([...tabs, { id: newId, original: '', status: 'idle', wordData: {}, selectedTranslation: '', groupIds: new Set() }]); setActiveTabId(newId); }} className="px-4 py-3 bg-[#111111] text-white border-[3px] border-black active:translate-y-1"><Plus className="w-5 h-5"/></button>
        </div>
        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
          {activeTab.status === 'idle' && (
             <>
                <input autoFocus placeholder="Введи слово..." value={(activeTab.original || '').toLowerCase()} onChange={e => updateTab(activeTabId, { original: (e.target.value || '').toLowerCase() })} className="w-full zine-input px-6 py-6 text-2xl font-black uppercase text-center" />
                <button onClick={handleAnalyze} disabled={!(activeTab.original || '').trim()} className="w-full py-6 bg-[#A235D8] text-[#111111] zine-btn text-xl disabled:opacity-50 mt-6">ИСКАТЬ</button>
             </>
          )}
          {activeTab.status === 'analyzing' && <div className="py-20 flex flex-col items-center justify-center text-[#111111]"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F] mb-4" /> <span className="font-black text-xl uppercase">Думаю...</span></div>}
          {activeTab.status === 'done' && (
             activeTab.wordData?.translationOptions?.[0]?.includes('Ошибка ИИ') ? (
                <div className="bg-[#D99C3B] p-8 border-[4px] border-black text-center mt-4 rotate-1">
                   <AlertTriangle className="w-16 h-16 text-[#111111] mx-auto mb-4" />
                   <h3 className="text-3xl font-marker text-[#111111] mb-2">ФЕЙЛ ИИ</h3>
                   <p className="text-[#111111] font-bold text-lg mb-8 bg-white border-[2px] border-black p-2 -rotate-1">Мозг сломался. Давай еще раз.</p>
                   <button onClick={handleAnalyze} className="w-full py-5 bg-[#111111] text-[#F2EDE4] border-[3px] border-black font-black uppercase flex justify-center items-center gap-3"><RefreshCw className="w-6 h-6"/> Повторить</button>
                </div>
             ) : (
                <div className="space-y-6">
                   <div className="bg-white p-8 border-[4px] border-black rotate-1">
                      <div className="flex items-center justify-center gap-3 mb-8">
                         <h3 className="text-4xl font-black text-[#111111] uppercase">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                         {activeTab.wordData?.partOfSpeech && <span className="bg-[#111111] text-[#F2EDE4] font-black px-3 py-1 border-[2px] border-black text-sm uppercase -rotate-2">{activeTab.wordData.partOfSpeech}</span>}
                      </div>
                      <div className="space-y-6">
                          <div>
                             <div className="text-lg font-marker text-[#111111] uppercase text-center mb-4">ВЫБЕРИ ПЕРЕВОД</div>
                             <div className="flex flex-wrap justify-center gap-3 mb-4">
                                {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                                   <button key={i} onClick={()=>updateTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-5 py-3 font-black text-lg border-[3px] border-black uppercase transition-transform active:translate-y-1 ${i%2===0?'-rotate-1':'rotate-1'} ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-[#88D64F] text-[#111111]' : 'bg-[#F2EDE4] text-[#111111]'}`}>{(opt || '').toLowerCase()}</button>
                                ))}
                             </div>
                          </div>
                          <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-2">Cambridge Dictionary</div><div className="text-[#111111] font-bold text-center text-lg bg-[#E0D8C3] p-4 border-[2px] border-black -rotate-1">{activeTab.wordData?.cambridgeTranslation}</div></div>
                          <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-4">Транскрипция</div><div className="flex justify-center gap-6 font-black text-[#111111] text-xl"><span className="bg-white px-4 py-2 border-[3px] border-black rotate-2">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-[#111111] text-white px-4 py-2 border-[3px] border-black -rotate-2">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                      </div>
                      {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className={`mt-8 p-6 bg-[#A235D8] border-[4px] border-black text-center text-[#111111] ${i%2===0?'rotate-2':'-rotate-1'}`}><div className="text-xl font-marker bg-white inline-block px-3 py-1 border-[2px] border-black mb-4">Пример</div><div className="font-black mb-3 text-2xl uppercase">"{ex.text}"</div><div className="text-lg font-bold bg-[#F2EDE4] inline-block px-3 py-1 border-[2px] border-black">{(ex.translation || '').toLowerCase()}</div></div>)}
                      {relatedList.length > 0 && (
                         <div className="mt-8 pt-6 border-t-[4px] border-black border-dashed text-center">
                            <div className="text-xl font-marker text-[#111111] mb-6">ОДНОКОРЕННЫЕ СЛОВА</div>
                            <div className="space-y-4">
                               {relatedList.map((rw:any, i:number) => {
                                  const cleanRW = (rw.word || '').toLowerCase(); const alreadyInTabs = tabs.some(t => (t.wordData?.original || t.original || '').toLowerCase() === cleanRW);
                                  return (
                                     <div key={i} className={`flex items-center justify-between bg-white p-4 border-[3px] border-black ${i%2===0?'rotate-1':'-rotate-1'}`}>
                                        <div className="text-left"><span className="font-black text-xl text-[#111111] uppercase">{cleanRW}</span> <span className="text-[12px] text-[#F2EDE4] bg-[#111111] px-2 py-1 border-2 border-black ml-2 uppercase font-bold">{rw.partOfSpeech}</span><div className="text-lg text-[#111111] font-bold mt-2 bg-[#E0D8C3] inline-block px-2 border-2 border-black">{(rw.translation || '').toLowerCase()}</div></div>
                                        <button onClick={()=>handleAddRelated(rw)} disabled={alreadyInTabs} className="w-12 h-12 flex shrink-0 items-center justify-center bg-[#88D64F] border-[3px] border-black text-[#111111] active:translate-y-1 disabled:opacity-50">{alreadyInTabs ? <Check className="w-6 h-6"/> : <Plus className="w-6 h-6 font-black"/>}</button>
                                     </div>
                                  );
                               })}
                            </div>
                         </div>
                      )}
                   </div>
                   {(groups || []).length > 0 && <div className="px-2 pt-4"><h3 className="text-xl font-marker text-[#111111] mb-4">В какую группу?</h3><div className="flex flex-wrap gap-3">{(groups || []).map((g: Group, i) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateTab(activeTabId, { groupIds: s }); }} className={`px-5 py-3 font-black text-lg border-[3px] border-black uppercase transition-transform flex items-center gap-2 ${i%2===0?'rotate-1':'-rotate-2'} ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-[#88D64F] text-[#111111]' : 'bg-white text-[#111111]'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-6 h-6"/>} {g.name}</button>)}</div></div>}
                   <button onClick={handleSaveTab} className="w-full py-6 mt-6 bg-[#111111] text-[#F2EDE4] zine-btn text-xl">В СЛОВАРЬ И ЗАКРЫТЬ</button>
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
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-[#F2EDE4] border-t-[6px] border-l-[6px] border-r-[6px] border-black w-full max-w-xl rounded-t-[3rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
           <div className="flex justify-between items-center mb-8 shrink-0 border-b-[4px] border-black pb-4">
              <h2 className="text-2xl font-marker text-[#111111] uppercase flex items-center gap-3"><BookOpen className="w-8 h-8 text-[#A235D8]"/> КАРТОЧКА</h2>
              <div className="flex items-center gap-3">
                 <button onClick={onEdit} className="p-3 bg-white border-[3px] border-black text-[#111111] active:translate-y-1"><Edit3 className="w-6 h-6" /></button>
                 <button onClick={onClose} className="p-3 bg-white border-[3px] border-black text-[#111111] active:translate-y-1"><X className="w-6 h-6" /></button>
              </div>
           </div>
           <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
              <div className="bg-white p-8 border-[4px] border-black rotate-1">
                 <div className="flex items-center justify-center gap-3 mb-6">
                    <h3 className="text-5xl font-black text-[#111111] uppercase">{(word.original || '').toLowerCase()}</h3>
                    {word.partOfSpeech && <span className="bg-[#111111] text-[#F2EDE4] font-black px-3 py-1 border-[2px] border-black text-sm uppercase -rotate-2">{word.partOfSpeech}</span>}
                 </div>
                 <div className="text-center mb-8"><div className="text-3xl font-black text-[#88D64F] bg-[#111111] inline-block px-4 py-2 border-[4px] border-black rotate-1 uppercase">{(word.translation || '').toLowerCase()}</div></div>
                 {word.cambridgeTranslation && <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-2">Cambridge Dictionary</div><div className="text-[#111111] font-bold text-center text-lg bg-[#E0D8C3] p-4 border-[2px] border-black -rotate-1">{word.cambridgeTranslation}</div></div>}
                 {(word.transcriptionUK || word.transcriptionUS) && <div className="pt-6 border-t-[4px] border-black border-dashed"><div className="text-lg font-marker text-[#111111] uppercase text-center mb-4">Транскрипция</div><div className="flex justify-center gap-6 font-black text-[#111111] text-xl">{word.transcriptionUK && <span className="bg-white px-4 py-2 border-[3px] border-black rotate-2">UK: [{word.transcriptionUK}]</span>}{word.transcriptionUS && <span className="bg-[#111111] text-white px-4 py-2 border-[3px] border-black -rotate-2">US: [{word.transcriptionUS}]</span>}</div></div>}
                 {(word.examples || []).map((ex:any, i:number) => <div key={i} className={`mt-8 p-6 bg-[#A235D8] border-[4px] border-black text-center text-[#111111] ${i%2===0?'rotate-2':'-rotate-1'}`}><div className="text-xl font-marker bg-white inline-block px-3 py-1 border-[2px] border-black mb-4">Пример</div><div className="font-black mb-3 text-2xl uppercase">"{ex.text}"</div><div className="text-lg font-bold bg-[#F2EDE4] inline-block px-3 py-1 border-[2px] border-black">{(ex.translation || '').toLowerCase()}</div></div>)}
                 {relatedTabs.length > 0 && <div className="mt-8 pt-6 border-t-[4px] border-black border-dashed text-center"><div className="text-xl font-marker text-[#111111] mb-6">ОДНОКОРЕННЫЕ</div><div className="flex flex-wrap justify-center gap-3">{relatedTabs.map((rw: any, i: number) => { const cleanRW = (rw.word || '').toLowerCase(); const existing = (words||[]).find((w:any) => (w.original || '').toLowerCase() === cleanRW); if (existing) return <button key={i} onClick={() => onWordClick(existing.id)} className="px-5 py-3 bg-[#88D64F] border-[3px] border-black text-[#111111] font-black uppercase active:translate-y-1">{cleanRW}</button>; return <span key={i} className="px-5 py-3 bg-white border-[3px] border-black text-[#111111] font-black uppercase opacity-50">{cleanRW}</span>; })}</div></div>}
                 {(word.groupIds || []).length > 0 && <div className="mt-8 pt-6 border-t-[4px] border-black border-dashed text-center"><div className="text-xl font-marker text-[#111111] mb-6">В ГРУППАХ</div><div className="flex flex-wrap justify-center gap-3">{(word.groupIds || []).map((gid: string) => { const g = (groups || []).find((x:Group) => x.id === gid); return g ? <span key={gid} className="px-5 py-3 bg-[#D99C3B] border-[3px] border-black text-[#111111] font-black uppercase rotate-1">{g.name}</span> : null; })}</div></div>}
              </div>
              <button onClick={onEdit} className="w-full py-6 bg-[#A235D8] text-[#111111] zine-btn text-xl flex justify-center items-center gap-3"><Edit3 className="w-6 h-6"/> ИЗМЕНИТЬ КАРТОЧКУ</button>
           </div>
        </motion.div>
     </div>
  );
}

function WordEditorModal({ word, words, groups, userProfile, onClose, onSave, onDelete, onReset, onWordClick }: any) {
  if (!word) return null;
  const [original, setOriginal] = useState(word.original || ''); const [translation, setTranslation] = useState(word.translation || ''); const [cambridgeTranslation, setCambridgeTranslation] = useState(word.cambridgeTranslation || ''); const [transcriptionUK, setTranscriptionUK] = useState(word.transcriptionUK || ''); const [transcriptionUS, setTranscriptionUS] = useState(word.transcriptionUS || ''); const [exampleText, setExampleText] = useState(word.examples?.[0]?.text || ''); const [exampleTranslation, setExampleTranslation] = useState(word.examples?.[0]?.translation || ''); const [groupIds, setGroupIds] = useState<Set<string>>(new Set(word.groupIds || [])); const [isRegenerating, setIsRegenerating] = useState(false); const [loadingRelated, setLoadingRelated] = useState<string | null>(null);

  useEffect(() => { if(word) { setOriginal(word.original || ''); setTranslation(word.translation || ''); setCambridgeTranslation(word.cambridgeTranslation || ''); setTranscriptionUK(word.transcriptionUK || ''); setTranscriptionUS(word.transcriptionUS || ''); setExampleText(word.examples?.[0]?.text || ''); setExampleTranslation(word.examples?.[0]?.translation || ''); setGroupIds(new Set(word.groupIds || [])); } }, [word]);
  const handleRegenerateExample = async () => { setIsRegenerating(true); const newEx = await ApiClient.aiRegenerateExample(original, userProfile?.level); if (newEx.text) { setExampleText(newEx.text); setExampleTranslation(newEx.translation); } setIsRegenerating(false); };
  const handleSave = () => { onSave({ ...word, original: (original || '').toLowerCase().trim(), translation: (translation || '').toLowerCase().trim(), cambridgeTranslation, transcriptionUK, transcriptionUS, groupIds: Array.from(groupIds || []), examples: exampleText ? [{ text: exampleText, translation: exampleTranslation }] : [] }); onClose(); };
  const handleAddRelated = async (rw: any) => { const cleanRW = (rw.word || '').toLowerCase(); setLoadingRelated(cleanRW); const result = await ApiClient.aiGenerateWord(cleanRW, userProfile?.level); const id = doc(collection(db, 'users', auth.currentUser!.uid, 'words')).id; await setDoc(doc(db, 'users', auth.currentUser!.uid, 'words', id), { ...result, id, original: cleanRW, translation: (result.translationOptions?.[0] || result.translation || rw.translation || '').toLowerCase(), createdAt: Date.now(), masteryLevel: 0, lastPracticed: Date.now() }); setLoadingRelated(null); onWordClick(id); };
  const relatedTabs = word.relatedWords || [];

  return (
     <div className="fixed inset-0 z-[100] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-[#F2EDE4] border-t-[6px] border-l-[6px] border-r-[6px] border-black w-full max-w-xl rounded-t-[3rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
           {relatedTabs.length > 0 && (
              <div className="flex overflow-x-auto gap-3 pb-4 mb-4 hide-scrollbar border-b-[4px] border-black border-dashed">
                  <button className="px-5 py-3 bg-[#A235D8] text-[#111111] font-black uppercase text-sm border-[3px] border-black shrink-0">{(word.original || '').toLowerCase()}</button>
                  {relatedTabs.map((rw: any, i: number) => { const cleanRW = (rw.word || '').toLowerCase(); const existing = (words||[]).find((w:any) => (w.original || '').toLowerCase() === cleanRW); if (existing) return <button key={i} onClick={() => onWordClick(existing.id)} className="px-5 py-3 bg-white border-[3px] border-black text-[#111111] font-black uppercase text-sm shrink-0 active:translate-y-1">{cleanRW}</button>; else return <button key={i} onClick={() => handleAddRelated(rw)} disabled={loadingRelated === cleanRW} className="px-5 py-3 bg-white border-[3px] border-black border-dashed text-[#111111] font-black uppercase text-sm shrink-0 flex items-center gap-2 active:translate-y-1 disabled:opacity-50">{loadingRelated === cleanRW ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4 font-black"/>} {cleanRW}</button>; })}
              </div>
           )}
           <div className="flex justify-between items-center mb-8 shrink-0 border-b-[4px] border-black pb-4">
              <h2 className="text-2xl font-marker text-[#111111] uppercase flex items-center gap-3"><Edit3 className="w-8 h-8 text-[#A235D8]"/> РЕДАКТОР</h2>
              <div className="flex items-center gap-3">
                 <button onClick={()=>{ onReset(); onClose(); }} className="p-3 bg-white border-[3px] border-black text-[#111111] active:translate-y-1"><RotateCcw className="w-6 h-6" /></button>
                 <button onClick={onDelete} className="p-3 bg-[#D99C3B] border-[3px] border-black text-[#111111] active:translate-y-1"><Trash2 className="w-6 h-6" /></button>
                 <button onClick={onClose} className="p-3 bg-white border-[3px] border-black text-[#111111] active:translate-y-1"><X className="w-6 h-6" /></button>
              </div>
           </div>
           <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
              <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">Слово</label><input value={(original || '').toLowerCase()} onChange={e => setOriginal((e.target.value || '').toLowerCase())} className="w-full zine-input px-4 py-4 font-black text-2xl uppercase" /></div>
              <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">UK Транскрипция</label><input value={transcriptionUK} onChange={e => setTranscriptionUK(e.target.value)} className="w-full zine-input px-4 py-4 font-bold text-lg text-center" /></div>
                  <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">US Транскрипция</label><input value={transcriptionUS} onChange={e => setTranscriptionUS(e.target.value)} className="w-full zine-input px-4 py-4 font-bold text-lg text-center" /></div>
              </div>
              <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">Перевод</label><input value={(translation || '').toLowerCase()} onChange={e => setTranslation((e.target.value || '').toLowerCase())} className="w-full zine-input px-4 py-4 font-black text-2xl uppercase bg-[#88D64F]" /></div>
              <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">Cambridge Dict.</label><textarea value={cambridgeTranslation} onChange={e => setCambridgeTranslation(e.target.value)} className="w-full zine-input px-4 py-4 font-bold text-lg min-h-[80px]" /></div>
              <div className="space-y-2">
                 <div className="flex justify-between items-center"><label className="text-xl font-marker text-[#111111] uppercase">Пример</label><button onClick={handleRegenerateExample} disabled={isRegenerating} className="text-sm font-black text-[#111111] bg-white border-2 border-black px-2 py-1 flex items-center gap-2 uppercase active:translate-y-1"><RefreshCw className={`w-4 h-4 ${isRegenerating?'animate-spin':''}`}/> Сменить</button></div>
                 <textarea value={exampleText} onChange={e => setExampleText(e.target.value)} className="w-full zine-input bg-[#E0D8C3] px-4 py-4 font-bold text-lg min-h-[80px]" />
              </div>
              <div className="space-y-2"><label className="text-xl font-marker text-[#111111] uppercase">Перевод примера</label><textarea value={exampleTranslation} onChange={e => setExampleTranslation(e.target.value)} className="w-full zine-input bg-white px-4 py-4 font-bold text-lg min-h-[80px]" /></div>
              <div className="pt-6 border-t-[4px] border-black border-dashed mt-6"><label className="text-xl font-marker text-[#111111] uppercase mb-4 block">Группы</label><div className="flex flex-wrap gap-3 mb-6">{(groups||[]).map((g: Group, i) => <button key={g.id} onClick={() => { const s = new Set(groupIds); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setGroupIds(s); }} className={`px-5 py-3 font-black text-lg border-[3px] border-black uppercase transition-transform flex items-center gap-2 ${i%2===0?'rotate-1':'-rotate-2'} ${(groupIds||new Set()).has(g.id) ? 'bg-[#A235D8] text-[#111111]' : 'bg-white text-[#111111]'}`}>{(groupIds||new Set()).has(g.id) && <Check className="w-6 h-6"/>} {g.name}</button>)}</div></div>
           </div>
           <button onClick={handleSave} className="w-full py-6 bg-[#88D64F] text-[#111111] zine-btn text-xl">СОХРАНИТЬ</button>
        </motion.div>
     </div>
  );
}

function AddGroupModal({ onClose, onSave }: any) {
   const [name, setName] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="zine-card bg-[#F2EDE4] w-full max-w-sm p-8 relative z-10 rotate-1">
           <h2 className="text-3xl font-marker mb-6 text-[#111111]">НОВАЯ ГРУППА</h2>
           <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Название" className="w-full zine-input px-4 py-4 text-xl font-black uppercase text-center" />
           <div className="mt-8 flex gap-4"><button onClick={onClose} className="flex-1 py-5 bg-white text-[#111111] zine-btn">ОТМЕНА</button><button onClick={() => name && onSave(name)} className="flex-1 py-5 bg-[#88D64F] text-[#111111] zine-btn disabled:opacity-50" disabled={!name}>СОЗДАТЬ</button></div>
        </motion.div>
      </div>
   );
}

function BulkAddGroupModal({ groups, onClose, onSave, onOpenAddGroup }: any) {
   return (
      <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-[#F2EDE4] border-t-[6px] border-l-[6px] border-r-[6px] border-black w-full max-w-xl rounded-t-[3rem] p-8 pb-12 shadow-2xl relative z-10">
           <div className="flex justify-between items-center mb-6 border-b-[4px] border-black pb-4"><h2 className="text-3xl font-marker text-[#111111]">ДОБАВИТЬ К...</h2><button onClick={onClose} className="p-3 bg-white border-[3px] border-black text-[#111111] active:translate-y-1"><X className="w-6 h-6"/></button></div>
           <button onClick={onOpenAddGroup} className="w-full mb-6 py-5 bg-[#88D64F] text-[#111111] zine-btn flex justify-center items-center gap-3 text-xl"><Plus className="w-6 h-6 font-black"/> НОВАЯ ГРУППА</button>
           <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
              {(groups||[]).map((g: Group, i) => <button key={g.id} onClick={() => onSave(g.id)} className={`w-full text-left p-5 bg-white border-[3px] border-black font-black uppercase text-xl active:translate-y-1 flex items-center justify-between text-[#111111] ${i%2===0?'rotate-1':'-rotate-1'}`}>{g.name} <Plus className="w-8 h-8 text-[#111111] font-black"/></button>)}
           </div>
        </motion.div>
      </div>
   );
}

function GroupView({ group, words, onClose, onDeleteGroup, onRemoveFromGroup, selectedWordIds, setSelectedWordIds, onTrain, onWordClick }: any) {
   const [search, setSearch] = useState('');
   const filteredGroupWords = (words||[]).filter((w: Word) => (w.original || '').toLowerCase().includes(search.toLowerCase()) || (w.translation || '').toLowerCase().includes(search.toLowerCase()));

   return (
      <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="absolute inset-0 z-20 bg-[#1E1B24] flex flex-col pb-24 top-0 pt-12 md:pt-8 noise-bg">
         <div className="flex items-center px-4 md:px-8 pb-4 border-b-[4px] border-black sticky top-0 z-10 bg-[#1E1B24]">
            <button onClick={onClose} className="p-3 mr-4 bg-[#F2EDE4] border-[3px] border-black active:translate-y-1"><ArrowLeft className="w-8 h-8 text-[#111111]" /></button>
            <div className="flex-1"><h2 className="text-3xl font-marker text-[#88D64F] -rotate-1 uppercase">{group.name}</h2><p className="text-[#F2EDE4] font-bold text-sm bg-black inline-block px-2 border-2 border-white mt-1 rotate-1">{(words||[]).length} слов</p></div>
            <button onClick={onDeleteGroup} className="p-3 bg-[#D99C3B] border-[3px] border-black active:translate-y-1"><Trash2 className="w-8 h-8 text-[#111111]"/></button>
         </div>
         <div className="p-4 md:p-8 space-y-4 overflow-auto flex-1 pb-32 md:pb-8">
            
            {(words||[]).length > 0 && (
               <div className="relative mb-6">
                  <Search className="w-6 h-6 absolute left-4 top-1/2 -translate-y-1/2 text-[#111111]" />
                  <input type="text" placeholder="Искать в группе..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-14 pr-4 py-4 zine-input text-xl font-bold" />
               </div>
            )}

            {(words||[]).length > 0 && (
               <div className="flex justify-between items-center px-1 mb-4">
                  <button onClick={() => { 
                     const groupWordIds = filteredGroupWords.map((w: Word) => w.id); 
                     const allSelected = groupWordIds.length > 0 && groupWordIds.every((id: string) => selectedWordIds.has(id)); 
                     const newSet = new Set(selectedWordIds); 
                     if (allSelected) { groupWordIds.forEach((id: string) => newSet.delete(id)); } 
                     else { groupWordIds.forEach((id: string) => newSet.add(id)); } 
                     setSelectedWordIds(newSet); 
                  }} className="text-lg font-bold text-[#88D64F] flex items-center gap-2 underline decoration-2 uppercase">
                     <CheckCircle2 className="w-6 h-6"/> 
                     {filteredGroupWords.length > 0 && filteredGroupWords.every((w: Word) => selectedWordIds.has(w.id)) ? 'Снять все' : 'Выбрать все'}
                  </button>
               </div>
            )}

            {(words||[]).length === 0 ? <div className="text-center text-[#F2EDE4] text-xl font-bold py-12 rotate-2">Тут пусто, добавь слова.</div> : filteredGroupWords.length === 0 ? <div className="text-center text-[#F2EDE4] text-xl font-bold py-12 -rotate-2">Ничего не найдено.</div> : filteredGroupWords.map((word: Word, index) => (
                  <div key={word.id} className={`zine-card p-5 mb-4 flex items-center gap-4 cursor-pointer clickable-card ${index%2===0?'rotate-1':'-rotate-1'}`} onClick={() => onWordClick(word.id)}>
                     <button onClick={(e) => { e.stopPropagation(); const newSet = new Set(selectedWordIds); newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id); setSelectedWordIds(newSet); }} className={`shrink-0 w-8 h-8 rounded-none border-[3px] border-black flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-[#88D64F]' : 'bg-white'}`}>{selectedWordIds.has(word.id) && <Check className="w-6 h-6 text-[#111111] font-black" />}</button>
                     <div className="flex-1">
                        <div className="flex items-center gap-3"><h3 className="text-2xl font-black uppercase text-[#111111]">{(word.original || '').toLowerCase()}</h3> {word.partOfSpeech && <span className="text-[12px] font-bold text-[#F2EDE4] uppercase bg-[#111111] px-2 py-1 border-2 border-black">{word.partOfSpeech}</span>}</div>
                        <p className="text-[#111111] font-bold text-lg mt-1 line-clamp-1">{(word.translation || '').toLowerCase()}</p><MasteryBar masteryLevel={getEffectiveMastery(word)} />
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); onRemoveFromGroup(word.id); }} className="p-3 bg-white border-[3px] border-black text-[#111111] shrink-0 active:translate-y-1"><X className="w-6 h-6"/></button>
                  </div>
            ))}
         </div>
         <AnimatePresence>
            {selectedWordIds.size > 0 && (words||[]).some((w: Word) => selectedWordIds.has(w.id)) && (
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 left-1/2 -translate-x-1/2 zine-card bg-[#F2EDE4] p-2 flex items-center justify-around z-30 w-[90%] max-w-sm rotate-1">
                  <button onClick={() => { (words||[]).forEach((w: Word) => { if (selectedWordIds.has(w.id)) onRemoveFromGroup(w.id); }); const newSet = new Set(selectedWordIds); (words||[]).forEach((w: Word) => newSet.delete(w.id)); setSelectedWordIds(newSet); }} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-[#D99C3B] border-2 border-black mr-2"><Trash2 className="w-6 h-6 mb-2" /><span className="text-[12px] uppercase">Убрать</span></button>
                  <button onClick={onTrain} className="flex flex-col items-center p-3 text-[#111111] active:translate-y-1 flex-1 font-black bg-[#88D64F] border-2 border-black"><PlayCircle className="w-6 h-6 mb-2" /><span className="text-[12px] uppercase">Учить ({selectedWordIds.size})</span></button>
               </motion.div>
            )}
         </AnimatePresence>
      </motion.div>
   );
}

// --- ТРЕНИРОВКИ ---
function SessionStats({ stats, onClose }: any) {
   useEffect(() => { SoundManager.play('finish'); }, []);
   const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
   return (
      <div className="w-full flex flex-col items-center justify-center p-4 text-[#111111]">
         <div className="zine-card bg-[#F2EDE4] p-10 w-full max-w-sm mb-8 text-center rotate-1">
            <div className="text-8xl font-marker text-[#88D64F] mb-4 drop-shadow-[6px_6px_0_#111111]">{accuracy}%</div>
            <div className="text-[#111111] font-black mb-8 uppercase tracking-widest text-2xl bg-white border-[3px] border-black inline-block px-4 py-2 -rotate-2">Точность</div>
            <div className="flex justify-around text-2xl font-black">
               <div className="flex flex-col">
                  <span className="text-[#88D64F] text-5xl mb-2">{stats.correct}</span>
                  <span className="text-[#111111] text-sm uppercase border-t-[3px] border-black pt-2">Верно</span>
               </div>
               <div className="w-[4px] bg-black mx-4"></div>
               <div className="flex flex-col">
                  <span className="text-[#D99C3B] text-5xl mb-2">{stats.total - stats.correct}</span>
                  <span className="text-[#111111] text-sm uppercase border-t-[3px] border-black pt-2">Ошибок</span>
               </div>
            </div>
         </div>
         <button onClick={onClose} className="w-full max-w-sm py-6 bg-[#A235D8] text-[#111111] zine-btn text-2xl -rotate-1">ГОТОВО</button>
      </div>
   );
}

function useTrainingQueue(initialWords: Word[]) {
   const [queue, setQueue] = useState<Word[]>([]);
   const [idx, setIdx] = useState(0);
   useEffect(() => { setQueue(initialWords || []); setIdx(0); }, [initialWords.length]); 
   const handleNext = useCallback((word: Word, isCorrect: boolean) => {
      setQueue(prev => { const newQueue = [...prev]; if (!isCorrect) newQueue.push(word); return newQueue; });
      setIdx(c => c + 1);
   }, []);
   const isFinished = queue.length > 0 && idx >= queue.length;
   return { word: queue[idx], handleNext, isFinished, queueLength: queue.length, currentNum: idx + 1 };
}

function ModeConstructor({ words, onProgress, onFinish }: any) {
   const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
   const [letters, setLetters] = useState<{id:number, char:string}[]>([]); const [answer, setAnswer] = useState<{id:number, char:string}[]>([]); const [errorsCount, setErrorsCount] = useState(0);
   const inputRef = useRef<HTMLInputElement>(null);

   useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
   useEffect(() => { if(!word) return; const chars = (word.original || '').split('').map((char:string, i:number) => ({ id: i, char: (char || '').toLowerCase() })); setLetters(chars.sort(() => Math.random() - 0.5)); setAnswer([]); setErrorsCount(0); }, [word, currentNum]);

   const processInput = useCallback((char: string, availableLetter?: {id:number, char:string}) => {
      if(!word) return; const correctNextChar = ((word.original || '')[answer.length] || '').toLowerCase();
      if ((char || '').toLowerCase() !== correctNextChar) {
         SoundManager.play('wrong'); onProgress(word.id, false); const newErrors = errorsCount + 1; setErrorsCount(newErrors);
         if (newErrors >= 3) { setAnswer((word.original || '').toLowerCase().split('').map((c:string,i:number)=>({id:i,char:c}))); setLetters([]); setTimeout(() => handleNext(word, false), 2000); }
         return;
      }
      if (availableLetter) {
         setLetters(prev => prev.filter(l => l.id !== availableLetter.id)); const newAns = [...answer, availableLetter]; setAnswer(newAns);
         if (newAns.length === (word.original || '').length) { SoundManager.play('correct'); onProgress(word.id, true); setTimeout(() => handleNext(word, true), 1000); } else { SoundManager.play('click'); }
      }
   }, [answer, word, errorsCount, handleNext, onProgress]);

   const handleKeyDown = useCallback((e: KeyboardEvent) => { if(errorsCount >= 3 || !word || answer.length === (word.original || '').length) return; const char = (e.key || '').toLowerCase(); const availableLetter = letters.find(l => (l.char || '').toLowerCase() === char); if(availableLetter || /^[a-z]$/i.test(char)) processInput(char, availableLetter); }, [letters, answer, word, errorsCount, processInput]);
   const handleHiddenInputChange = (e: React.ChangeEvent<HTMLInputElement>) => { const val = e.target.value; const lastChar = val[val.length - 1]; if (lastChar) { const char = lastChar.toLowerCase(); const availableLetter = letters.find(l => (l.char || '').toLowerCase() === char); if (availableLetter || /^[a-z]$/i.test(char)) processInput(char, availableLetter); } e.target.value = ''; };
   useEffect(() => { window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown); }, [handleKeyDown]);

   if (!word) return <div className="flex justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;

   return (
      <div className="w-full flex flex-col items-center">
         <span className="text-[#F2EDE4] bg-black border-[3px] border-white px-4 py-2 font-black text-xl mb-6 inline-block rotate-1">{currentNum} / {queueLength}</span>
         {errorsCount > 0 && <span className="text-[#111111] bg-[#D99C3B] px-4 py-2 border-[3px] border-black font-black text-xl mb-6 uppercase -rotate-2">ОШИБКИ: {errorsCount}/3</span>}
         <div className="text-3xl font-black text-[#88D64F] mb-12 text-center uppercase drop-shadow-[4px_4px_0_#111111]">{(word.translation || '').toLowerCase()}</div>
         <div onClick={() => inputRef.current?.focus()} className="w-full flex flex-col items-center cursor-pointer">
            <input ref={inputRef} type="text" className="opacity-0 absolute w-0 h-0" onChange={handleHiddenInputChange} autoFocus />
            <div className={`flex flex-wrap justify-center gap-3 mb-16 min-h-[80px] p-6 w-full zine-card ${errorsCount >= 3 ? 'bg-[#D99C3B]' : answer.length === (word.original || '').length ? 'bg-[#88D64F]' : 'bg-[#F2EDE4] border-dashed'}`}>
               {answer.map((a,i) => <motion.div layoutId={`char-${a.id}-${i}`} key={i} className={`w-14 h-16 flex items-center justify-center font-black text-3xl border-[3px] border-black uppercase text-[#111111] ${errorsCount >= 3 ? 'bg-white' : answer.length === (word.original || '').length ? 'bg-white' : 'bg-white shadow-[4px_4px_0_#111111]'}`}>{a.char}</motion.div>)}
            </div>
         </div>
         <div className="flex flex-wrap justify-center gap-4">
            {letters.map((l, i) => <motion.div layoutId={`char-${l.id}`} key={l.id} onClick={() => { if(errorsCount<3) processInput(l.char, l); }} className={`w-16 h-20 bg-white border-[4px] border-black shadow-[6px_6px_0_#111111] flex items-center justify-center font-black text-3xl uppercase text-[#111111] cursor-pointer active:translate-y-2 active:shadow-none ${i%2===0?'rotate-2':'-rotate-2'}`}>{l.char}</motion.div>)}
         </div>
      </div>
   );
}

function ModeQuiz({ words, onProgress, onFinish }: any) {
  const isPreloaded = (words||[])[0]?.options !== undefined;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'playing'>(isPreloaded ? 'playing' : 'loading');
  const [quizData, setQuizData] = useState<any[]>(isPreloaded ? words : []);
  const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(quizData);
  const [ansIdx, setAnsIdx] = useState<number | null>(null);

  useEffect(() => {
    if (isPreloaded) return;
    const fetchBatch = async () => {
      setPhase('loading');
      const distsData = await ApiClient.aiGenerateBatchDistractors(words || []); const safeDists = Array.isArray(distsData) ? distsData : [];
      const formatted = (words||[]).map((w: any) => { const item = safeDists.find((d:any) => d.id === w.id); const dists = item && item.distractors && Array.isArray(item.distractors) && item.distractors.length >= 3 ? item.distractors.slice(0,3) : ['фейк 1', 'фейк 2', 'фейк 3']; return { ...w, options: [...dists, (w.translation || '').toLowerCase()].sort(() => Math.random() - 0.5) }; });
      setQuizData(formatted); setPhase('ready');
    }; fetchBatch();
  }, [words, isPreloaded]);

  useEffect(() => { if (isFinished && phase === 'playing') onFinish(); }, [isFinished, phase, onFinish]);

  if (phase === 'loading') return <div className="flex flex-col items-center justify-center p-8 h-64"><Loader2 className="w-12 h-12 animate-spin text-[#A235D8] mb-6"/><p className="text-[#F2EDE4] font-black text-xl uppercase text-center bg-black p-4 border-2 border-white -rotate-1">ИИ ПРИДУМЫВАЕТ<br/>ФЕЙКИ...</p></div>;
  if (phase === 'ready') return (
     <div className="flex flex-col items-center justify-center p-8 text-center zine-card bg-[#F2EDE4] rotate-1">
        <CheckCircle2 className="w-24 h-24 text-[#111111] mb-8 -rotate-6" />
        <h2 className="text-4xl font-marker text-[#111111] mb-2 uppercase">ТЕСТ ГОТОВ!</h2>
        <button onClick={() => setPhase('playing')} className="w-full bg-[#88D64F] text-[#111111] font-black text-2xl py-6 zine-btn mt-10">ПОГНАЛИ</button>
     </div>
  );

  if (!word) return <div className="flex justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;

  return (
    <div className="w-full max-w-sm flex flex-col items-center">
       <span className="text-[#F2EDE4] bg-black border-[3px] border-white px-4 py-2 font-black text-xl mb-8 inline-block rotate-1">{currentNum} / {queueLength}</span>
       <div className="w-full zine-card bg-[#F2EDE4] p-10 text-center mb-10 -rotate-1"><h2 className="text-5xl font-black text-[#111111] uppercase">{(word.original || '').toLowerCase()}</h2></div>
       <div className="w-full space-y-5">
          {(word.options||[]).map((opt: string, i: number) => {
             let stateClass = "bg-white text-[#111111]";
             const cleanOpt = (opt || '').toLowerCase(); const cleanTranslation = (word.translation || '').toLowerCase();
             if (ansIdx !== null) { if (cleanOpt === cleanTranslation) stateClass = "bg-[#88D64F] text-[#111111]"; else if (i === ansIdx) stateClass = "bg-[#D99C3B] text-[#111111]"; else stateClass = "bg-white text-[#111111] opacity-40"; }
             return <button key={i} data-sound="none" onClick={() => { if(ansIdx===null) { setAnsIdx(i); const isCorrect = cleanOpt === cleanTranslation; SoundManager.play(isCorrect ? 'correct' : 'wrong'); onProgress(word.id, isCorrect); setTimeout(() => { handleNext(word, isCorrect); setAnsIdx(null); }, 1500) } }} className={`w-full py-6 px-4 zine-btn text-xl ${i%2===0?'rotate-1':'-rotate-1'} ${stateClass}`}>{cleanOpt}</button>;
          })}
       </div>
    </div>
  );
}

function ModeFlashcards({ words, onProgress, onFinish }: any) {
  const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
  const [isFlipped, setIsFlipped] = useState(false);
  useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
  if (!word) return <div className="flex justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;

  return (
    <div className="w-full flex flex-col items-center">
      <span className="text-[#F2EDE4] bg-black border-[3px] border-white px-4 py-2 font-black text-xl mb-8 inline-block rotate-1">{currentNum} / {queueLength}</span>
      <div className="w-full h-96 relative cursor-pointer perspective-1000" onClick={() => { SoundManager.play('click'); setIsFlipped(!isFlipped); }}>
         <motion.div animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 100, damping: 20 }} className="w-full h-full relative [transform-style:preserve-3d]">
            <div className="absolute inset-0 [backface-visibility:hidden] zine-card bg-[#F2EDE4] flex flex-col items-center justify-center p-8 text-center -rotate-1"><h2 className="text-5xl font-black text-[#111111] uppercase">{(word.original || '').toLowerCase()}</h2><div className="text-[#111111] font-bold text-xl mt-6 bg-white border-[3px] border-black px-4 py-2 rotate-2">[{word.transcriptionUK}]</div></div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] zine-card bg-[#A235D8] flex flex-col items-center justify-center p-8 text-center rotate-1"><h2 className="text-4xl font-black text-[#111111] mb-6 uppercase bg-[#88D64F] px-4 py-2 border-[4px] border-black -rotate-2">{(word.translation || '').toLowerCase()}</h2><p className="text-[#111111] font-bold text-lg mb-6 bg-white border-[2px] border-black p-3">{word.cambridgeTranslation}</p>{word.examples?.[0] && <p className="text-[#111111] bg-[#F2EDE4] font-black p-4 border-[3px] border-black text-lg rotate-1 uppercase">"{word.examples[0].text}"</p>}</div>
         </motion.div>
      </div>
      <div className="mt-16 w-full flex gap-5"><button data-sound="none" onClick={() => { SoundManager.play('wrong'); onProgress(word.id, false); setIsFlipped(false); setTimeout(()=>handleNext(word, false), 250); }} className="flex-1 py-6 bg-white text-[#111111] zine-btn text-xl -rotate-1">НЕ ЗНАЮ</button><button data-sound="none" onClick={() => { SoundManager.play('correct'); onProgress(word.id, true); setIsFlipped(false); setTimeout(()=>handleNext(word, true), 250); }} className="flex-1 py-6 bg-[#88D64F] text-[#111111] zine-btn text-xl rotate-1">ЗНАЮ</button></div>
    </div>
  );
}

function ModeSentence({ words, onProgress, onFinish }: any) {
   const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
   const [input, setInput] = useState(''); const [status, setStatus] = useState<'idle'|'checking'|'correct'|'incorrect'>('idle'); const [fb, setFb] = useState('');

   useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
   useEffect(() => { setInput(''); setStatus('idle'); setFb(''); }, [word, currentNum]);
 
   if (!word) return <div className="flex justify-center"><Loader2 className="w-12 h-12 animate-spin text-[#88D64F]" /></div>;
   
   return (
     <div className="w-full flex flex-col h-[80vh]">
        <div className="flex-1">
          <span className="text-[#F2EDE4] bg-black border-[3px] border-white px-4 py-2 font-black text-xl mb-6 inline-block rotate-1 text-center mx-auto block w-max">{currentNum} / {queueLength}</span>
          <div className="zine-card bg-[#F2EDE4] p-8 mb-8 text-center rotate-1">
             <h2 className="text-4xl font-black text-[#111111] mb-4 uppercase">{(word.original || '').toLowerCase()}</h2>
             <p className="text-[#111111] font-bold text-xl bg-white border-[2px] border-black inline-block px-3 py-1 uppercase -rotate-2">{(word.translation || '').toLowerCase()}</p>
          </div>
          <textarea autoFocus value={input} onChange={e => { setInput(e.target.value); setStatus('idle'); }} placeholder="СОСТАВЬ ПРЕДЛОЖЕНИЕ..." disabled={status === 'checking' || status === 'correct'} className="w-full zine-input px-6 py-6 text-xl font-bold min-h-[160px] resize-none uppercase" />
          
          {status !== 'idle' && status !== 'checking' && (
             <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`mt-6 p-6 zine-card flex gap-4 ${status === 'correct' ? 'bg-[#88D64F] text-[#111111]' : 'bg-[#D99C3B] text-[#111111]'}`}>
                {status === 'correct' ? <CheckCircle2 className="w-10 h-10 shrink-0"/> : <XCircle className="w-10 h-10 shrink-0"/>}
                <p className="font-bold text-lg uppercase leading-tight">{fb}</p>
             </motion.div>
          )}
        </div>
        <div className="pb-8">
           {status === 'idle' && (
              <button data-sound="none" onClick={async () => { 
                    const cleanInput = (input || '').toLowerCase(); const cleanWord = (word.original || '').toLowerCase();
                    if (!cleanInput.includes(cleanWord)) { setStatus('incorrect'); setFb(`Ты забыл само слово: "${cleanWord}"!`); SoundManager.play('wrong'); onProgress(word.id, false); return; }
                    SoundManager.play('click'); setStatus('checking'); const r = await ApiClient.aiCheckSentence((word.original || ''), input); setFb(r.feedback); setStatus(r.isCorrect ? 'correct' : 'incorrect'); SoundManager.play(r.isCorrect ? 'correct' : 'wrong'); onProgress(word.id, r.isCorrect); 
                 }} disabled={!input} className="w-full bg-[#A235D8] text-[#111111] font-black text-xl py-6 zine-btn flex gap-3 justify-center -rotate-1"
              ><Brain className="w-6 h-6"/> ПРОВЕРИТЬ</button>
           )}
           {status === 'checking' && <div className="w-full bg-white text-[#111111] border-[4px] border-black font-black py-6 text-xl flex justify-center rotate-1"><Loader2 className="animate-spin w-6 h-6 mr-3" /> АНАЛИЗ...</div>}
           {(status === 'correct' || status === 'incorrect') && <button onClick={() => handleNext(word, status === 'correct')} className="w-full bg-[#111111] text-[#F2EDE4] font-black py-6 text-xl zine-btn flex justify-center gap-3 rotate-1">ДАЛЬШЕ <ArrowRight className="w-6 h-6"/></button>}
        </div>
     </div>
   );
}

function ModeBrainstorm({ words, onProgress, onFinish }: any) {
   const [phase, setPhase] = useState<'select'|'loading'|'flashcards'|'quiz'|'constructor'|'sentence'>('select');
   const [selected, setSelected] = useState<Set<string>>(new Set());
   const [preparedWords, setPreparedWords] = useState<any[]>([]);

   const startCycle = async () => {
      if(selected.size === 0) return alert('Выбери хоть что-то');
      setPhase('loading');
      const activeWords = (words||[]).filter((w:any) => selected.has(w.id));
      const distsData = await ApiClient.aiGenerateBatchDistractors(activeWords); const safeDists = Array.isArray(distsData) ? distsData : [];
      const formatted = activeWords.map((w:any) => { const item = safeDists.find((d:any) => d.id === w.id); const dists = item && item.distractors && Array.isArray(item.distractors) ? item.distractors.slice(0,3) : ['фейк 1', 'фейк 2', 'фейк 3']; return { ...w, options: [...dists, (w.translation || '').toLowerCase()].sort(() => Math.random() - 0.5) }; });
      setPreparedWords(formatted); setPhase('flashcards');
   };

   if (phase === 'select') return (
         <div className="w-full text-[#F2EDE4]">
            <h2 className="text-5xl font-marker text-[#D99C3B] mb-4 text-center -rotate-2 uppercase">Штурм</h2>
            <div className="flex justify-between items-center mb-8">
               <p className="text-xl font-bold bg-[#111111] p-2 border-2 border-[#F2EDE4] rotate-1">Слова для мясорубки.</p>
               <button onClick={() => selected.size === (words||[]).length ? setSelected(new Set()) : setSelected(new Set((words||[]).map((w:any)=>w.id)))} className="text-lg font-black text-[#111111] bg-[#88D64F] px-4 py-2 border-[3px] border-black uppercase -rotate-1">{selected.size === (words||[]).length ? 'Снять всё' : 'Выбрать всё'}</button>
            </div>
            <div className="space-y-4 mb-10 max-h-[50vh] overflow-y-auto pr-2">{(words||[]).map((w:any, i) => <div key={w.id} onClick={() => { const s=new Set(selected); s.has(w.id)?s.delete(w.id):s.add(w.id); setSelected(s); }} className={`p-5 zine-card flex justify-between font-black text-xl cursor-pointer clickable-card uppercase ${i%2===0?'rotate-1':'-rotate-1'} ${selected.has(w.id) ? 'bg-[#A235D8] text-[#111111]' : 'bg-white text-[#111111]'}`}>{(w.original || '').toLowerCase()} {selected.has(w.id) && <Check className="w-8 h-8 font-black"/>}</div>)}</div>
            <button onClick={startCycle} className="w-full bg-[#D99C3B] text-[#111111] font-black text-2xl py-6 zine-btn rotate-1">ПОГНАЛИ ({selected.size})</button>
         </div>
   );
   
   if (phase === 'loading') return <div className="flex flex-col items-center justify-center p-8 h-64"><Loader2 className="w-16 h-16 animate-spin text-[#D99C3B] mb-6"/><p className="text-[#F2EDE4] font-black text-2xl text-center uppercase">Жарим базу...</p></div>;
   if (phase === 'flashcards') return <div className="w-full h-full flex flex-col"><h3 className="font-marker text-3xl mb-8 text-center text-[#88D64F] uppercase">Этап 1: КАРТОЧКИ</h3><ModeFlashcards words={preparedWords} onProgress={()=>{}} onFinish={() => setPhase('quiz')} /></div>;
   if (phase === 'quiz') return <div className="w-full h-full flex flex-col"><h3 className="font-marker text-3xl mb-8 text-center text-[#A235D8] uppercase">Этап 2: ТЕСТ</h3><ModeQuiz words={preparedWords} onProgress={onProgress} onFinish={() => setPhase('constructor')} /></div>;
   if (phase === 'constructor') return <div className="w-full h-full flex flex-col"><h3 className="font-marker text-3xl mb-8 text-center text-[#D99C3B] uppercase">Этап 3: СБОРКА</h3><ModeConstructor words={preparedWords} onProgress={onProgress} onFinish={() => setPhase('sentence')} /></div>;
   if (phase === 'sentence') return <div className="w-full h-full flex flex-col"><h3 className="font-marker text-3xl mb-8 text-center text-[#F2EDE4] uppercase">Этап 4: ФРАЗЫ</h3><ModeSentence words={preparedWords} onProgress={onProgress} onFinish={onFinish} /></div>;
   
   return null;
}

function OnboardingModal({ user, onSave }: any) {
  const [step, setStep] = useState(0); const [level, setLevel] = useState('Intermediate'); const [goal, setGoal] = useState(15); const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  useEffect(() => { window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setDeferredPrompt(e); }); }, []);
  
  const slides = [
    { icon: <Wand2 className="w-16 h-16 text-[#111111]" />, title: "ИИ-СЛОВАРЬ", text: "Никакого гугл-транслейта. Наша нейронка выдает жесткий, правильный перевод, транскрипции и примеры." },
    { icon: <Edit3 className="w-16 h-16 text-[#111111]" />, title: "СВОИ ПРАВИЛА", text: "Твой словарь — твой зин. Группируй слова, сбрасывай прогресс, переписывай ИИ, если он тупит." },
    { icon: <Brain className="w-16 h-16 text-[#111111]" />, title: "МЯСОРУБКА", text: "5 режимов тренировки. Ошибаешься — платишь временем. Классика, викторины, сборка и хардкорный Штурм." },
    { icon: <Calendar className="w-16 h-16 text-[#111111]" />, title: "СТРИК", text: "Только регулярность. Ставь цель, держи стрик, смотри как горит твой календарь." }
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{type:'spring', stiffness: 200, damping: 25}} className="zine-card bg-[#F2EDE4] w-full max-w-md overflow-hidden relative z-10 p-2">
        {step < 4 ? (
          <div className="p-6 text-center">
            <div className="w-28 h-28 mx-auto bg-[#88D64F] border-[4px] border-black flex items-center justify-center mb-8 rotate-2">
              {slides[step].icon}
            </div>
            <h2 className="text-3xl font-marker mb-4 text-[#111111] uppercase">{slides[step].title}</h2>
            <p className="text-[#111111] font-bold text-lg leading-tight mb-8 p-4 border-[2px] border-black bg-white -rotate-1">{slides[step].text}</p>
            <div className="flex justify-center gap-3 mt-8">
               {[0,1,2,3].map(i => <div key={i} className={`w-4 h-4 border-2 border-black transition-colors ${step === i ? 'bg-[#A235D8]' : 'bg-white'}`} />)}
            </div>
          </div>
        ) : (
          <div className="p-6">
             <div className="w-20 h-20 mx-auto bg-[#D99C3B] border-[4px] border-black flex items-center justify-center mb-6 -rotate-2"><GraduationCap className="w-10 h-10 text-[#111111]" /></div>
             <h2 className="text-3xl font-marker mb-4 text-[#111111] text-center uppercase">Твой уровень?</h2>
             <div className="grid grid-cols-2 gap-4 mb-8">
               {LEVELS.map((l, i) => <button key={l} onClick={() => setLevel(l)} className={`p-4 border-[3px] border-black font-black uppercase text-sm transition-transform active:translate-y-1 ${i%2===0?'rotate-1':'-rotate-1'} ${level === l ? 'bg-[#88D64F] text-[#111111]' : 'bg-white text-[#111111]'}`}>{l}</button>)}
             </div>
             <h2 className="text-2xl font-marker mb-4 text-[#111111] text-center uppercase">Цель (минут)</h2>
             <div className="flex gap-3 mb-8">
               {[5,10,15,30].map((m, i) => <button key={m} onClick={() => setGoal(m)} className={`flex-1 p-4 border-[3px] border-black font-black text-xl transition-transform active:translate-y-1 ${i%2===0?'-rotate-2':'rotate-2'} ${goal === m ? 'bg-[#A235D8] text-[#111111]' : 'bg-white text-[#111111]'}`}>{m}</button>)}
             </div>
             {deferredPrompt && (
                 <button onClick={()=>{ deferredPrompt.prompt(); deferredPrompt.userChoice.then(()=>{ setDeferredPrompt(null); }) }} className="w-full py-5 bg-[#111111] text-[#F2EDE4] font-black text-lg border-[3px] border-black mt-2 active:translate-y-1 flex justify-center items-center gap-3 rotate-1 uppercase"><Download className="w-6 h-6"/> На экран "Домой"</button>
             )}
          </div>
        )}
        <div className="p-4 bg-[#111111] border-[4px] border-black flex gap-4 mt-2">
          {step > 0 && <button onClick={() => setStep(s=>s-1)} className="px-6 bg-white text-[#111111] font-black uppercase border-2 border-black active:translate-y-1">Назад</button>}
          <button onClick={() => { if (step < 4) setStep(s=>s+1); else onSave(level, goal); }} className="flex-1 bg-[#88D64F] text-[#111111] font-black text-xl py-5 border-[3px] border-white active:translate-y-1 uppercase">
            {step < 4 ? 'ДАЛЬШЕ' : 'ГОТОВО'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
