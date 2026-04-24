/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, PlayCircle, Settings, Plus, X, CheckCircle2, XCircle, 
  ArrowRight, Brain, Type, FlipHorizontal, Check, Loader2, 
  BookOpen, Trash2, FolderPlus, ArrowLeft, Edit3, AlertTriangle, RefreshCw,
  LogOut, Wand2, GraduationCap, Download, Mail, Calendar, RotateCcw, Info,
  ChevronLeft, ChevronRight, UploadCloud, Sparkles, User as UserIcon
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
      if (!res.ok) throw new Error('API Error'); return await res.json();
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
       if (!res.ok) throw new Error('API Error'); return await res.json();
     } catch(e) { return []; }
  }
}

export const getEffectiveMastery = (word: Partial<Word>) => {
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
           <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-6 shadow-2xl relative z-10 w-full max-w-sm text-center">
              {type === 'error' ? <XCircle className="w-12 h-12 text-rose-500 mx-auto mb-4"/> : type === 'success' ? <CheckCircle2 className="w-12 h-12 text-teal-500 mx-auto mb-4"/> : <Info className="w-12 h-12 text-sky-500 mx-auto mb-4"/>}
              <h2 className="text-xl font-bold mb-2 text-stone-800">{title}</h2>
              <p className="text-stone-500 text-sm mb-6">{message}</p>
              <button onClick={onClose} className="w-full py-4 bg-stone-100 text-stone-800 font-bold rounded-2xl active:scale-95">ОК</button>
           </motion.div>
       </div>
   )
}

function ConfirmModal({ title, message, onConfirm, onClose }: any) {
   return (
       <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
           <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-6 shadow-2xl relative z-10 w-full max-w-sm text-center">
              <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-4"/>
              <h2 className="text-xl font-bold mb-2 text-stone-800">{title}</h2>
              <p className="text-stone-500 text-sm mb-6">{message}</p>
              <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-800 font-bold rounded-2xl active:scale-95">Отмена</button>
                  <button onClick={() => { onConfirm(); onClose(); }} className="flex-1 py-4 bg-orange-500 text-white font-bold rounded-2xl active:scale-95">Подтвердить</button>
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
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F7F5]">
        {alertData && <AlertModal title={alertData.title} message={alertData.message} type={alertData.type} onClose={()=>setAlertData(null)} />}
        
        {showRegisterPrompt && (
           <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
               <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => setShowRegisterPrompt(false)} />
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-6 shadow-2xl relative z-10 w-full max-w-sm text-center">
                  <UserIcon className="w-12 h-12 text-stone-400 mx-auto mb-4"/>
                  <h2 className="text-xl font-bold mb-2 text-stone-800">Аккаунт не найден</h2>
                  <p className="text-stone-500 text-sm mb-6">Кажется, вы еще не зарегистрированы или ввели неверный пароль. Хотите создать новый аккаунт с этим email?</p>
                  <div className="flex flex-col gap-3">
                      <button onClick={() => { setShowRegisterPrompt(false); setView('register'); }} className="w-full py-4 bg-teal-600 text-white font-bold rounded-2xl active:scale-95 transition-transform">Создать аккаунт</button>
                      <button onClick={() => setShowRegisterPrompt(false)} className="w-full py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:scale-95 transition-transform">Попробовать снова</button>
                  </div>
               </motion.div>
           </div>
        )}

        <div className="bg-white/60 p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl border border-white/60 w-full max-w-sm flex flex-col items-center">
           <BookOpen className="w-16 h-16 text-teal-600 mb-6" />
           <h1 className="text-4xl font-black mb-2 text-center text-stone-800">Words</h1>
           <p className="text-stone-500 text-center mb-8 text-sm">Ваш персональный ИИ-репетитор.</p>
           
           <form onSubmit={handleSubmit} className="w-full space-y-4">
              {view === 'register' && <input required value={name} onChange={e=>setName(e.target.value)} type="text" placeholder="Ваше имя" className="w-full bg-white px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors" />}
              <input required value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" className="w-full bg-white px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors" />
              {view !== 'forgot' && <input required value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Пароль" className="w-full bg-white px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors" />}
              
              <button type="submit" disabled={loading} className="w-full py-4 bg-teal-600 text-white font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50">
                 {loading ? <Loader2 className="animate-spin mx-auto w-5 h-5"/> : view === 'login' ? 'Войти' : view === 'register' ? 'Зарегистрироваться' : 'Восстановить пароль'}
              </button>
           </form>

           <div className="w-full flex justify-between items-center mt-4 text-sm font-bold">
              {view !== 'forgot' ? (
                 <>
                    <button onClick={()=>setView(view==='login'?'register':'login')} className="text-stone-500">{view === 'login' ? 'Создать аккаунт' : 'Уже есть аккаунт?'}</button>
                    {view === 'login' && <button onClick={()=>setView('forgot')} className="text-teal-600">Забыли пароль?</button>}
                 </>
              ) : (
                 <button onClick={()=>setView('login')} className="text-stone-500 mx-auto w-full text-center">Вернуться ко входу</button>
              )}
           </div>

           {view !== 'forgot' && (
              <>
                 <div className="w-full border-t border-stone-200 my-6"></div>
                 <button onClick={handleGoogle} className="w-full py-4 bg-white border border-stone-100 text-stone-800 font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform">
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

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5]"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  if (!user) return <AuthScreen />;
  
  if (!user.emailVerified && user.providerData[0]?.providerId === 'password') {
     return <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F7F5] text-center"><Mail className="w-16 h-16 text-orange-400 mb-6"/><h2 className="text-2xl font-bold mb-4">Подтвердите Email</h2><p className="text-stone-500 mb-8">Письмо отправлено на {user.email}. Подтвердите почту и обновите страницу.</p><button onClick={()=>signOut(auth)} className="px-8 py-4 bg-stone-200 font-bold rounded-2xl">Выйти</button></div>;
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
  
  const [appAlert, setAppAlert] = useState<{title:string, message:string, type?:'error'|'success'|'info'}|null>(null);
  const [appConfirm, setAppConfirm] = useState<{title:string, message:string, onConfirm:()=>void}|null>(null);

  const [calendarDate, setCalendarDate] = useState(new Date());

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
       setAppConfirm({
          title: "Удаление аккаунта", 
          message: "Вы уверены? Действие необратимо.", 
          onConfirm: async () => {
             const password = window.prompt("Для подтверждения введите текущий пароль:");
             if (password) {
                 try {
                     const cred = EmailAuthProvider.credential(user.email!, password);
                     await reauthenticateWithCredential(user, cred);
                     words.forEach(w => deleteDoc(doc(db, 'users', user.uid, 'words', w.id)));
                     groups.forEach(g => deleteDoc(doc(db, 'users', user.uid, 'groups', g.id)));
                     await deleteUser(user);
                 } catch(e:any) { setAppAlert({title:"Ошибка", message: "Неверный пароль.", type:"error"}); }
             }
          }
       });
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

  if (!isDataLoaded) return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5]"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  if (userProfile && !userProfile.onboarded) return <OnboardingModal user={user} onSave={(level: string, goal: number) => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, dailyGoal: goal, onboarded: true, activity: {}, streak: 0 }, { merge: true })} />;

  return (
    <div className="min-h-screen bg-[#F7F7F5] font-sans text-stone-800 md:flex flex-row relative overflow-hidden">
      {appAlert && <AlertModal title={appAlert.title} message={appAlert.message} type={appAlert.type} onClose={()=>setAppAlert(null)}/>}
      {appConfirm && <ConfirmModal title={appConfirm.title} message={appConfirm.message} onConfirm={appConfirm.onConfirm} onClose={()=>setAppConfirm(null)}/>}
      
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-white/70 backdrop-blur-xl border-r border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4 text-teal-600"><BookOpen className="w-8 h-8" /> <span className="text-2xl font-black text-stone-800">Words</span></div>
          <nav className="flex-1 space-y-2">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'progress'} icon={<Calendar />} label="Прогресс" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-white/70 backdrop-blur-xl border-t border-white/60 flex justify-around items-center px-2 z-40 pb-safe shadow-[0_-8px_30px_rgb(0,0,0,0.02)]">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-6 h-6" />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-6 h-6" />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-6 h-6" />} label="Учить" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'progress'} icon={<Calendar className="w-6 h-6" />} label="Прогресс" onClick={() => { setActiveTab('progress'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-6 h-6" />} label="Меню" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      <main className={`flex-1 flex flex-col h-screen overflow-y-auto ${!activeTrainingMode ? 'md:ml-64 pb-24 md:pb-0' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col">
          {!activeTrainingMode && !viewingGroupId && (
            <div className="sticky top-0 z-30 bg-[#F7F7F5]/80 backdrop-blur-xl pt-12 md:pt-8 pb-4 px-4 md:px-8 border-b border-stone-200/50">
              <h1 className="text-3xl font-bold tracking-tight text-stone-800">
                 {activeTab === 'dict' ? 'Ваш словарь' : activeTab === 'groups' ? 'Группы слов' : activeTab === 'train' ? 'Тренировка' : activeTab === 'progress' ? 'Ваш прогресс' : 'Настройки'}
              </h1>
            </div>
          )}

          <div className="flex-1 w-full relative">
            <AnimatePresence mode="wait">
               {/* 1. Вкладка Словарь */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
                 <motion.div key="tab-dict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 space-y-3 pb-32 md:pb-8">
                   {words.length > 0 && <div className="flex justify-between items-center px-1 mb-2"><button onClick={() => selectedWordIds.size === words.length ? setSelectedWordIds(new Set()) : setSelectedWordIds(new Set(words.map(w => w.id)))} className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"><CheckCircle2 className="w-4 h-4"/> Выбрать все</button></div>}
                   {words.length === 0 ? <div className="text-center text-stone-400 py-12">Словарь пуст.</div> : words.map(word => (
                     <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                        <button onClick={() => { const n = new Set(selectedWordIds); n.has(word.id)?n.delete(word.id):n.add(word.id); setSelectedWordIds(n); }} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}>{selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}</button>
                        <div className="flex-1 cursor-pointer" onClick={() => setViewingWordId(word.id)}>
                          <div className="flex items-center gap-2"><h3 className="text-lg font-bold text-stone-800">{(word.original || '').toLowerCase()}</h3> {word.partOfSpeech && <span className="text-[10px] font-bold text-stone-400 uppercase bg-stone-100 px-2 py-0.5 rounded-md">{word.partOfSpeech}</span>}</div>
                          <p className="text-stone-500 text-sm mt-0.5 line-clamp-1">{(word.translation || '').toLowerCase()}</p>
                          <MasteryBar masteryLevel={getEffectiveMastery(word)} />
                        </div>
                     </div>
                   ))}
                   {selectedWordIds.size === 0 && (
                      <div className="fixed bottom-24 md:bottom-8 right-5 md:right-8 flex flex-col gap-3 z-20">
                         <button onClick={() => setShowGenerateModal(true)} className="w-14 h-14 bg-purple-600 text-white rounded-full shadow-[0_8px_30px_rgb(147,51,234,0.3)] flex items-center justify-center active:scale-90 transition-all"><Wand2 className="w-6 h-6" /></button>
                         <button onClick={() => setShowAddWord(true)} className="w-14 h-14 bg-teal-600 text-white rounded-full shadow-[0_8px_30px_rgb(13,148,136,0.3)] flex items-center justify-center active:scale-90 transition-all"><Plus className="w-6 h-6" /></button>
                      </div>
                   )}
                   <BulkActions selectedWordIds={selectedWordIds} onTrain={() => setActiveTab('train')} onDelete={(ids:string[]) => setAppConfirm({title:'Удаление слов', message:`Удалить выбранные слова (${ids.length})?`, onConfirm: ()=>deleteWords(ids)})} onReset={(ids:string[]) => setAppConfirm({title:'Сброс прогресса', message:`Сбросить прогресс для выбранных слов (${ids.length})?`, onConfirm: ()=>resetProgress(ids)})} onAddToGroup={() => setShowBulkAddGroup(true)} />
                 </motion.div>
               )}

               {/* 2. Вкладка Группы */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
                 <motion.div key="tab-groups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 space-y-3 pb-32 md:pb-8">
                    <button onClick={() => setShowAddGroup(true)} className="w-full bg-teal-50 border border-teal-100 text-teal-700 font-bold py-4 rounded-[2rem] flex items-center justify-center gap-2 mb-4 active:scale-95 transition-transform"><Plus className="w-5 h-5"/> Создать группу</button>
                    {(groups || []).length === 0 ? <div className="text-center text-stone-400 py-12">Нет групп.</div> : (groups || []).map(group => (
                      <div key={group.id} onClick={() => setViewingGroupId(group.id)} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform">
                          <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center shrink-0"><Layers className="w-6 h-6 text-sky-600" /></div>
                          <div className="flex-1"><h3 className="text-lg font-bold text-stone-800">{group.name}</h3><p className="text-stone-500 text-sm mt-0.5">{(words||[]).filter(w=>(w.groupIds||[]).includes(group.id)).length} слов</p></div>
                          <ArrowRight className="w-5 h-5 text-stone-300" />
                      </div>
                    ))}
                 </motion.div>
               )}

               {/* 3. Вкладка Тренировка */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
                 <motion.div key="tab-train" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                   {(selectedWordIds.size === 0 && selectedGroupIds.size === 0) ? (
                      <div className="mb-8">
                         <p className="text-stone-500 mb-4">Выберите базу для тренировки:</p>
                         <div className="space-y-3">
                            <button onClick={() => setShowSmartSelection(true)} className="w-full bg-indigo-50 border border-indigo-100 text-indigo-700 p-5 rounded-[2rem] font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between">
                               <span className="flex items-center gap-2"><Brain className="w-5 h-5"/> Умный подбор</span> <span className="font-normal opacity-70">Слабые слова</span>
                            </button>
                            <button onClick={() => setSelectedWordIds(new Set((words||[]).map(w => w.id)))} className="w-full bg-teal-50 p-5 rounded-[2rem] shadow-sm border border-teal-100 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between text-teal-700"><span>Весь словарь</span> <span className="font-normal opacity-70">{(words||[]).length} слов</span></button>
                            {(groups || []).map(group => (
                                  <button key={group.id} onClick={() => setSelectedGroupIds(new Set([group.id]))} className="w-full bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between"><span>{group.name}</span> <span className="text-stone-400 font-normal">{(words||[]).filter(w => (w.groupIds||[]).includes(group.id)).length} слов</span></button>
                            ))}
                         </div>
                      </div>
                   ) : (
                      <>
                         <div className="flex items-center justify-between mb-8 bg-white/50 p-4 rounded-2xl border border-white/60">
                            <p className="text-stone-600 font-medium">Выбрано: <span className="font-black text-stone-900">{selectedWordIds.size > 0 ? selectedWordIds.size : (words||[]).filter(w => (w.groupIds||[]).some(id => selectedGroupIds.has(id))).length}</span></p>
                            <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-stone-400 font-bold bg-stone-200/50 px-4 py-2 rounded-xl active:scale-95 transition-transform flex items-center gap-1"><X className="w-4 h-4"/> Очистить</button>
                         </div>
                         <div className="grid grid-cols-2 gap-4">
                           <TrainCard title="Карточки" desc="Базовое запоминание" icon={<FlipHorizontal />} color="text-sky-600" bg="bg-sky-50" onClick={() => startTraining('flashcards')} />
                           <TrainCard title="Викторина" desc="Тест вариантов" icon={<CheckCircle2 />} color="text-teal-600" bg="bg-teal-50" onClick={() => startTraining('quiz')} />
                           <TrainCard title="Конструктор" desc="Собери слово" icon={<Layers />} color="text-orange-500" bg="bg-orange-50" onClick={() => startTraining('constructor')} />
                           <TrainCard title="Фразы" desc="Свой контекст" icon={<Type />} color="text-indigo-500" bg="bg-indigo-50" onClick={() => startTraining('sentence')} />
                           <TrainCard title="Брейншторм" desc="Комбо-режим" icon={<Brain />} color="text-purple-500" bg="bg-purple-50" className="col-span-2" onClick={() => startTraining('brainstorm')} />
                         </div>
                      </>
                   )}
                 </motion.div>
               )}

               {/* 4. Вкладка Прогресс с Календарем */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'progress' && (
                 <motion.div key="tab-progress" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                     <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 mb-6 text-center">
                        <div className="text-6xl font-black text-orange-400 mb-2">🔥 {userProfile?.streak || 0}</div>
                        <div className="text-stone-400 font-bold uppercase tracking-widest text-xs">Дней подряд</div>
                     </div>
                     <h3 className="font-bold text-stone-800 mb-4 text-xl">Календарь активности</h3>
                     <div className="bg-white rounded-[2rem] p-6 shadow-sm border border-stone-100">
                        <div className="flex justify-between items-center mb-6">
                           <button onClick={prevMonth} className="p-2 bg-stone-100 rounded-full active:scale-95"><ChevronLeft className="w-5 h-5 text-stone-600"/></button>
                           <span className="font-bold text-stone-800">{currentMonthName} {currentYear}</span>
                           <button onClick={nextMonth} className="p-2 bg-stone-100 rounded-full active:scale-95"><ChevronRight className="w-5 h-5 text-stone-600"/></button>
                        </div>
                        <div className="grid grid-cols-7 gap-2">
                           {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=><div key={d} className="text-center text-xs font-bold text-stone-400 mb-2">{d}</div>)}
                           {Array.from({ length: startDay }).map((_, i) => <div key={`empty-${i}`} />)}
                           {Array.from({ length: daysInMonth }).map((_, i) => {
                               const day = i + 1;
                               const dateStr = `${currentYear}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                               const mins = userProfile?.activity?.[dateStr] || 0;
                               const isGoalReached = mins >= (userProfile?.dailyGoal || 15);
                               return <div key={i} className={`aspect-square rounded-xl flex items-center justify-center text-xs font-bold ${isGoalReached ? 'bg-orange-400 text-white shadow-sm' : mins > 0 ? 'bg-orange-200 text-orange-800' : 'bg-stone-50 text-stone-400'}`}>{day}</div>
                           })}
                        </div>
                     </div>
                 </motion.div>
               )}

               {/* 5. Вкладка Настройки */}
               {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
                 <motion.div key="tab-settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="p-4 md:p-8 pb-32 md:pb-8">
                     <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 mb-6">
                        <div className="font-bold text-lg text-stone-800 mb-1">{user?.displayName || 'Пользователь'}</div>
                        <div className="text-stone-500 text-sm mb-6">{user?.email || 'Скрытый email'}</div>
                        
                        <div className="border-t border-stone-100 pt-6">
                           <h3 className="font-bold text-stone-800 mb-4">Уровень языка</h3>
                           <div className="grid grid-cols-2 gap-2 mb-6">
                             {LEVELS.map((lvl) => <button key={lvl} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), level: lvl }, { merge: true })} className={`py-3 text-xs font-bold rounded-xl transition-all ${userProfile?.level === lvl ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'}`}>{lvl}</button>)}
                           </div>
                           <h3 className="font-bold text-stone-800 mb-4">Цель (минут в день)</h3>
                           <div className="flex gap-2">
                              {[5,10,15,30].map((m) => <button key={m} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), dailyGoal: m }, { merge: true })} className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all ${userProfile?.dailyGoal === m ? 'bg-orange-400 text-white shadow-sm' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'}`}>{m}</button>)}
                           </div>
                        </div>
                     </div>
                     <div className="space-y-3">
                       <button onClick={resetAllProgress} className="w-full py-4 bg-stone-200/50 text-stone-700 font-bold rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"><RotateCcw className="w-5 h-5"/> Сбросить весь прогресс</button>
                       <button onClick={resetEntireDictionary} className="w-full py-4 bg-rose-50 text-rose-500 font-bold rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"><Trash2 className="w-5 h-5"/> Очистить словарь полностью</button>
                       <button onClick={() => setAppConfirm({title:"Выход", message:"Уверены, что хотите выйти из аккаунта?", onConfirm:()=>signOut(auth)})} className="w-full py-4 bg-stone-900 text-white font-bold rounded-2xl active:scale-95 transition-transform flex justify-center items-center gap-2 mt-8"><LogOut className="w-5 h-5"/> Выйти</button>
                       <button onClick={handleDeleteAccount} className="w-full py-4 text-stone-400 font-bold text-sm active:scale-95 transition-transform">Навсегда удалить аккаунт</button>
                     </div>
                 </motion.div>
               )}
            </AnimatePresence>
          </div>

          <AnimatePresence>
            {showGenerateModal && <GenerateWordsModal words={words} user={user} groups={groups} userProfile={userProfile} onClose={() => setShowGenerateModal(false)} onWordClick={(id:string)=>{setShowGenerateModal(false); setViewingWordId(id);}} onSaveWord={(w:any) => { const id=doc(collection(db,'users',user.uid,'words')).id; setDoc(doc(db,'users',user.uid,'words',id),{...w,id,createdAt:Date.now(),masteryLevel:0, lastPracticed: Date.now()}); }} />}
            {showAddWord && <AddWordModal words={words} user={user} userProfile={userProfile} groups={groups} onClose={() => setShowAddWord(false)} onWordClick={(id:string)=>{setShowAddWord(false); setViewingWordId(id);}} onSaveWord={(w:any) => { const id=doc(collection(db,'users',user.uid,'words')).id; setDoc(doc(db,'users',user.uid,'words',id),{...w,id,createdAt:Date.now(),masteryLevel:0, lastPracticed: Date.now()}); }} />}
            {viewingWordId && <WordEditorModal words={words} word={(words||[]).find(w=>w.id===viewingWordId)!} groups={groups} userProfile={userProfile} user={user} onClose={() => setViewingWordId(null)} onReset={() => setAppConfirm({title:"Сброс прогресса", message:"Сбросить прогресс этого слова?", onConfirm: ()=>resetProgress([viewingWordId])})} onWordClick={(id:string)=>setViewingWordId(id)} onSave={(w:any) => { updateDoc(doc(db,'users',user.uid,'words',w.id),w); }} onDelete={() => { setAppConfirm({title:"Удаление", message:"Удалить это слово из словаря?", onConfirm:()=>{deleteWords([viewingWordId!]); setViewingWordId(null);}}) }} />}
            {showAddGroup && <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { const id=doc(collection(db,'users',user.uid,'groups')).id; setDoc(doc(db,'users',user.uid,'groups',id),{id,name:n}); setShowAddGroup(false); }} />}
            {showBulkAddGroup && <BulkAddGroupModal groups={groups} onClose={() => setShowBulkAddGroup(false)} onOpenAddGroup={() => { setShowAddGroup(true); }} onSave={(gid:string) => { (words||[]).forEach(w=>{if(selectedWordIds.has(w.id)&&!(w.groupIds||[]).includes(gid)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),gid]});}); setShowBulkAddGroup(false); setSelectedWordIds(new Set()); }} />}
            {showSmartSelection && <SmartSelectionModal words={words} onClose={() => setShowSmartSelection(false)} onSelect={(pickedIds: string[]) => { setSelectedWordIds(new Set(pickedIds)); setSelectedGroupIds(new Set()); setShowSmartSelection(false); }} />}
            {showBulkAddGroup && showAddGroup && <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { const newId = doc(collection(db,'users',user.uid,'groups')).id; setDoc(doc(db,'users',user.uid,'groups',newId), {id: newId, name:n}); (words||[]).forEach(w=>{if(selectedWordIds.has(w.id)&&!(w.groupIds||[]).includes(newId)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),newId]});}); setShowAddGroup(false); setShowBulkAddGroup(false); setSelectedWordIds(new Set()); }} />}
            {viewingGroupId && <GroupView group={(groups||[]).find(g=>g.id===viewingGroupId)!} words={(words||[]).filter(w=>(w.groupIds||[]).includes(viewingGroupId!))} onClose={()=>setViewingGroupId(null)} onDeleteGroup={()=>setAppConfirm({title:"Удаление группы", message:"Группа будет удалена. Слова останутся в общем словаре.", onConfirm:()=>{deleteGroup(viewingGroupId); setViewingGroupId(null);}})} onRemoveFromGroup={(wid:string)=>{ const w=(words||[]).find(x=>x.id===wid); if(w) updateDoc(doc(db,'users',user.uid,'words',wid),{groupIds:(w.groupIds||[]).filter(g=>g!==viewingGroupId)}); }} selectedWordIds={selectedWordIds} setSelectedWordIds={setSelectedWordIds} onTrain={()=>{ setActiveTab('train'); setViewingGroupId(null); }} onWordClick={(id:string)=>setViewingWordId(id)} />}
            {showDeleteConfirm && <DeleteAccountModal onClose={() => setShowDeleteConfirm(false)} onDelete={async (pwd: string) => { try { const cred = EmailAuthProvider.credential(user.email!, pwd); await reauthenticateWithCredential(user, cred); await resetEntireDictionary(); await deleteUser(user); } catch(e:any) { setAppAlert({title:"Ошибка", message:"Неверный пароль. Попробуйте еще раз.", type:"error"}); } }} />}
          </AnimatePresence>
        </div>
      </main>

      {/* ЭКРАНЫ ТРЕНИРОВОК */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div key="training-overlay" initial={{ opacity: 0, y: '10%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '10%' }} className="fixed inset-0 bg-[#F7F7F5] z-50 flex flex-col">
               <div className="flex justify-between items-center p-4 md:p-8 bg-white/70 backdrop-blur-xl border-b border-stone-200/50">
                  <span className="font-bold text-stone-800 tracking-tight capitalize">{activeTrainingMode === 'stats' ? 'Результаты' : activeTrainingMode}</span>
                  {activeTrainingMode !== 'stats' && <button onClick={() => setActiveTrainingMode('stats')} className="px-4 py-2 bg-stone-200/50 text-stone-600 rounded-full hover:bg-stone-200 active:scale-95 transition-all font-bold text-sm flex items-center gap-2">Завершить <X className="w-4 h-4" /></button>}
                  {activeTrainingMode === 'stats' && <button onClick={closeTraining} className="p-2 bg-stone-100 rounded-full hover:bg-stone-200 active:scale-95 transition-all"><X className="w-5 h-5 text-stone-600" /></button>}
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

// --- КОМПОНЕНТЫ И МОДАЛКИ (БЕЗ ДУБЛИКАТОВ) ---
function SidebarItem({ active, icon, label, onClick }: any) { return <button onClick={onClick} className={`flex items-center w-full px-4 py-4 gap-3 rounded-2xl transition-colors ${active ? 'text-teal-700 bg-teal-50 font-bold' : 'text-stone-500 hover:bg-stone-100 font-medium'} `}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-6 h-6" })}</div><span>{label}</span></button>; }
function NavItem({ active, icon, label, onClick }: any) { return <button onClick={onClick} className={`flex flex-col items-center flex-1 py-1 gap-1 transition-colors ${active ? 'text-teal-600 font-bold' : 'text-stone-400 font-medium'}`}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{icon}</div><span className="text-[10px]">{label}</span></button>; }
function MasteryBar({ masteryLevel }: { masteryLevel: number }) { return <div className="mt-3 w-full bg-stone-100 rounded-full h-1 overflow-hidden"><div className={`h-full ${masteryLevel > 70 ? 'bg-teal-500' : masteryLevel > 30 ? 'bg-sky-400' : 'bg-orange-400'} transition-all duration-700`} style={{ width: `${masteryLevel}%` }} /></div>; }
function TrainCard({ title, desc, icon, color, bg, className="", onClick }: any) { return <div onClick={onClick} className={`bg-white p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 flex flex-col gap-4 active:scale-95 transition-transform cursor-pointer ${className}`}><div className={`w-14 h-14 rounded-2xl ${bg} flex items-center justify-center`}>{React.cloneElement(icon, { className: `w-7 h-7 ${color}` })}</div><div><div className="font-bold text-stone-800 text-lg">{title}</div><div className="text-xs text-stone-400 font-medium">{desc}</div></div></div>; }
function BulkActions({ selectedWordIds, onTrain, onDelete, onReset, onAddToGroup }: any) {
  if (selectedWordIds.size === 0) return null;
  return (
    <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-30 border border-stone-200/50 w-[90%] max-w-md">
      <button onClick={() => onDelete(Array.from(selectedWordIds))} className="flex flex-col items-center p-2 text-rose-500 active:opacity-70 flex-1"><Trash2 className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">Удалить</span></button>
      <button onClick={() => onReset(Array.from(selectedWordIds))} className="flex flex-col items-center p-2 text-orange-500 active:opacity-70 flex-1 border-l border-stone-100"><RotateCcw className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">Сбросить</span></button>
      <button onClick={onAddToGroup} className="flex flex-col items-center p-2 text-sky-600 active:opacity-70 flex-1 border-l border-stone-100"><FolderPlus className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">В группу</span></button>
      <button onClick={onTrain} className="flex flex-col items-center p-2 text-teal-600 active:opacity-70 flex-1 border-l border-stone-100"><PlayCircle className="w-5 h-5 mb-1 fill-teal-600/10" /> <span className="text-[10px] font-bold">Учить</span></button>
    </motion.div>
  );
}

function DeleteAccountModal({ onClose, onDelete }: any) {
   const [pwd, setPwd] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl relative z-10 text-center">
           <AlertTriangle className="w-12 h-12 text-rose-500 mx-auto mb-4" />
           <h2 className="text-xl font-bold mb-2 text-stone-800">Удаление аккаунта</h2>
           <p className="text-stone-500 text-sm mb-6">Это действие нельзя отменить. Все ваши слова, группы и прогресс будут стерты навсегда.</p>
           <input autoFocus type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Текущий пароль" className="w-full bg-stone-50 px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors text-center" />
           <div className="mt-6 flex gap-3"><button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:bg-stone-200">Отмена</button><button onClick={() => pwd && onDelete(pwd)} className="flex-1 py-4 bg-rose-500 text-white font-bold rounded-2xl active:bg-rose-600 disabled:opacity-50" disabled={!pwd}>Удалить навсегда</button></div>
        </motion.div>
      </div>
   );
}

function SmartSelectionModal({ words, onClose, onSelect }: any) {
   const [inputVal, setInputVal] = useState(String(Math.min(10, (words||[]).length)));

   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl relative z-10">
           <h2 className="text-xl font-bold mb-2 text-stone-800">Умный подбор</h2><p className="text-stone-500 text-sm mb-6">Слабые слова (низкий рейтинг).</p>
           <div className="bg-stone-50 p-4 rounded-2xl mb-6 border border-stone-200">
              <div className="flex justify-between text-xs font-bold text-stone-400 mb-2 uppercase"><span>Количество</span><span>Всего: {(words||[]).length}</span></div>
              <input 
                 type="number" 
                 value={inputVal} 
                 onChange={e => setInputVal(e.target.value)} 
                 onBlur={() => {
                    let val = parseInt(inputVal);
                    if (isNaN(val) || val < 1) val = 1;
                    if (val > (words||[]).length) val = (words||[]).length;
                    setInputVal(String(val));
                 }}
                 className="w-full text-2xl font-black bg-transparent outline-none text-stone-800" 
              />
           </div>
           <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:bg-stone-200">Отмена</button>
              <button onClick={() => { 
                 const count = parseInt(inputVal) || 1;
                 const sorted = [...(words||[])].sort((a, b) => getEffectiveMastery(a) - getEffectiveMastery(b)); 
                 onSelect(sorted.slice(0, count).map(w => w.id)); 
              }} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl active:bg-indigo-700 flex justify-center items-center gap-2"><Brain className="w-4 h-4"/> Выбрать</button>
           </div>
        </motion.div>
      </div>
   );
}

function GenerateWordsModal({ words, userProfile, groups, onClose, onSaveWord, onWordClick, user }: any) {
  const [tabs, setTabs] = useState<any[]>([{ id: 'generator', type: 'list', generatedWords: [] }]);
  const [activeTabId, setActiveTabId] = useState('generator');

  const [topic, setTopic] = useState('');
  const [count, setCount] = useState('10');
  const [genLevel, setGenLevel] = useState(userProfile?.level || 'Intermediate');
  const [extractedText, setExtractedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingWord, setLoadingWord] = useState<string|null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const handleFileUpload = async (e: any) => {
     const file = e.target.files[0];
     if(!file) return;
     if (file.size > 5 * 1024 * 1024) {
         alert('Файл слишком большой. Максимальный размер 5 МБ.');
         return;
     }
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
         } catch(err) { alert('Ошибка чтения PDF. Попробуйте текстовый файл.'); }
         setLoading(false);
     } else {
         const text = await file.text();
         setExtractedText(text);
     }
  };

  const handleGenerate = async () => {
     const c = parseInt(count) || 10;
     if (!topic.trim() && !extractedText.trim()) return alert('Введите тему или загрузите файл');
     setLoading(true);
     const result = await ApiClient.aiGenerateWordsList(topic, c, extractedText, genLevel);
     setTabs(prev => prev.map(t => t.id === 'generator' ? { ...t, generatedWords: result } : t));
     setLoading(false);
  };

  const handleAnalyzeWord = async (w: any) => {
     setLoadingWord(w.word);
     const newId = Date.now().toString();
     setTabs(prev => [...prev, { id: newId, type: 'word', original: (w.word || '').toLowerCase(), status: 'analyzing', wordData: {}, selectedTranslation: '', groupIds: new Set() }]);
     setActiveTabId(newId);
     
     const result = await ApiClient.aiGenerateWord((w.word || '').toLowerCase(), userProfile?.level);
     setTabs(prev => prev.map(t => t.id === newId ? { ...t, status: 'done', wordData: result, selectedTranslation: (result.translationOptions?.[0] || result.translation || w.translation || '').toLowerCase() } : t));
     setLoadingWord(null);
  };

  const updateWordTab = (id: string, data: any) => {
     setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
  };

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
     if(activeTabId === id) setActiveTabId('generator');
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
        
        {/* Панель вкладок */}
        <div className="flex overflow-x-auto gap-2 pb-2 mb-4 hide-scrollbar border-b border-stone-100">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-t-xl text-sm font-bold shrink-0 cursor-pointer transition-all border-b-2 ${activeTabId === t.id ? 'bg-purple-50 text-purple-700 border-purple-500' : 'bg-transparent text-stone-400 border-transparent hover:bg-stone-50'}`}>
                  {t.id === 'generator' ? <Sparkles className="w-4 h-4"/> : (t.wordData?.original || t.original || 'Новое слово').toLowerCase()}
                  {t.id !== 'generator' && <button onClick={(e) => handleCloseTab(t.id, e)} className="p-0.5 rounded-full hover:bg-stone-200/50"><X className="w-3 h-3"/></button>}
               </div>
           ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
          {/* TAB: GENERATOR LIST */}
          {activeTab.type === 'list' && (
             <div className="space-y-4">
                {(activeTab.generatedWords || []).length === 0 ? (
                   <>
                      <div className="space-y-2">
                          <label className="text-[10px] font-bold text-stone-400 uppercase">Сложность слов</label>
                          <div className="flex overflow-x-auto gap-2 pb-2 hide-scrollbar">
                             {LEVELS.map(l => (
                                <button key={l} onClick={() => setGenLevel(l)} className={`px-4 py-2 rounded-xl text-sm font-bold shrink-0 border transition-all ${genLevel === l ? 'bg-purple-500 text-white border-purple-500 shadow-sm' : 'bg-white text-stone-500 border-stone-200'}`}>{l}</button>
                             ))}
                          </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                         <div className="col-span-2 space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Тема (или пусто для PDF)</label><input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Напр. Путешествия" className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-purple-500 font-bold" /></div>
                         <div className="col-span-1 space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Слов</label><input type="number" min="1" max="50" value={count} onChange={e => setCount(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-purple-500 font-bold" /></div>
                      </div>
                      
                      <div className="space-y-1 mt-2">
                         <label className="text-[10px] font-bold text-stone-400 uppercase block">Или извлечь из файла (PDF/TXT, до 5 МБ, 5 стр.)</label>
                         <label className="w-full flex items-center justify-center gap-2 bg-purple-50 text-purple-700 border border-purple-200 border-dashed py-4 rounded-2xl cursor-pointer active:scale-95 transition-transform font-bold text-sm">
                            <UploadCloud className="w-5 h-5"/> {fileName || 'Выбрать файл'}
                            <input type="file" accept=".pdf,.txt" className="hidden" onChange={handleFileUpload} />
                         </label>
                      </div>
                      <button onClick={handleGenerate} disabled={loading} className="w-full py-5 mt-4 bg-purple-600 text-white font-bold rounded-[2rem] active:scale-95 transition-transform disabled:opacity-50 flex justify-center items-center gap-2">
                         {loading ? <><Loader2 className="w-5 h-5 animate-spin"/> Обработка ИИ...</> : <><Wand2 className="w-5 h-5"/> Сгенерировать слова</>}
                      </button>
                   </>
                ) : (
                   <div>
                      <div className="flex justify-between items-center mb-4">
                         <h3 className="font-bold text-stone-800">Сгенерировано: {(activeTab.generatedWords || []).length} слов</h3>
                         <button onClick={()=>updateTab('generator', {generatedWords: []})} className="text-xs font-bold text-stone-400">Сбросить</button>
                      </div>
                      <div className="space-y-2">
                         {(activeTab.generatedWords || []).map((w:any, i:number) => {
                            const cleanWWord = (w.word || '').toLowerCase();
                            const alreadyInTabs = tabs.some(t => t.id !== 'generator' && (t.wordData?.original || t.original || '').toLowerCase() === cleanWWord);
                            const existingInDict = (words||[]).find((x:any) => (x.original || '').toLowerCase() === cleanWWord);
                            return (
                               <div key={i} className="flex items-center justify-between bg-white p-4 rounded-2xl border border-stone-200 shadow-sm">
                                  <div><span className="font-bold text-stone-800 text-lg">{cleanWWord}</span><div className="text-sm text-stone-500">{(w.translation || '').toLowerCase()}</div></div>
                                  {existingInDict ? (
                                     <button onClick={() => onWordClick(existingInDict.id)} className="px-3 py-1.5 bg-stone-100 text-stone-600 rounded-xl text-xs font-bold">В словаре</button>
                                  ) : (
                                     <button onClick={()=>handleAnalyzeWord(w)} disabled={alreadyInTabs || loadingWord === w.word} className="w-10 h-10 flex shrink-0 items-center justify-center bg-purple-50 text-purple-600 rounded-full active:scale-90 disabled:opacity-50">
                                        {loadingWord === w.word ? <Loader2 className="w-5 h-5 animate-spin"/> : alreadyInTabs ? <Check className="w-5 h-5"/> : <Plus className="w-5 h-5"/>}
                                     </button>
                                  )}
                               </div>
                            )
                         })}
                      </div>
                   </div>
                )}
             </div>
          )}

          {/* TAB: WORD CARD */}
          {activeTab.type === 'word' && (
             <>
                {activeTab.status === 'analyzing' && <div className="py-12 flex flex-col items-center justify-center text-stone-500"><Loader2 className="w-8 h-8 animate-spin text-purple-600 mb-2" /> Изучаем контекст (или ищем в кэше)...</div>}
                {activeTab.status === 'done' && (
                  <div className="space-y-4">
                     <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                        <div className="flex items-center justify-center gap-2 mb-6">
                           <h3 className="text-3xl font-black text-stone-800">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                           {activeTab.wordData?.partOfSpeech && <span className="bg-stone-200 text-stone-600 font-bold px-2 py-1 rounded-lg text-xs uppercase">{activeTab.wordData.partOfSpeech}</span>}
                        </div>
                        <div className="space-y-5">
                            <div>
                               <div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-2">Выберите перевод</div>
                               <div className="flex flex-wrap justify-center gap-2 mb-2">
                                  {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                                     <button key={i} onClick={()=>updateWordTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-purple-500 text-white border-purple-500 shadow-sm' : 'bg-white text-stone-600 border-stone-200'}`}>{(opt || '').toLowerCase()}</button>
                                  ))}
                               </div>
                            </div>
                            <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-1">Cambridge Dictionary</div><div className="text-stone-600 text-center text-sm leading-relaxed">{activeTab.wordData?.cambridgeTranslation}</div></div>
                            <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-2">Транскрипция</div><div className="flex justify-center gap-4 text-sm font-medium text-stone-500"><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                        </div>
                        {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className="mt-6 p-5 bg-purple-50 border border-purple-100 rounded-2xl text-center"><div className="text-[10px] font-bold text-purple-600/70 uppercase mb-2">Пример ИИ</div><div className="font-medium text-purple-900 mb-2 text-lg">"{ex.text}"</div><div className="text-sm text-purple-700/80">{ex.translation}</div></div>)}
                     </div>
                     {(groups || []).length > 0 && <div className="px-2 pt-2"><h3 className="text-sm font-bold text-stone-400 mb-3">Добавить в группы:</h3><div className="flex flex-wrap gap-2">{(groups || []).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateWordTab(activeTabId, { groupIds: s }); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-stone-200 text-stone-500'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>}
                     <button onClick={handleSaveTab} className="w-full py-5 mt-4 bg-stone-900 text-white font-bold rounded-[2rem] active:scale-95 transition-transform">Сохранить и закрыть вкладку</button>
                  </div>
                )}
             </>
          )}

        </div>
      </motion.div>
    </div>
  );
}

function AddWordModal({ words, userProfile, groups, onClose, onSaveWord, onWordClick, user }: any) {
  const [tabs, setTabs] = useState<any[]>([{ id: Date.now().toString(), original: '', status: 'idle', wordData: {}, selectedTranslation: '', groupIds: new Set() }]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  const updateTab = (id: string, data: any) => {
     setTabs(prev => prev.map(t => t.id === id ? { ...t, ...data } : t));
  };

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
     const wToSave = { 
        original: (activeTab.wordData?.original || activeTab.original || '').toLowerCase(), 
        ...activeTab.wordData, 
        translation: (activeTab.selectedTranslation || '').toLowerCase(), 
        groupIds: Array.from(activeTab.groupIds || []) 
     };
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
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
        
        {/* Панель вкладок */}
        <div className="flex overflow-x-auto gap-2 pb-2 mb-4 hide-scrollbar border-b border-stone-100">
           {tabs.map((t) => (
               <div key={t.id} onClick={() => setActiveTabId(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-t-xl text-sm font-bold shrink-0 cursor-pointer transition-all border-b-2 ${activeTabId === t.id ? 'bg-teal-50 text-teal-700 border-teal-500' : 'bg-transparent text-stone-400 border-transparent hover:bg-stone-50'}`}>
                  {(t.wordData?.original || t.original || 'Новое слово').toLowerCase()}
                  {tabs.length > 1 && <button onClick={(e) => handleCloseTab(e, t.id)} className="p-0.5 rounded-full hover:bg-stone-200/50"><X className="w-3 h-3"/></button>}
               </div>
           ))}
           <button onClick={() => { const newId = Date.now().toString(); setTabs([...tabs, { id: newId, original: '', status: 'idle', wordData: {}, selectedTranslation: '', groupIds: new Set() }]); setActiveTabId(newId); }} className="px-3 py-2 text-stone-400 hover:text-stone-600"><Plus className="w-4 h-4"/></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
          {activeTab.status === 'idle' && (
             <>
                <input autoFocus placeholder="Введите слово..." value={(activeTab.original || '').toLowerCase()} onChange={e => updateTab(activeTabId, { original: (e.target.value || '').toLowerCase() })} className="w-full bg-stone-50 px-6 py-5 rounded-[2rem] text-lg font-bold border border-stone-200 outline-none focus:border-teal-500" />
                <button onClick={handleAnalyze} disabled={!(activeTab.original || '').trim()} className="w-full py-5 bg-teal-600 text-white font-bold rounded-[2rem] active:scale-95 transition-transform disabled:opacity-50">Найти перевод</button>
             </>
          )}
          {activeTab.status === 'analyzing' && <div className="py-12 flex flex-col items-center justify-center text-stone-500"><Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-2" /> Изучаем контекст (или ищем в кэше)...</div>}
          
          {activeTab.status === 'done' && (
            <div className="space-y-4">
               <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                  <div className="flex items-center justify-center gap-2 mb-6">
                     <h3 className="text-3xl font-black text-stone-800">{(activeTab.wordData?.original || activeTab.original || '').toLowerCase()}</h3>
                     {activeTab.wordData?.partOfSpeech && <span className="bg-stone-200 text-stone-600 font-bold px-2 py-1 rounded-lg text-xs uppercase">{activeTab.wordData.partOfSpeech}</span>}
                  </div>
                  <div className="space-y-5">
                      <div>
                         <div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-2">Выберите перевод</div>
                         <div className="flex flex-wrap justify-center gap-2 mb-2">
                            {(activeTab.wordData?.translationOptions || []).map((opt:string, i:number) => (
                               <button key={i} onClick={()=>updateTab(activeTabId, { selectedTranslation: (opt || '').toLowerCase() })} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-all ${(activeTab.selectedTranslation || '').toLowerCase() === (opt || '').toLowerCase() ? 'bg-teal-500 text-white border-teal-500 shadow-sm' : 'bg-white text-stone-600 border-stone-200'}`}>{(opt || '').toLowerCase()}</button>
                            ))}
                         </div>
                      </div>
                      <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-1">Cambridge Dictionary</div><div className="text-stone-600 text-center text-sm leading-relaxed">{activeTab.wordData?.cambridgeTranslation}</div></div>
                      <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-2">Транскрипция</div><div className="flex justify-center gap-4 text-sm font-medium text-stone-500"><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">UK: [{activeTab.wordData?.transcriptionUK}]</span><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">US: [{activeTab.wordData?.transcriptionUS}]</span></div></div>
                  </div>
                  {(activeTab.wordData?.examples || []).map((ex:any, i:number) => <div key={i} className="mt-6 p-5 bg-teal-50 border border-teal-100 rounded-2xl text-center"><div className="text-[10px] font-bold text-teal-600/70 uppercase mb-2">Пример ИИ</div><div className="font-medium text-teal-900 mb-2 text-lg">"{ex.text}"</div><div className="text-sm text-teal-700/80">{ex.translation}</div></div>)}
                  
                  {relatedList.length > 0 && (
                     <div className="mt-6 pt-4 border-t border-stone-200/50 text-center">
                        <div className="text-[10px] font-bold text-stone-400 uppercase mb-3">Однокоренные слова (открыть вкладку)</div>
                        <div className="space-y-2">
                           {relatedList.map((rw:any, i:number) => {
                              const cleanRW = (rw.word || '').toLowerCase();
                              const alreadyInTabs = tabs.some(t => (t.wordData?.original || t.original || '').toLowerCase() === cleanRW);
                              return (
                                 <div key={i} className="flex items-center justify-between bg-white p-3 rounded-xl border border-stone-200 shadow-sm">
                                    <div className="text-left"><span className="font-bold text-stone-800">{cleanRW}</span> <span className="text-[10px] text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded ml-1 uppercase">{rw.partOfSpeech}</span><div className="text-xs text-stone-500 mt-1">{(rw.translation || '').toLowerCase()}</div></div>
                                    <button onClick={()=>handleAddRelated(rw)} disabled={alreadyInTabs} className="w-8 h-8 flex shrink-0 items-center justify-center bg-teal-50 text-teal-600 rounded-full active:scale-90 disabled:opacity-50 disabled:bg-stone-100 disabled:text-stone-300">{alreadyInTabs ? <Check className="w-4 h-4"/> : <Plus className="w-5 h-5"/>}</button>
                                 </div>
                              );
                           })}
                        </div>
                     </div>
                  )}
               </div>
               {(groups || []).length > 0 && <div className="px-2 pt-2"><h3 className="text-sm font-bold text-stone-400 mb-3">Добавить в группы:</h3><div className="flex flex-wrap gap-2">{(groups || []).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(activeTab.groupIds || []); s.has(g.id) ? s.delete(g.id) : s.add(g.id); updateTab(activeTabId, { groupIds: s }); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${(activeTab.groupIds || new Set()).has(g.id) ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-stone-200 text-stone-500'}`}>{(activeTab.groupIds || new Set()).has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>}
               <button onClick={handleSaveTab} className="w-full py-5 mt-4 bg-stone-900 text-white font-bold rounded-[2rem] active:scale-95 transition-transform">Сохранить и закрыть вкладку</button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function WordEditorModal({ word, words, groups, userProfile, user, onClose, onSave, onDelete, onReset, onWordClick }: any) {
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
     const id = doc(collection(db, 'users', user.uid, 'words')).id;
     await setDoc(doc(db, 'users', user.uid, 'words', id), { ...result, id, original: cleanRW, translation: (result.translationOptions?.[0] || result.translation || rw.translation || '').toLowerCase(), createdAt: Date.now(), masteryLevel: 0, lastPracticed: Date.now() });
     setLoadingRelated(null);
     onWordClick(id); 
  };

  const relatedTabs = word.relatedWords || [];

  return (
     <div className="fixed inset-0 z-[100] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
           
           {/* ВКЛАДКИ (Формы слова) */}
           {relatedTabs.length > 0 && (
              <div className="flex overflow-x-auto gap-2 pb-2 mb-4 hide-scrollbar border-b border-stone-100">
                  <button className="px-4 py-2 bg-teal-600 text-white rounded-xl text-sm font-bold shrink-0 shadow-sm">{(word.original || '').toLowerCase()}</button>
                  {relatedTabs.map((rw: any, i: number) => {
                      const cleanRW = (rw.word || '').toLowerCase();
                      const existing = (words||[]).find((w:any) => (w.original || '').toLowerCase() === cleanRW);
                      if (existing) {
                           return <button key={i} onClick={() => onWordClick(existing.id)} className="px-4 py-2 bg-stone-100 text-stone-600 rounded-xl text-sm font-bold shrink-0 active:scale-95 transition-transform">{cleanRW}</button>
                      } else {
                           return <button key={i} onClick={() => handleAddRelated(rw)} disabled={loadingRelated === cleanRW} className="px-4 py-2 bg-white border border-stone-200 border-dashed text-stone-400 rounded-xl text-sm font-bold shrink-0 flex items-center gap-1 active:scale-95 transition-transform disabled:opacity-50">{loadingRelated === cleanRW ? <Loader2 className="w-3 h-3 animate-spin"/> : <Plus className="w-3 h-3"/>} {cleanRW}</button>
                      }
                  })}
              </div>
           )}

           <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2"><Edit3 className="w-5 h-5 text-teal-600"/> Редактор</h2>
              <div className="flex items-center gap-2">
                 <button onClick={()=>{ onReset(); onClose(); }} className="p-2 bg-orange-50 text-orange-500 rounded-full active:scale-90 transition-transform"><RotateCcw className="w-5 h-5" /></button>
                 <button onClick={onDelete} className="p-2 bg-rose-50 text-rose-500 rounded-full mr-2 active:scale-90 transition-transform"><Trash2 className="w-5 h-5" /></button>
                 <button onClick={onClose} className="p-2 bg-stone-100 rounded-full active:scale-90 transition-transform"><X className="w-5 h-5 text-stone-500" /></button>
              </div>
           </div>
           
           <div className="flex-1 overflow-y-auto space-y-4 pb-6 hide-scrollbar">
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Слово (англ)</label><input value={(original || '').toLowerCase()} onChange={e => setOriginal((e.target.value || '').toLowerCase())} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 font-bold" /></div>
              <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">UK Транскрипция</label><input value={transcriptionUK} onChange={e => setTranscriptionUK(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500" /></div>
                  <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">US Транскрипция</label><input value={transcriptionUS} onChange={e => setTranscriptionUS(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500" /></div>
              </div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Перевод</label><input value={(translation || '').toLowerCase()} onChange={e => setTranslation((e.target.value || '').toLowerCase())} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 font-bold text-teal-700" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Cambridge Dictionary</label><textarea value={cambridgeTranslation} onChange={e => setCambridgeTranslation(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 text-sm min-h-[60px]" /></div>
              <div className="space-y-1">
                 <div className="flex justify-between items-center"><label className="text-[10px] font-bold text-stone-400 uppercase">Пример ИИ</label><button onClick={handleRegenerateExample} disabled={isRegenerating} className="text-[10px] font-bold text-teal-600 flex items-center gap-1 active:scale-95"><RefreshCw className={`w-3 h-3 ${isRegenerating?'animate-spin':''}`}/> Сменить</button></div>
                 <textarea value={exampleText} onChange={e => setExampleText(e.target.value)} className="w-full bg-teal-50 px-4 py-3 rounded-2xl border border-teal-100 outline-none focus:border-teal-500 text-sm min-h-[60px]" />
              </div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Перевод примера</label><textarea value={exampleTranslation} onChange={e => setExampleTranslation(e.target.value)} className="w-full bg-teal-50/50 px-4 py-3 rounded-2xl border border-teal-100/50 outline-none focus:border-teal-500 text-sm min-h-[60px]" /></div>
              <div className="pt-4 border-t border-stone-100 mt-4"><label className="text-[10px] font-bold text-stone-400 uppercase mb-3 block">Группы</label><div className="flex flex-wrap gap-2 mb-4">{(groups||[]).map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(groupIds); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setGroupIds(s); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${(groupIds||new Set()).has(g.id) ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-stone-200 text-stone-500'}`}>{(groupIds||new Set()).has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>
           </div>
           <button onClick={handleSave} className="w-full py-5 bg-teal-600 text-white font-bold rounded-[2rem] active:scale-95 transition-colors text-lg shrink-0">Сохранить</button>
        </motion.div>
     </div>
  );
}

function AddGroupModal({ onClose, onSave }: any) {
   const [name, setName] = useState('');
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl relative z-10">
           <h2 className="text-xl font-bold mb-4 text-stone-800">Новая группа</h2>
           <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Название группы" className="w-full bg-stone-50 px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors" />
           <div className="mt-6 flex gap-3"><button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:bg-stone-200">Отмена</button><button onClick={() => name && onSave(name)} className="flex-1 py-4 bg-teal-600 text-white font-bold rounded-2xl active:bg-teal-700 disabled:opacity-50" disabled={!name}>Создать</button></div>
        </motion.div>
      </div>
   );
}

function BulkAddGroupModal({ groups, onClose, onSave, onOpenAddGroup }: any) {
   return (
      <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 pb-12 shadow-2xl relative z-10">
           <div className="flex justify-between items-center mb-4"><h2 className="text-xl font-bold text-stone-800">Добавить в группу</h2><button onClick={onClose} className="p-2 bg-stone-100 text-stone-500 rounded-full"><X className="w-5 h-5"/></button></div>
           <button onClick={onOpenAddGroup} className="w-full mb-4 py-4 bg-teal-50 text-teal-700 font-bold rounded-2xl border border-teal-100 flex justify-center items-center gap-2 active:bg-teal-100"><Plus className="w-5 h-5"/> Создать новую группу</button>
           <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {(groups||[]).map((g: Group) => <button key={g.id} onClick={() => onSave(g.id)} className="w-full text-left p-4 bg-stone-50 rounded-2xl font-medium active:bg-stone-100 flex items-center justify-between text-stone-800">{g.name} <Plus className="w-5 h-5 text-teal-600"/></button>)}
           </div>
        </motion.div>
      </div>
   );
}

function GroupView({ group, words, onClose, onDeleteGroup, onRemoveFromGroup, selectedWordIds, setSelectedWordIds, onTrain, onWordClick }: any) {
   return (
      <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="absolute inset-0 z-20 bg-[#F7F7F5] flex flex-col pb-24 top-0 pt-12 md:pt-8">
         <div className="flex items-center px-4 md:px-8 pb-4 border-b border-stone-200/50 sticky top-0 z-10 bg-[#F7F7F5]/80 backdrop-blur-xl">
            <button onClick={onClose} className="p-2 -ml-2 text-stone-500 active:bg-stone-200 rounded-full"><ArrowLeft className="w-6 h-6" /></button>
            <div className="flex-1 ml-2"><h2 className="text-xl font-bold text-stone-800">{group.name}</h2><p className="text-stone-500 text-sm">{(words||[]).length} элементов</p></div>
            <button onClick={onDeleteGroup} className="p-2 bg-rose-50 text-rose-500 rounded-full"><Trash2 className="w-5 h-5"/></button>
         </div>
         <div className="p-4 md:p-8 space-y-3 overflow-auto flex-1 pb-32 md:pb-8">
            {(words||[]).length > 0 && <div className="flex justify-between items-center px-1 mb-2"><button onClick={() => { const groupWordIds = (words||[]).map((w: Word) => w.id); const allSelected = groupWordIds.every((id: string) => selectedWordIds.has(id)); const newSet = new Set(selectedWordIds); if (allSelected) { groupWordIds.forEach((id: string) => newSet.delete(id)); } else { groupWordIds.forEach((id: string) => newSet.add(id)); } setSelectedWordIds(newSet); }} className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"><CheckCircle2 className="w-4 h-4"/> Выбрать все в группе</button></div>}
            {(words||[]).length === 0 ? <div className="text-center text-stone-400 p-8">В этой группе пока нет слов.</div> : (words||[]).map((word: Word) => (
                  <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                     <button onClick={() => { const newSet = new Set(selectedWordIds); newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id); setSelectedWordIds(newSet); }} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}>{selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}</button>
                     <div className="flex-1 cursor-pointer" onClick={() => onWordClick(word.id)}>
                        <div className="flex items-center gap-2"><h3 className="text-lg font-bold text-stone-800">{(word.original || '').toLowerCase()}</h3> {word.partOfSpeech && <span className="text-[10px] font-bold text-stone-400 uppercase bg-stone-100 px-2 py-0.5 rounded-md">{word.partOfSpeech}</span>}</div>
                        <p className="text-stone-500 text-sm mt-0.5 line-clamp-1">{(word.translation || '').toLowerCase()}</p><MasteryBar masteryLevel={getEffectiveMastery(word)} />
                     </div>
                     <button onClick={() => onRemoveFromGroup(word.id)} className="p-2 text-stone-400 hover:text-rose-500 bg-stone-50 rounded-full shrink-0"><X className="w-5 h-5"/></button>
                  </div>
            ))}
         </div>
         <AnimatePresence>
            {selectedWordIds.size > 0 && (words||[]).some((w: Word) => selectedWordIds.has(w.id)) && (
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-30 border border-stone-200/50 w-[90%] max-w-sm">
                  <button onClick={() => { (words||[]).forEach((w: Word) => { if (selectedWordIds.has(w.id)) onRemoveFromGroup(w.id); }); const newSet = new Set(selectedWordIds); (words||[]).forEach((w: Word) => newSet.delete(w.id)); setSelectedWordIds(newSet); }} className="flex flex-col items-center p-2 text-orange-400 active:opacity-70 flex-1"><Trash2 className="w-5 h-5 mb-1" /><span className="text-[10px] font-bold">Убрать из группы</span></button>
                  <button onClick={onTrain} className="flex flex-col items-center p-2 text-teal-600 active:opacity-70 border-l border-stone-100 flex-1"><PlayCircle className="w-5 h-5 mb-1 fill-teal-600/10" /><span className="text-[10px] font-bold">Учить ({selectedWordIds.size})</span></button>
               </motion.div>
            )}
         </AnimatePresence>
      </motion.div>
   );
}

// --- ТРЕНИРОВКИ ---
function SessionStats({ stats, onClose }: any) {
   const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
   return <div className="w-full text-center flex flex-col items-center"><div className="bg-white rounded-[2rem] p-10 w-full shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 mb-8"><div className="text-6xl font-black text-teal-600 mb-2">{accuracy}%</div><div className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Точность</div><div className="flex justify-around text-lg font-bold"><div className="flex flex-col"><span className="text-teal-500 text-2xl">{stats.correct}</span><span className="text-stone-400 text-xs uppercase">Верно</span></div><div className="flex flex-col"><span className="text-orange-400 text-2xl">{stats.total - stats.correct}</span><span className="text-stone-400 text-xs uppercase">Ошибок</span></div></div></div><button onClick={onClose} className="px-12 py-4 bg-teal-600 text-white font-bold rounded-[2rem] shadow-[0_8px_20px_rgb(13,148,136,0.3)] active:scale-95">Закрыть</button></div>;
}

function useTrainingQueue(initialWords: Word[]) {
   const [queue, setQueue] = useState<Word[]>([]);
   const [idx, setIdx] = useState(0);

   useEffect(() => {
      if ((initialWords||[]).length > 0 && queue.length === 0) {
         setQueue(initialWords); setIdx(0);
      }
   }, [(initialWords||[]).length]); 
   
   const handleNext = useCallback((word: Word, isCorrect: boolean) => {
      setQueue(prev => {
         const newQueue = [...prev];
         if (!isCorrect) newQueue.push(word);
         return newQueue;
      });
      setIdx(c => c + 1);
   }, []);
   
   const isFinished = queue.length > 0 && idx >= queue.length;
   return { word: queue[idx], handleNext, isFinished, queueLength: queue.length, currentNum: idx + 1 };
}

function ModeConstructor({ words, onProgress, onFinish }: any) {
   const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
   const [letters, setLetters] = useState<{id:number, char:string}[]>([]);
   const [answer, setAnswer] = useState<{id:number, char:string}[]>([]);
   const [errorsCount, setErrorsCount] = useState(0);

   useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
   useEffect(() => {
      if(!word) return;
      const chars = (word.original || '').split('').map((char:string, i:number) => ({ id: i, char: (char || '').toLowerCase() }));
      setLetters(chars.sort(() => Math.random() - 0.5));
      setAnswer([]); setErrorsCount(0);
   }, [word, currentNum]);

   const processInput = useCallback((char: string, availableLetter?: {id:number, char:string}) => {
      if(!word) return;
      const correctNextChar = ((word.original || '')[answer.length] || '').toLowerCase();
      if ((char || '').toLowerCase() !== correctNextChar) {
         onProgress(word.id, false);
         const newErrors = errorsCount + 1;
         setErrorsCount(newErrors);
         if (newErrors >= 3) {
            setAnswer((word.original || '').toLowerCase().split('').map((c:string,i:number)=>({id:i,char:c})));
            setLetters([]);
            setTimeout(() => handleNext(word, false), 2000);
         }
         return;
      }
      if (availableLetter) {
         setLetters(prev => prev.filter(l => l.id !== availableLetter.id));
         const newAns = [...answer, availableLetter];
         setAnswer(newAns);
         if (newAns.length === (word.original || '').length) {
            onProgress(word.id, true);
            setTimeout(() => handleNext(word, true), 1000);
         }
      }
   }, [answer, word, errorsCount, handleNext, onProgress]);

   const handleKeyDown = useCallback((e: KeyboardEvent) => {
      if(errorsCount >= 3 || !word || answer.length === (word.original || '').length) return;
      const char = (e.key || '').toLowerCase();
      const availableLetter = letters.find(l => (l.char || '').toLowerCase() === char);
      if(availableLetter || /^[a-z]$/i.test(char)) processInput(char, availableLetter);
   }, [letters, answer, word, errorsCount, processInput]);

   useEffect(() => { window.addEventListener('keydown', handleKeyDown); return () => window.removeEventListener('keydown', handleKeyDown); }, [handleKeyDown]);

   if (!word) return null;

   return (
      <div className="w-full flex flex-col items-center">
         <span className="text-stone-400 font-bold mb-4">{currentNum} / {queueLength}</span>
         {errorsCount > 0 && <span className="text-rose-500 font-bold mb-4 animate-pulse">Ошибок: {errorsCount}/3</span>}
         <div className="text-xl font-bold text-stone-500 mb-8 text-center">{(word.translation || '').toLowerCase()}</div>
         <div className={`flex flex-wrap justify-center gap-2 mb-12 min-h-[60px] p-4 rounded-3xl w-full ${errorsCount >= 3 ? 'bg-rose-50 border-rose-200 border' : answer.length === (word.original || '').length ? 'bg-teal-50 border-teal-200 border' : 'bg-white border-2 border-dashed border-stone-200'}`}>
            {answer.map((a,i) => <motion.div layoutId={`char-${a.id}-${i}`} key={i} className={`w-10 h-12 flex items-center justify-center font-bold text-xl rounded-xl text-white ${errorsCount >= 3 ? 'bg-rose-400' : answer.length === (word.original || '').length ? 'bg-teal-500' : 'bg-stone-800'}`}>{a.char}</motion.div>)}
         </div>
         <div className="flex flex-wrap justify-center gap-2">
            {letters.map(l => <motion.div layoutId={`char-${l.id}`} key={l.id} onClick={() => { if(errorsCount<3) processInput(l.char, l); }} className="w-12 h-14 bg-white border border-stone-200 shadow-sm flex items-center justify-center font-bold text-xl rounded-xl text-stone-800 cursor-pointer active:scale-90">{l.char}</motion.div>)}
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
      const distsData = await ApiClient.aiGenerateBatchDistractors(words || []);
      const formatted = (words||[]).map((w: any) => {
         const item = distsData.find((d:any) => d.id === w.id);
         const dists = item && item.distractors && item.distractors.length >= 3 ? item.distractors.slice(0,3) : ['неверно 1', 'неверно 2', 'неверно 3'];
         return { ...w, options: [...dists, (w.translation || '').toLowerCase()].sort(() => Math.random() - 0.5) };
      });
      setQuizData(formatted); setPhase('ready');
    };
    fetchBatch();
  }, [words, isPreloaded]);

  useEffect(() => { if (isFinished && phase === 'playing') onFinish(); }, [isFinished, phase, onFinish]);

  if (phase === 'loading') return <div className="flex flex-col items-center justify-center p-8 h-64"><Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-4"/><p className="text-stone-500 font-bold text-center">ИИ подготавливает хитрые<br/>варианты ответов...</p></div>;
  if (phase === 'ready') return (
     <div className="flex flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-teal-500 mb-6" />
        <h2 className="text-2xl font-black text-stone-800 mb-2">Викторина готова!</h2>
        <button onClick={() => setPhase('playing')} className="w-full bg-teal-600 text-white font-bold py-5 rounded-[2rem] active:scale-95 transition-transform shadow-[0_8px_20px_rgb(13,148,136,0.3)] mt-8">Начать</button>
     </div>
  );

  if (!word) return null;
  return (
    <div className="w-full max-w-sm flex flex-col">
       <span className="text-stone-400 font-medium text-center mb-8">{currentNum} / {queueLength}</span>
       <div className="bg-white rounded-[2rem] p-8 text-center mb-8 border border-stone-100 shadow-sm"><h2 className="text-3xl font-black text-stone-800">{(word.original || '').toLowerCase()}</h2></div>
       <div className="space-y-3">
          {(word.options||[]).map((opt: string, i: number) => {
             let stateClass = "bg-white text-stone-800 border-stone-200";
             const cleanOpt = (opt || '').toLowerCase();
             const cleanTranslation = (word.translation || '').toLowerCase();
             if (ansIdx !== null) { if (cleanOpt === cleanTranslation) stateClass = "bg-teal-500 text-white border-transparent"; else if (i === ansIdx) stateClass = "bg-orange-400 text-white border-transparent"; else stateClass = "bg-white/50 text-stone-400 opacity-50"; }
             return <button key={i} onClick={() => { if(ansIdx===null) { setAnsIdx(i); const isCorrect = cleanOpt === cleanTranslation; onProgress(word.id, isCorrect); setTimeout(() => { handleNext(word, isCorrect); setAnsIdx(null); }, 1500) } }} className={`w-full p-5 rounded-2xl border font-bold text-lg active:scale-[0.98] transition-all shadow-sm ${stateClass}`}>{cleanOpt}</button>;
          })}
       </div>
    </div>
  );
}

function ModeFlashcards({ words, onProgress, onFinish }: any) {
  const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
  const [isFlipped, setIsFlipped] = useState(false);
  
  useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
  
  if (!word) return null;
  return (
    <div className="w-full flex flex-col items-center">
      <span className="text-stone-400 font-bold mb-8">{currentNum} / {queueLength}</span>
      <div className="w-full h-96 relative cursor-pointer perspective-1000" onClick={() => setIsFlipped(!isFlipped)}>
         <motion.div animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 100, damping: 20 }} className="w-full h-full relative [transform-style:preserve-3d]">
            <div className="absolute inset-0 [backface-visibility:hidden] bg-white rounded-[2rem] shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 flex flex-col items-center justify-center p-8 text-center"><h2 className="text-4xl font-black text-stone-800">{(word.original || '').toLowerCase()}</h2><div className="text-stone-400 mt-4 font-medium">[{word.transcriptionUK}]</div></div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-teal-600 rounded-[2rem] shadow-[0_10px_40px_rgb(13,148,136,0.2)] flex flex-col items-center justify-center p-8 text-center text-white"><h2 className="text-3xl font-bold mb-2">{(word.translation || '').toLowerCase()}</h2><p className="text-teal-100/80 text-sm mb-4">{word.cambridgeTranslation}</p>{word.examples?.[0] && <p className="italic text-teal-50 bg-black/10 p-3 rounded-xl text-sm">"{word.examples[0].text}"</p>}</div>
         </motion.div>
      </div>
      <div className="mt-12 w-full flex gap-4"><button onClick={() => { onProgress(word.id, false); setIsFlipped(false); setTimeout(()=>handleNext(word, false), 250); }} className="flex-1 py-5 bg-orange-50 text-orange-500 font-bold rounded-2xl active:scale-95 transition-transform">Не помню</button><button onClick={() => { onProgress(word.id, true); setIsFlipped(false); setTimeout(()=>handleNext(word, true), 250); }} className="flex-1 py-5 bg-teal-50 text-teal-600 font-bold rounded-2xl active:scale-95 transition-transform">Вспомнил</button></div>
    </div>
  );
}

function ModeSentence({ words, onProgress, onFinish }: any) {
   const { word, handleNext, isFinished, queueLength, currentNum } = useTrainingQueue(words);
   const [input, setInput] = useState('');
   const [status, setStatus] = useState<'idle'|'checking'|'correct'|'incorrect'>('idle');
   const [fb, setFb] = useState('');

   useEffect(() => { if (isFinished) onFinish(); }, [isFinished, onFinish]);
   useEffect(() => { setInput(''); setStatus('idle'); setFb(''); }, [word, currentNum]);
 
   if (!word) return null;
   
   return (
     <div className="w-full flex flex-col h-[80vh]">
        <div className="flex-1">
          <span className="text-stone-400 font-bold text-center block mb-6">{currentNum} / {queueLength}</span>
          <div className="bg-white rounded-[2rem] p-8 mb-6 shadow-sm border border-stone-100 text-center">
             <h2 className="text-3xl font-black text-stone-800 mb-2">{(word.original || '').toLowerCase()}</h2>
             <p className="text-stone-400 font-medium">{(word.translation || '').toLowerCase()}</p>
          </div>
          <textarea 
             autoFocus 
             value={input} 
             onChange={e => { setInput(e.target.value); setStatus('idle'); }} 
             placeholder="Составьте предложение с этим словом..." 
             disabled={status === 'checking' || status === 'correct'} 
             className="w-full bg-stone-50 border border-stone-200 focus:border-teal-500 text-stone-800 p-6 rounded-[2rem] min-h-[140px] outline-none font-medium resize-none" 
          />
          
          {status !== 'idle' && status !== 'checking' && (
             <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`mt-4 p-5 rounded-2xl flex gap-3 ${status === 'correct' ? 'bg-teal-50 text-teal-700' : 'bg-orange-50 text-orange-600'}`}>
                {status === 'correct' ? <CheckCircle2 className="w-6 h-6 shrink-0"/> : <XCircle className="w-6 h-6 shrink-0"/>}
                <p className="font-medium text-sm leading-relaxed">{fb}</p>
             </motion.div>
          )}
        </div>
        <div className="pb-8">
           {status === 'idle' && (
              <button onClick={async () => { 
                    setStatus('checking'); 
                    const r = await ApiClient.aiCheckSentence((word.original || ''), input); 
                    setFb(r.feedback); 
                    setStatus(r.isCorrect ? 'correct' : 'incorrect'); 
                    onProgress(word.id, r.isCorrect); 
                 }} 
                 disabled={!input} 
                 className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[2rem] flex gap-2 justify-center shadow-[0_8px_20px_rgb(79,70,229,0.2)] active:scale-95"
              >
                 <Brain className="w-5 h-5"/> Проверить ИИ
              </button>
           )}
           {status === 'checking' && (
              <div className="w-full bg-stone-100 text-stone-500 font-bold py-5 rounded-[2rem] flex justify-center">
                 <Loader2 className="animate-spin w-5 h-5" /> Анализируем...
              </div>
           )}
           {(status === 'correct' || status === 'incorrect') && (
              <button onClick={() => handleNext(word, status === 'correct')} className="w-full bg-stone-800 text-white font-bold py-5 rounded-[2rem] active:scale-95">
                 Продолжить <ArrowRight className="w-5 h-5 inline"/>
              </button>
           )}
        </div>
     </div>
   );
}

function ModeBrainstorm({ words, onProgress, onFinish }: any) {
   const [phase, setPhase] = useState<'select'|'loading'|'flashcards'|'quiz'|'constructor'|'sentence'>('select');
   const [selected, setSelected] = useState<Set<string>>(new Set());
   const [preparedWords, setPreparedWords] = useState<any[]>([]);

   const startCycle = async () => {
      if(selected.size === 0) return alert('Выберите слова');
      setPhase('loading');
      const activeWords = (words||[]).filter((w:any) => selected.has(w.id));
      const distsData = await ApiClient.aiGenerateBatchDistractors(activeWords);
      const formatted = activeWords.map((w:any) => {
         const item = distsData.find((d:any) => d.id === w.id);
         const dists = item && item.distractors ? item.distractors.slice(0,3) : ['неверно 1', 'неверно 2', 'неверно 3'];
         return { ...w, options: [...dists, (w.translation || '').toLowerCase()].sort(() => Math.random() - 0.5) };
      });
      setPreparedWords(formatted);
      setPhase('flashcards');
   };

   if (phase === 'select') return (
         <div className="w-full">
            <h2 className="text-2xl font-black text-stone-800 mb-2">Брейншторм</h2>
            <div className="flex justify-between items-center mb-6">
               <p className="text-stone-500 text-sm">Слова для усиленного цикла.</p>
               <button onClick={() => selected.size === (words||[]).length ? setSelected(new Set()) : setSelected(new Set((words||[]).map((w:any)=>w.id)))} className="text-sm font-bold text-teal-600 active:opacity-70 px-3 py-1.5 bg-teal-50 rounded-lg">{selected.size === (words||[]).length ? 'Снять все' : 'Выбрать все'}</button>
            </div>
            <div className="space-y-2 mb-8 max-h-[50vh] overflow-y-auto">{(words||[]).map((w:any) => <div key={w.id} onClick={() => { const s=new Set(selected); s.has(w.id)?s.delete(w.id):s.add(w.id); setSelected(s); }} className={`p-4 rounded-2xl flex justify-between font-bold cursor-pointer transition-colors ${selected.has(w.id) ? 'bg-purple-100 text-purple-700' : 'bg-white text-stone-700'}`}>{(w.original || '').toLowerCase()} {selected.has(w.id) && <Check className="w-5 h-5"/>}</div>)}</div>
            <button onClick={startCycle} className="w-full bg-purple-600 text-white font-bold py-5 rounded-[2rem] active:scale-95 transition-transform">Начать цикл ({selected.size})</button>
         </div>
   );
   
   if (phase === 'loading') return <div className="flex flex-col items-center justify-center p-8 h-64"><Loader2 className="w-8 h-8 animate-spin text-purple-600 mb-4"/><p className="text-stone-500 font-bold text-center">Готовим мега-тренировку...</p></div>;
   if (phase === 'flashcards') return <div className="w-full h-full flex flex-col"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs text-center">Этап 1: Карточки</h3><ModeFlashcards words={preparedWords} onProgress={()=>{}} onFinish={() => setPhase('quiz')} /></div>;
   if (phase === 'quiz') return <div className="w-full h-full flex flex-col"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs text-center">Этап 2: Викторина</h3><ModeQuiz words={preparedWords} onProgress={onProgress} onFinish={() => setPhase('constructor')} /></div>;
   if (phase === 'constructor') return <div className="w-full h-full flex flex-col"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs text-center">Этап 3: Правописание</h3><ModeConstructor words={preparedWords} onProgress={onProgress} onFinish={() => setPhase('sentence')} /></div>;
   if (phase === 'sentence') return <div className="w-full h-full flex flex-col"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs text-center">Этап 4: Практика фраз</h3><ModeSentence words={preparedWords} onProgress={onProgress} onFinish={onFinish} /></div>;
   
   return null;
}

function OnboardingModal({ user, onSave }: any) {
  const [step, setStep] = useState(0); 
  const [level, setLevel] = useState('Intermediate');
  const [goal, setGoal] = useState(15);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => { window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); setDeferredPrompt(e); }); }, []);
  
  const slides = [
    { 
       icon: <Wand2 className="w-10 h-10 text-teal-600" />, 
       title: "Академический ИИ-словарь", 
       text: "Больше никаких гугл-переводчиков. Добавьте слово, и наша нейросеть выдаст идеальный перевод, британскую и американскую транскрипции, а также развернутое объяснение в стиле Cambridge Dictionary." 
    },
    { 
       icon: <Edit3 className="w-10 h-10 text-sky-600" />, 
       title: "Полный контроль", 
       text: "Ваш словарь — это ваш личный конспект. Вы можете группировать слова, сбрасывать их прогресс или переписывать значения. А если пример от ИИ показался скучным — просто перегенерируйте его в один клик!" 
    },
    { 
       icon: <Brain className="w-10 h-10 text-purple-600" />, 
       title: "5 режимов тренировки", 
       text: "Мы создали систему, которая не даст вам забыть. Классические карточки, умная викторина, конструктор слов (где за ошибки вас штрафуют), Брейншторм для самых трудных слов и ИИ-проверка предложений." 
    },
    { 
       icon: <Calendar className="w-10 h-10 text-orange-400" />, 
       title: "Ваш прогресс", 
       text: "Секрет изучения языков — в регулярности. Установите ежедневную цель, отслеживайте свой стрик (дни подряд) и наблюдайте, как календарь заполняется вашими победами." 
    }
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" />
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{type:'spring', stiffness: 200, damping: 25}} className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-[0_20px_60px_rgb(0,0,0,0.1)] relative z-10">
        
        {step < 4 ? (
          <div className="p-8 text-center">
            <div className="w-20 h-20 mx-auto bg-stone-50 rounded-3xl flex items-center justify-center mb-6 shadow-sm">
              {slides[step].icon}
            </div>
            <h2 className="text-2xl font-black mb-4 text-stone-800">{slides[step].title}</h2>
            <p className="text-stone-500 leading-relaxed">{slides[step].text}</p>
            
            <div className="flex justify-center gap-2 mt-8">
               {[0,1,2,3].map(i => <div key={i} className={`w-2 h-2 rounded-full transition-colors ${step === i ? 'bg-teal-500' : 'bg-stone-200'}`} />)}
            </div>
          </div>
        ) : (
          <div className="p-8">
             <div className="w-16 h-16 mx-auto bg-stone-50 rounded-2xl flex items-center justify-center mb-6"><GraduationCap className="w-8 h-8 text-stone-800" /></div>
             <h2 className="text-2xl font-black mb-2 text-stone-800 text-center">Ваш уровень?</h2>
             <p className="text-stone-500 text-sm mb-6 text-center">От уровня зависит лексика и сложность примеров ИИ.</p>
             <div className="grid grid-cols-2 gap-3 mb-6">
               {LEVELS.map(l => <button key={l} onClick={() => setLevel(l)} className={`p-4 rounded-2xl border-2 font-bold text-center transition-colors text-sm ${level === l ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-stone-100 text-stone-500'}`}>{l}</button>)}
             </div>
             
             <h2 className="text-xl font-black mb-2 text-stone-800 text-center">Цель в день</h2>
             <div className="flex gap-2 mb-6">
               {[5,10,15,30].map(m => <button key={m} onClick={() => setGoal(m)} className={`flex-1 p-3 rounded-2xl border-2 font-bold text-center transition-colors text-sm ${goal === m ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-stone-100 text-stone-500'}`}>{m}</button>)}
             </div>

             {deferredPrompt && (
                 <button onClick={()=>{ deferredPrompt.prompt(); deferredPrompt.userChoice.then(()=>{ setDeferredPrompt(null); }) }} className="w-full py-4 bg-teal-50 text-teal-600 font-bold rounded-2xl flex items-center justify-center gap-2 border border-teal-100 mt-2 active:scale-95"><Download className="w-5 h-5"/> Установить на экран "Домой"</button>
             )}
          </div>
        )}

        <div className="p-6 bg-stone-50 border-t border-stone-100 flex gap-3">
          {step > 0 && <button onClick={() => setStep(s=>s-1)} className="px-6 bg-stone-200 text-stone-600 font-bold rounded-2xl active:scale-95 transition-transform">Назад</button>}
          <button onClick={() => { if (step < 4) setStep(s=>s+1); else onSave(level, goal); }} className="flex-1 bg-stone-900 text-white font-bold py-4 rounded-2xl active:scale-95 transition-transform">
            {step < 4 ? 'Понятно' : 'Начать обучение'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}