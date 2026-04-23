/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, PlayCircle, Settings, Plus, X, Search, CheckCircle2,
  XCircle, ArrowRight, Brain, Timer, Type, FlipHorizontal, Check, Loader2, BookOpen, Trash2, FolderPlus, ArrowLeft, Edit3, XOctagon
} from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// --- TYPES ---
export type Category = 'general' | 'collocation' | 'idiom';

export interface Translation {
  text: string;
  examples: string[];
}

export interface Word {
  id: string;
  original: string;
  translations: Translation[];
  category: Category;
  groupIds: string[];
  createdAt: number;
  correctAnswers: number;
  incorrectAnswers: number;
  masteryLevel: number;
}

export interface Group {
  id: string;
  name: string;
  category: Category;
}

// --- API CLIENT (NETLIFY FUNCTION) ---
class ApiClient {
  static BASE_URL = '/.netlify/functions';

  static async aiGenerateTranslations(word: string, category: Category, level?: string): Promise<Translation[]> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'translate', word, category, level })
      });
      if (!res.ok) {
         if (res.status === 404 && (window.location.hostname.includes('run.app') || window.location.hostname.includes('localhost'))) {
            return [{ text: `[ДЕМО] Перевод для "${word}"`, examples: [`(Разверните проект для реального ИИ)`] }];
         }
         throw new Error(`Ошибка API: ${res.status}`);
      }
      return await res.json();
    } catch(e: any) {
      return [{ text: `${word} (Ошибка)`, examples: [e.message] }];
    }
  }

  static async aiGenerateDistractors(word: string, correctTranslation: string): Promise<string[]> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'distractors', word, correctTranslation })
      });
      if (!res.ok) return ['Случайное слово', 'Ошибочный ответ', 'Другой вариант'];
      const data = await res.json();
      return Array.isArray(data) ? data : ['Случайное', 'Ошибочный', 'Другой'];
    } catch(e) {
      return ['Случайное слово', 'Ошибочный ответ', 'Другой вариант'];
    }
  }

  static async aiCheckSentence(word: string, sentence: string): Promise<{ isCorrect: boolean, feedback: string }> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', word, sentence })
      });
      if (!res.ok) return { isCorrect: false, feedback: 'Ошибка проверки ИИ.' };
      return await res.json();
    } catch(e) {
       return { isCorrect: false, feedback: 'Ошибка сети при проверке.' };
    }
  }
}

// --- MOCK DATA ---
const INITIAL_WORDS: Word[] = [
  {
    id: 'w1', original: 'Resilient', category: 'general', groupIds: ['g1'], createdAt: Date.now(),
    translations: [{ text: 'Устойчивый / Жизнерадостный', examples: ['He was resilient after the failure.'] }],
    correctAnswers: 2, incorrectAnswers: 0, masteryLevel: 40
  },
  {
    id: 'w2', original: 'Ubiquitous', category: 'general', groupIds: ['g1'], createdAt: Date.now(),
    translations: [{ text: 'Вездесущий', examples: ['Smartphones have become ubiquitous.'] }],
    correctAnswers: 0, incorrectAnswers: 1, masteryLevel: 0
  },
  {
    id: 'w3', original: 'Make up your mind', category: 'collocation', groupIds: [], createdAt: Date.now() - 1000,
    translations: [{ text: 'Принять решение', examples: ['Please make up your mind.'] }],
    correctAnswers: 5, incorrectAnswers: 1, masteryLevel: 80
  }
];

const INITIAL_GROUPS: Group[] = [
  { id: 'g1', name: 'Сложные слова Toefl', category: 'general' },
  { id: 'g2', name: 'Идиомы здоровья', category: 'idiom' }
];

// --- MAIN APP SHELL ---
export default function AppWrapper() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    // Проверка результата после редиректа - нужна для некоторых мобильных браузеров 
    getRedirectResult(auth).catch((error) => {
      console.error("Login redirect error:", error);
    });

    const unsubscribe = onAuthStateChanged(auth, u => setUser(u));
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Пробуем войти через всплывающее окно
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Login route error:", error);
      
      if (error.code === 'auth/unauthorized-domain') {
        alert("ОШИБКА ДОМЕНА: Ваш сайт на Netlify не добавлен в белый список Firebase! Зайдите в Firebase Console -> Authentication -> Settings -> Authorized domains и добавьте ваш адрес от Netlify.");
      } else if (error.code === 'auth/popup-blocked') {
        alert("ОШИБКА: Браузер заблокировал вплывающее окно. Пожалуйста, разрешите всплывающие окна для этого сайта.");
      } else if (error.message && error.message.includes('403')) {
        alert("ОШИБКА 403: Вы пытаетесь войти во встроенном окне (фрейме). Откройте сайт в отдельной полноэкранной вкладке.");
      } else {
        alert("ОШИБКА ВХОДА: " + (error.message || error.code || "Неизвестная ошибка. Проверьте консоль F12."));
      }
    }
  };

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-800 font-bold">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mr-2" /> Загрузка...
    </div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50">
        <BookOpen className="w-16 h-16 text-blue-500 mb-6" />
        <h1 className="text-4xl font-black mb-2 text-center text-slate-900">Words</h1>
        <p className="text-slate-500 text-center mb-10 max-w-sm">
          Изучайте слова и синхронизируйте их на всех устройствах. Для продолжения войдите в аккаунт.
        </p>
        <button 
          onClick={handleLogin} 
          className="w-full max-w-sm py-4 bg-white border border-slate-200 text-slate-800 font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform hover:bg-slate-50"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" /> 
          Войти через Google
        </button>
      </div>
    );
  }

  return <MainApp user={user} />;
}

function MainApp({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'dict' | 'groups' | 'train' | 'settings'>('dict');
  const [dictCategory, setDictCategory] = useState<Category>('general');
  const [words, setWords] = useState<Word[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userProfile, setUserProfile] = useState<{ level: string, onboarded: boolean } | null>(null);

  useEffect(() => {
    const wordsRef = collection(db, 'users', user.uid, 'words');
    const groupsRef = collection(db, 'users', user.uid, 'groups');
    const profileRef = doc(db, 'users', user.uid, 'profile', 'data');

    const unsubWords = onSnapshot(wordsRef, snap => {
       setWords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Word)));
    });
    const unsubGroups = onSnapshot(groupsRef, snap => {
       setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group)));
    });
    const unsubProfile = onSnapshot(profileRef, snap => {
       if (snap.exists()) {
          setUserProfile(snap.data() as any);
       } else {
          setUserProfile({ level: 'Beginner', onboarded: false });
       }
    });

    return () => { unsubWords(); unsubGroups(); unsubProfile(); };
  }, [user.uid]);

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  // Views & Modals
  const [showAddWord, setShowAddWord] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [viewingWordId, setViewingWordId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [showBulkAddGroup, setShowBulkAddGroup] = useState(false);

  // Training state
  const [activeTrainingMode, setActiveTrainingMode] = useState<'flashcards' | 'quiz' | 'sentence' | 'timeattack' | 'stats' | null>(null);
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });

  const currentCategoryWords = words.filter(w => w.category === dictCategory);
  const currentCategoryGroups = groups.filter(g => g.category === dictCategory);

  const getTrainingWords = () => {
    let selectedSet = new Set(selectedWordIds);
    words.forEach(w => {
      if (w.groupIds.some(id => selectedGroupIds.has(id))) selectedSet.add(w.id);
    });
    const activeList = Array.from(selectedSet).map(id => words.find(w => w.id === id)).filter(Boolean) as Word[];
    return activeList;
  };

  const deleteWords = (ids: string[]) => {
    ids.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'words', id)));
    const newSelected = new Set(selectedWordIds);
    ids.forEach(id => newSelected.delete(id));
    setSelectedWordIds(newSelected);
  };

  // Прогресс: логика пересчета
  const handleUpdateProgress = (wordId: string, isCorrect: boolean) => {
    setSessionStats(s => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    const word = words.find(w => w.id === wordId);
    if (!word) return;
    
    const correctAnswers = word.correctAnswers + (isCorrect ? 1 : 0);
    const incorrectAnswers = word.incorrectAnswers + (!isCorrect ? 1 : 0);
    
    let masteryLevel = word.masteryLevel + (isCorrect ? 20 : -10);
    if (masteryLevel > 100) masteryLevel = 100;
    if (masteryLevel < 0) masteryLevel = 0;
    
    updateDoc(doc(db, 'users', user.uid, 'words', wordId), { correctAnswers, incorrectAnswers, masteryLevel });
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 md:flex flex-row relative bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] overflow-hidden">
      
      {/* DESKTOP SIDEBAR */}
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-white/90 backdrop-blur-xl border-r border-slate-200 shadow-sm p-4 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4">
             <BookOpen className="w-8 h-8 text-blue-500" />
             <span className="text-2xl font-black">Words</span>
          </div>
          <nav className="flex-1 space-y-2">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словари" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {/* MOBILE BOTTOM NAV */}
      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-white/90 backdrop-blur-xl border-t border-slate-200 flex justify-around items-center px-2 z-40 pb-safe">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-6 h-6" />} label="Словари" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-6 h-6" />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-6 h-6" />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-6 h-6" />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      {/* MAIN CONTENT AREA */}
      <main className={`flex-1 flex flex-col h-screen overflow-y-auto ${!activeTrainingMode ? 'md:ml-64 pb-24 md:pb-0' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col">
          {/* Top Header */}
          {!activeTrainingMode && !viewingGroupId && activeTab !== 'settings' && activeTab !== 'train' && (
            <div className="sticky top-0 z-30 bg-slate-50/80 backdrop-blur-xl pt-12 md:pt-8 pb-4 px-4 md:px-8 border-b border-slate-200">
              <h1 className="text-3xl font-bold tracking-tight mb-4">
                {activeTab === 'dict' ? 'Словари' : 'Группы слов'}
              </h1>
              <div className="flex bg-slate-200/60 p-1 rounded-xl max-w-sm">
                {(['general', 'collocation', 'idiom'] as Category[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => { setDictCategory(cat); setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all ${dictCategory === cat ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {cat === 'general' ? 'Слова' : cat === 'collocation' ? 'Устойчивые выражения' : 'Идиомы'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* VIEWS */}
          <AnimatePresence mode="wait">
            {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
              <motion.div key="dict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-4 md:p-8 space-y-3 pb-32">
            {currentCategoryWords.length > 0 && (
              <div className="flex justify-between items-center px-1 mb-2">
                <button 
                  onClick={() => {
                    if (selectedWordIds.size === currentCategoryWords.length) setSelectedWordIds(new Set());
                    else setSelectedWordIds(new Set(currentCategoryWords.map(w => w.id)));
                  }} 
                  className="text-sm font-bold text-blue-500 flex items-center gap-1 active:opacity-70"
                >
                  <CheckCircle2 className="w-4 h-4"/> 
                  {selectedWordIds.size === currentCategoryWords.length ? 'Снять выделение' : 'Выбрать все'}
                </button>
              </div>
            )}
            {currentCategoryWords.length === 0 ? (
              <div className="text-center text-slate-400 py-12">Нет добавленных слов. Нажмите +, чтобы добавить.</div>
            ) : (
              currentCategoryWords.map(word => (
                <div key={word.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition-transform">
                   <button 
                     onClick={() => {
                        const newSet = new Set(selectedWordIds);
                        newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id);
                        setSelectedWordIds(newSet);
                     }}
                     className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}
                   >
                     {selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}
                   </button>
                   <div className="flex-1 cursor-pointer" onClick={() => setViewingWordId(word.id)}>
                     <h3 className="text-lg font-bold">{word.original}</h3>
                     <p className="text-slate-500 text-sm mt-0.5 line-clamp-1">{word.translations[0]?.text}</p>
                     {/* ИНДИКАТОР ПРОГРЕССА В СПИСКЕ */}
                     <MasteryBar masteryLevel={word.masteryLevel} />
                   </div>
                </div>
              ))
            )}

            <button onClick={() => setShowAddWord(true)} className="fixed bottom-24 right-5 w-14 h-14 bg-blue-500 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-blue-600 active:scale-90 transition-all z-20">
              <Plus className="w-6 h-6" />
            </button>

            {/* Bulk Actions Bar */}
            <AnimatePresence>
               {selectedWordIds.size > 0 && (
                  <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 left-4 right-24 bg-slate-900 rounded-2xl shadow-2xl p-2 flex items-center justify-around z-10 border border-slate-700">
                     <button onClick={() => deleteWords(Array.from(selectedWordIds))} className="flex flex-col items-center p-2 text-rose-400 active:opacity-70">
                        <Trash2 className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-bold">Удалить</span>
                     </button>
                     <button onClick={() => setShowBulkAddGroup(true)} className="flex flex-col items-center p-2 text-blue-400 active:opacity-70">
                        <FolderPlus className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-bold">В группу</span>
                     </button>
                     <button onClick={() => { setActiveTab('train'); }} className="flex flex-col items-center p-2 text-emerald-400 active:opacity-70 border-l border-slate-700 pl-4">
                        <PlayCircle className="w-5 h-5 mb-1 text-emerald-400 fill-emerald-400/20" />
                        <span className="text-[10px] font-bold">Тренировать ({selectedWordIds.size})</span>
                     </button>
                  </motion.div>
               )}
            </AnimatePresence>
          </motion.div>
        )}

        {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
          <motion.div key="groups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-4 space-y-3">
             {currentCategoryGroups.length > 0 && (
               <div className="flex justify-between items-center mb-2 px-1">
                 <h2 className="text-xl font-bold tracking-tight">Ваши группы</h2>
                 <button 
                   onClick={() => {
                     if (selectedGroupIds.size === currentCategoryGroups.length) {
                       setSelectedGroupIds(new Set());
                     } else {
                       setSelectedGroupIds(new Set(currentCategoryGroups.map(g => g.id)));
                     }
                   }} 
                   className="text-sm font-bold text-blue-500 flex items-center gap-1 active:opacity-70"
                 >
                   <CheckCircle2 className="w-4 h-4"/> 
                   {selectedGroupIds.size === currentCategoryGroups.length ? 'Снять выделение' : 'Выбрать все'}
                 </button>
               </div>
             )}
            {currentCategoryGroups.length === 0 ? (
              <div className="text-center text-slate-400 py-12">Нет групп.</div>
            ) : (
              currentCategoryGroups.map(group => {
                const count = words.filter(w => w.groupIds.includes(group.id)).length;
                return (
                  <div key={group.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 transition-transform">
                     <button 
                      onClick={(e) => {
                         e.stopPropagation();
                         const newSet = new Set(selectedGroupIds);
                         newSet.has(group.id) ? newSet.delete(group.id) : newSet.add(group.id);
                         setSelectedGroupIds(newSet);
                      }}
                      className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedGroupIds.has(group.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}
                    >
                      {selectedGroupIds.has(group.id) && <Check className="w-4 h-4 text-white" />}
                    </button>
                    <div className="flex items-center gap-4 flex-1 cursor-pointer active:scale-[0.98]" onClick={() => setViewingGroupId(group.id)}>
                      <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
                        <Layers className="w-5 h-5 text-indigo-500" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-bold">{group.name}</h3>
                        <p className="text-slate-500 text-sm mt-0.5">{count} элементов</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-slate-300 shrink-0" />
                    </div>
                  </div>
                )
              })
            )}
             <button onClick={() => setShowAddGroup(true)} className="fixed bottom-24 right-5 w-14 h-14 bg-indigo-500 text-white rounded-full shadow-xl flex items-center justify-center hover:bg-indigo-600 active:scale-90 transition-all z-20">
              <Plus className="w-6 h-6" />
            </button>

            {/* Bulk Actions Bar for Groups */}
            <AnimatePresence>
               {selectedGroupIds.size > 0 && (
                  <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 left-4 right-24 bg-slate-900 rounded-2xl shadow-2xl p-2 flex items-center justify-around z-10 border border-slate-700">
                     <button onClick={() => {
                        selectedGroupIds.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'groups', id)));
                        words.forEach(w => {
                           const remainingGroups = w.groupIds.filter(gid => !selectedGroupIds.has(gid));
                           if (remainingGroups.length !== w.groupIds.length) {
                              updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: remainingGroups });
                           }
                        });
                        setSelectedGroupIds(new Set());
                     }} className="flex flex-col items-center p-2 text-rose-400 active:opacity-70">
                        <Trash2 className="w-5 h-5 mb-1" />
                        <span className="text-[10px] font-bold">Удалить</span>
                     </button>
                     <button onClick={() => { setActiveTab('train'); }} className="flex flex-col items-center p-2 text-emerald-400 active:opacity-70 border-l border-slate-700 pl-4">
                        <PlayCircle className="w-5 h-5 mb-1 text-emerald-400 fill-emerald-400/20" />
                        <span className="text-[10px] font-bold">Тренировать ({selectedGroupIds.size})</span>
                     </button>
                  </motion.div>
               )}
            </AnimatePresence>
          </motion.div>
        )}

        {!activeTrainingMode && viewingGroupId && (
           <GroupView 
             group={groups.find(g => g.id === viewingGroupId)!} 
             words={words.filter(w => w.groupIds.includes(viewingGroupId))}
             onClose={() => setViewingGroupId(null)}
             onRemoveFromGroup={(wordId: string) => {
                const w = words.find(w => w.id === wordId);
                if (w) updateDoc(doc(db, 'users', user.uid, 'words', wordId), { groupIds: w.groupIds.filter(gid => gid !== viewingGroupId) });
             }}
             onWordClick={(wordId) => setViewingWordId(wordId)}
             selectedWordIds={selectedWordIds}
             setSelectedWordIds={setSelectedWordIds}
             onTrain={() => setActiveTab('train')}
           />
        )}

        {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
          <motion.div key="train" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 pt-12">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Тренировка</h1>
            
            {getTrainingWords().length === 0 ? (
               <div className="mb-8">
                  <p className="text-slate-500 mb-4">Выберите слова для тренировки:</p>
                  <div className="space-y-3">
                     <button onClick={() => { setSelectedWordIds(new Set(currentCategoryWords.map(w => w.id))); }} className="w-full bg-indigo-50 p-4 rounded-2xl shadow-sm border border-indigo-100 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between text-indigo-700">
                        <span>Словарь полностью</span> <span className="font-normal">{currentCategoryWords.length} слов</span>
                     </button>
                     {currentCategoryGroups.map(group => {
                        const count = words.filter(w => w.groupIds.includes(group.id)).length;
                        return (
                           <button key={group.id} onClick={() => { setSelectedGroupIds(new Set([group.id])); }} className="w-full bg-white p-4 rounded-2xl shadow-sm border border-slate-100 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between">
                              <span>Группа: {group.name}</span> <span className="text-slate-400 font-normal">{count} слов</span>
                           </button>
                        )
                     })}
                     <button onClick={() => setActiveTab('dict')} className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-200 font-bold text-left active:scale-[0.98] transition-transform text-slate-600 flex items-center justify-between mt-4">
                        Выбрать вручную из словаря <ArrowRight className="w-4 h-4"/>
                     </button>
                  </div>
               </div>
            ) : (
               <>
                  <div className="flex items-center justify-between mb-8">
                     <p className="text-slate-500">
                       Выбрано элементов: <span className="font-bold text-slate-800">{getTrainingWords().length}</span>
                     </p>
                     <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-blue-500 font-bold text-sm bg-blue-50 px-3 py-1.5 rounded-lg active:scale-95 transition-transform">
                        Сбросить
                     </button>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <TrainCard title="Карточки" icon={<FlipHorizontal />} color="text-amber-500" bg="bg-amber-50" onClick={() => { setActiveTrainingMode('flashcards'); setSessionStats({correct:0, total:0}); }} />
                    <TrainCard title="Викторина" icon={<CheckCircle2 />} color="text-emerald-500" bg="bg-emerald-50" onClick={() => { setActiveTrainingMode('quiz'); setSessionStats({correct:0, total:0}); }} />
                    <TrainCard title="Предложение" icon={<Type />} color="text-blue-500" bg="bg-blue-50" onClick={() => { setActiveTrainingMode('sentence'); setSessionStats({correct:0, total:0}); }} />
                    <TrainCard title="Выживание" icon={<Timer />} color="text-rose-500" bg="bg-rose-50" onClick={() => { setActiveTrainingMode('timeattack'); setSessionStats({correct:0, total:0}); }} />
                  </div>
               </>
            )}
          </motion.div>
        )}

        {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
          <motion.div key="settings" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-4 pt-12 md:p-8 flex flex-col justify-between h-full">
            <div>
              <h1 className="text-3xl font-bold tracking-tight mb-8">Настройки</h1>
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col gap-6 mb-6">
                 <div className="flex items-center gap-4">
                    {user?.photoURL ? (
                       <img src={user.photoURL} alt="Avatar" className="w-16 h-16 rounded-full border-2 border-slate-100" />
                    ) : (
                       <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center font-bold text-2xl text-slate-400">
                          {user?.displayName ? user.displayName[0].toUpperCase() : '?'}
                       </div>
                    )}
                    <div>
                       <div className="font-bold text-lg">{user?.displayName || 'Пользователь'}</div>
                       <div className="text-slate-500 text-sm">{user?.email}</div>
                    </div>
                 </div>

                 <div className="border-t border-slate-100 pt-6">
                    <h3 className="font-bold mb-3">Уровень владения языком</h3>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      {['Beginner', 'Intermediate', 'Advanced'].map((lvl) => (
                        <button
                          key={lvl}
                          onClick={() => {
                             setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...userProfile, level: lvl }, { merge: true });
                          }}
                          className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${userProfile?.level === lvl ? 'bg-white text-blue-500 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          {lvl}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-400 mt-3 text-center">ИИ использует ваш уровень для адаптации примеров.</p>
                 </div>
              </div>
            </div>

            <button 
              onClick={() => signOut(auth)} 
              className="mt-4 w-full py-4 bg-rose-50 text-rose-500 font-bold rounded-2xl active:scale-95 transition-transform"
            >
              Выйти из аккаунта
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODALS */}
      <AnimatePresence>
        {userProfile && !userProfile.onboarded && (
           <OnboardingModal 
             user={user} 
             onSave={(level: string) => {
                setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, onboarded: true });
             }} 
           />
        )}
        {showAddWord && (
          <AddWordModal
            category={dictCategory}
            groups={currentCategoryGroups}
            userProfile={userProfile}
            onClose={() => setShowAddWord(false)}
            onSave={(newWord: any) => { 
                const id = doc(collection(db, 'users', user.uid, 'words')).id;
                setDoc(doc(db, 'users', user.uid, 'words', id), { ...newWord, id, createdAt: Date.now(), correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0 }); 
                setShowAddWord(false); 
            }}
          />
        )}
        {showAddGroup && (
           <AddGroupModal 
              onClose={() => setShowAddGroup(false)}
              onSave={(name: string) => {
                const id = doc(collection(db, 'users', user.uid, 'groups')).id;
                setDoc(doc(db, 'users', user.uid, 'groups', id), { id, name, category: dictCategory });
                setShowAddGroup(false);
              }}
           />
        )}
        {viewingWordId && (
           <WordEditorModal 
              word={words.find(w => w.id === viewingWordId)!}
              groups={groups.filter(g => g.category === words.find(w => w.id === viewingWordId)?.category)}
              userProfile={userProfile}
              onClose={() => setViewingWordId(null)}
              onSave={(updatedWord: any) => {
                 updateDoc(doc(db, 'users', user.uid, 'words', updatedWord.id), updatedWord);
                 setViewingWordId(null);
              }}
              onDelete={() => {
                 deleteWords([viewingWordId]);
                 setViewingWordId(null);
              }}
              onCreateGroup={(name: string, category: string) => {
                 const newGroupId = doc(collection(db, 'users', user.uid, 'groups')).id;
                 setDoc(doc(db, 'users', user.uid, 'groups', newGroupId), { id: newGroupId, name, category });
                 return newGroupId;
              }}
           />
        )}
        {showBulkAddGroup && (
           <BulkAddGroupModal 
              groups={currentCategoryGroups}
              onClose={() => setShowBulkAddGroup(false)}
              onSave={(groupId: string) => {
                 words.forEach(w => {
                    if (selectedWordIds.has(w.id) && !w.groupIds.includes(groupId)) {
                       updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: [...w.groupIds, groupId] });
                    }
                 });
                 setShowBulkAddGroup(false);
                 setSelectedWordIds(new Set());
              }}
           />
        )}
      </AnimatePresence>
        </div>
      </main>

      {/* TRAINING OVERLAY */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div initial={{ opacity: 0, y: '100%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="fixed inset-0 bg-slate-900 border-x border-slate-800 z-50 flex flex-col shadow-2xl">
               <div className="flex justify-between items-center p-4 md:p-8 pt-12 md:pt-8 text-white max-w-4xl mx-auto w-full">
                  <span className="font-medium text-slate-300 opacity-0">Score</span>
                  <button onClick={() => setActiveTrainingMode(null)} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700 active:scale-95 transition-all">
                     <X className="w-6 h-6 text-white" />
                  </button>
               </div>
               <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-4xl mx-auto w-full">
                  {activeTrainingMode === 'stats' ? (
                     <SessionStats stats={sessionStats} onClose={() => { setActiveTrainingMode(null); }} />
                  ) : getTrainingWords().length === 0 ? (
                     <div className="text-white text-center">Нет слов для тренировки.</div>
                  ) : (
                     <div className="w-full">
                         {activeTrainingMode === 'flashcards' && <ModeFlashcards words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'quiz' && <ModeQuiz words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'sentence' && <ModeSentence words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'timeattack' && <ModeTimeAttack words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                     </div>
                  )}
               </div>
            </motion.div>
         )}
      </AnimatePresence>
    </div>
  );
}

// =========================================================================
// COMPONENTS & PROGRESS VISUALIZATION
// =========================================================================

function SessionStats({ stats, onClose }: any) {
   const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
   return (
      <div className="w-full max-w-sm flex flex-col items-center text-center">
         <h2 className="text-3xl font-bold text-white mb-6">Тренировка завершена!</h2>
         <div className="bg-slate-800 rounded-3xl p-8 w-full border border-slate-700 shadow-xl mb-8">
            <div className="text-6xl font-black text-blue-500 mb-2">{accuracy}%</div>
            <div className="text-slate-400 font-medium mb-8">Точность ответов</div>
            
            <div className="flex justify-between text-lg font-bold">
               <span className="text-emerald-400">Правильно: {stats.correct}</span>
               <span className="text-rose-500">Ошибок: {stats.total - stats.correct}</span>
            </div>
         </div>
         <button onClick={onClose} className="w-full bg-blue-500 text-white font-bold py-4 rounded-2xl">Отлично</button>
      </div>
   );
}

function MasteryBar({ masteryLevel, showLabel = false }: { masteryLevel: number, showLabel?: boolean }) {
   let color = 'bg-rose-500';
   if (masteryLevel > 30) color = 'bg-amber-400';
   if (masteryLevel > 70) color = 'bg-emerald-500';
   
   return (
      <div className="mt-2 w-full">
         {showLabel && <div className="text-xs font-bold text-slate-400 mb-1 flex justify-between"><span>Освоено</span><span>{masteryLevel}%</span></div>}
         <div className="w-full bg-slate-100/50 rounded-full h-1.5 overflow-hidden">
            <div className={`h-full ${color} transition-all duration-500 shadow-sm`} style={{ width: `${masteryLevel}%` }} />
         </div>
      </div>
   );
}

function NavItem({ active, icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center flex-1 py-1 gap-1 transition-colors ${active ? 'text-blue-500' : 'text-slate-400'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{icon}</div>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function SidebarItem({ active, icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex items-center w-full px-4 py-3 gap-3 rounded-2xl transition-colors ${active ? 'text-blue-500 bg-blue-50' : 'text-slate-500 hover:bg-slate-100/50'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-6 h-6" })}</div>
      <span className="font-bold">{label}</span>
    </button>
  );
}

function TrainCard({ title, icon, color, bg, onClick }: any) {
  return (
    <div onClick={onClick} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center justify-center gap-4 active:scale-95 transition-transform cursor-pointer">
      <div className={`w-16 h-16 rounded-full ${bg} flex items-center justify-center`}>
        {React.cloneElement(icon, { className: `w-8 h-8 ${color}` })}
      </div>
      <span className="font-bold text-slate-800">{title}</span>
    </div>
  );
}

function GroupView({ group, words, onClose, onRemoveFromGroup, onWordClick, selectedWordIds, setSelectedWordIds, onTrain }: any) {
   return (
      <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="absolute inset-0 z-20 bg-slate-50 flex flex-col pb-24 border-x border-slate-100 top-0 pt-12">
         <div className="flex items-center px-4 pb-4 border-b border-slate-200 gap-4 bg-white sticky top-0 z-10">
            <button onClick={onClose} className="p-2 -ml-2 text-slate-500 active:bg-slate-100 rounded-full"><ArrowLeft className="w-6 h-6" /></button>
            <div className="flex-1">
               <h2 className="text-xl font-bold">{group.name}</h2>
               <p className="text-slate-500 text-sm">{words.length} элементов</p>
            </div>
         </div>
         <div className="p-4 space-y-3 overflow-auto flex-1">
            {words.length > 0 && (
              <div className="flex justify-between items-center px-1 mb-2">
                <button 
                  onClick={() => {
                    const groupWordIds = words.map((w: Word) => w.id);
                    const allSelected = groupWordIds.every((id: string) => selectedWordIds.has(id));
                    if (allSelected) {
                      const newSet = new Set(selectedWordIds);
                      groupWordIds.forEach((id: string) => newSet.delete(id));
                      setSelectedWordIds(newSet);
                    } else {
                      const newSet = new Set(selectedWordIds);
                      groupWordIds.forEach((id: string) => newSet.add(id));
                      setSelectedWordIds(newSet);
                    }
                  }} 
                  className="text-sm font-bold text-blue-500 flex items-center gap-1 active:opacity-70"
                >
                  <CheckCircle2 className="w-4 h-4"/> Выбрать все в группе
                </button>
              </div>
            )}
            {words.length === 0 ? (
               <div className="text-center text-slate-400 p-8">В этой группе пока нет слов.</div>
            ) : (
               words.map((word: Word) => (
                  <div key={word.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-3 active:scale-[0.98] transition-transform">
                     <button 
                       onClick={() => {
                          const newSet = new Set(selectedWordIds);
                          newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id);
                          setSelectedWordIds(newSet);
                       }}
                       className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}
                     >
                       {selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}
                     </button>
                     <div className="flex-1 cursor-pointer" onClick={() => onWordClick(word.id)}>
                        <h3 className="text-lg font-bold">{word.original}</h3>
                        <p className="text-slate-500 text-sm line-clamp-1">{word.translations[0]?.text}</p>
                        <MasteryBar masteryLevel={word.masteryLevel} />
                     </div>
                     <button onClick={() => onRemoveFromGroup(word.id)} className="p-2 text-slate-400 hover:text-rose-500 bg-slate-50 rounded-full shrink-0">
                        <X className="w-5 h-5"/>
                     </button>
                  </div>
               ))
            )}
         </div>

         {/* Group Bulk Actions Bar */}
         <AnimatePresence>
            {selectedWordIds.size > 0 && words.some((w: Word) => selectedWordIds.has(w.id)) && (
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="absolute bottom-6 left-4 right-4 bg-slate-900 rounded-2xl shadow-2xl p-2 flex items-center justify-around z-30 border border-slate-700">
                  <button onClick={() => {
                     words.forEach((w: Word) => {
                        if (selectedWordIds.has(w.id)) onRemoveFromGroup(w.id);
                     });
                     const newSet = new Set(selectedWordIds);
                     words.forEach((w: Word) => newSet.delete(w.id));
                     setSelectedWordIds(newSet);
                  }} className="flex flex-col items-center p-2 text-rose-400 active:opacity-70">
                     <Trash2 className="w-5 h-5 mb-1" />
                     <span className="text-[10px] font-bold">Удалить из группы</span>
                  </button>
                  <button onClick={onTrain} className="flex flex-col items-center p-2 text-emerald-400 active:opacity-70 border-l border-slate-700 pl-4">
                     <PlayCircle className="w-5 h-5 mb-1 text-emerald-400 fill-emerald-400/20" />
                     <span className="text-[10px] font-bold">Тренировать ({selectedWordIds.size})</span>
                  </button>
               </motion.div>
            )}
         </AnimatePresence>
      </motion.div>
   );
}

// =========================================================================
// MODALS
// =========================================================================

function WordEditorModal({ word, groups, onClose, onSave, onDelete, onCreateGroup, userProfile }: any) {
   const [original, setOriginal] = useState(word.original);
   const [translation, setTranslation] = useState(word.translations[0]?.text || '');
   const [example, setExample] = useState(word.translations[0]?.examples[0] || '');
   const [groupIds, setGroupIds] = useState<Set<string>>(new Set(word.groupIds));
   
   const [isCreatingGroup, setIsCreatingGroup] = useState(false);
   const [newGroupName, setNewGroupName] = useState('');
   const [isGeneratingExample, setIsGeneratingExample] = useState(false);

   const handleSave = () => {
      onSave({ 
         ...word, original, groupIds: Array.from(groupIds),
         translations: [{ text: translation, examples: example ? [example] : [] }]
      });
   };

   const handleRegenerateExample = async () => {
      setIsGeneratingExample(true);
      try {
         const res = await fetch('/.netlify/functions/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'examples', word: original, level: userProfile?.level })
         });
         
         const data = await res.json();
         if (Array.isArray(data) && data.length > 0) {
            setExample(data[0]); // Replace example
         } else if (data?.[0]?.examples?.[0]) {
            setExample(data[0].examples[0]);
         }
      } catch (err) {
         console.error(err);
      }
      setIsGeneratingExample(false);
   };

   return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex flex-col justify-end max-w-md mx-auto">
         <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25 }} className="bg-white w-full rounded-t-[2rem] p-6 shadow-2xl flex flex-col h-[85vh]">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-xl font-bold flex items-center gap-2"><Edit3 className="w-5 h-5 text-blue-500"/> Данные слова</h2>
               <div className="flex items-center gap-2">
                  <button onClick={onDelete} className="p-2 bg-rose-50 text-rose-500 rounded-full mr-2"><Trash2 className="w-5 h-5" /></button>
                  <button onClick={onClose} className="p-2 bg-slate-100 rounded-full"><X className="w-5 h-5 text-slate-500" /></button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pb-6 px-1 hide-scrollbar">
               
               <div className="bg-slate-50 p-4 rounded-2xl mb-4 border border-slate-100">
                  <MasteryBar masteryLevel={word.masteryLevel} showLabel={true} />
                  <div className="flex flex-row justify-between text-xs font-bold text-slate-400 mt-3 pt-3 border-t border-slate-200">
                     <span className="text-emerald-500">Верно: {word.correctAnswers}</span>
                     <span className="text-rose-500">Ошибок: {word.incorrectAnswers}</span>
                  </div>
               </div>

               <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Слово / Выражение</label>
                  <input value={original} onChange={e => setOriginal(e.target.value)} className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-blue-500 text-lg font-medium" />
               </div>
               <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Перевод</label>
                  <input value={translation} onChange={e => setTranslation(e.target.value)} className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-blue-500" />
               </div>
               <div className="space-y-1 relative">
                  <div className="flex justify-between items-center">
                     <label className="text-xs font-bold text-slate-500 uppercase">Пример употребления</label>
                     <button onClick={handleRegenerateExample} disabled={isGeneratingExample} className="text-[10px] uppercase font-bold text-blue-500 bg-blue-50 px-2 py-1 rounded-md flex gap-1 items-center active:scale-95">
                        {isGeneratingExample ? <Loader2 className="w-3 h-3 animate-spin"/> : <Brain className="w-3 h-3"/>} Заменить ИИ
                     </button>
                  </div>
                  <textarea value={example} onChange={e => setExample(e.target.value)} className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-blue-500 min-h-[80px]" />
               </div>

               <div className="pt-4 border-t border-slate-100 mt-4">
                  <label className="text-xs font-bold text-slate-500 uppercase mb-3 block">Наличие в группах</label>
                  <div className="flex flex-wrap gap-2 mb-4">
                     {groups.map((g: Group) => (
                        <button key={g.id} onClick={() => {
                              const s = new Set(groupIds); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setGroupIds(s);
                           }}
                           className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center gap-2 ${groupIds.has(g.id) ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-200 text-slate-600'}`}
                        >
                           {groupIds.has(g.id) && <Check className="w-4 h-4"/>} {g.name}
                        </button>
                     ))}
                  </div>
                  {isCreatingGroup ? (
                     <div className="flex gap-2">
                        <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Имя группы" className="flex-1 bg-slate-50 px-4 py-3 rounded-xl border outline-none focus:border-indigo-500" />
                        <button onClick={() => {
                              if (newGroupName) {
                                 const newId = onCreateGroup(newGroupName, word.category);
                                 setGroupIds(new Set([...Array.from(groupIds), newId]));
                                 setNewGroupName(''); setIsCreatingGroup(false);
                              }
                           }} className="bg-indigo-500 text-white px-4 py-3 rounded-xl font-bold"
                        >OK</button>
                     </div>
                  ) : (
                     <button onClick={() => setIsCreatingGroup(true)} className="text-indigo-500 font-bold text-sm bg-indigo-50 px-4 py-2 rounded-xl flex items-center gap-2"><Plus className="w-4 h-4"/> Новая группа</button>
                  )}
               </div>
            </div>
            <button onClick={handleSave} className="w-full py-4 bg-blue-500 text-white font-bold rounded-2xl active:bg-blue-600 transition-colors text-lg mt-4 shrink-0">
               Сохранить изменения
            </button>
         </motion.div>
      </div>
   );
}


function AddGroupModal({ onClose, onSave }: any) {
   const [name, setName] = useState('');
   return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-3xl p-6 shadow-2xl">
           <h2 className="text-xl font-bold mb-4">Новая группа</h2>
           <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Название группы" className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 outline-none focus:border-indigo-500 transition-colors" />
           <div className="mt-6 flex gap-3">
              <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl active:bg-slate-200">Отмена</button>
              <button onClick={() => name && onSave(name)} className="flex-1 py-3 bg-indigo-500 text-white font-bold rounded-xl active:bg-indigo-600 disabled:opacity-50" disabled={!name}>Создать</button>
           </div>
        </motion.div>
      </div>
   );
}

function BulkAddGroupModal({ groups, onClose, onSave }: any) {
   return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end max-w-md mx-auto">
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full rounded-t-[2rem] p-6 pb-12 shadow-2xl">
           <div className="flex justify-between items-center mb-4">
               <h2 className="text-xl font-bold">Добавить в группу</h2>
               <button onClick={onClose} className="p-2 bg-slate-100 text-slate-500 rounded-full"><X className="w-5 h-5"/></button>
           </div>
           <div className="space-y-2">
              {groups.length === 0 ? <p className="text-slate-500 text-sm">Сначала создайте группу в вкладке "Группы".</p> : null}
              {groups.map((g: Group) => (
                 <button key={g.id} onClick={() => onSave(g.id)} className="w-full text-left p-4 bg-slate-50 rounded-xl font-medium active:bg-slate-100 hover:bg-slate-100 flex items-center justify-between">
                    {g.name} <Plus className="w-5 h-5 text-indigo-500"/>
                 </button>
              ))}
           </div>
        </motion.div>
      </div>
   );
}

function OnboardingModal({ user, onSave }: any) {
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState('Beginner');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden transform relative">
         <div className="p-8">
            <h2 className="text-3xl font-black mb-6">Добро пожаловать в Words!</h2>
            
            {step === 0 && (
               <div className="space-y-4">
                  <div className="flex items-start gap-4">
                     <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-500 shrink-0"><BookOpen className="w-5 h-5"/></div>
                     <div><h3 className="font-bold">Умный словарь</h3><p className="text-slate-500 text-sm">ИИ поможет подобрать правильные переводы и примеры предложений.</p></div>
                  </div>
                  <div className="flex items-start gap-4">
                     <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-500 shrink-0"><PlayCircle className="w-5 h-5"/></div>
                     <div><h3 className="font-bold">4 режима тренировки</h3><p className="text-slate-500 text-sm">Карточки, Викторина, Фразы (с проверкой ИИ) и Выживание.</p></div>
                  </div>
                  <div className="flex items-start gap-4">
                     <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-500 shrink-0"><Layers className="w-5 h-5"/></div>
                     <div><h3 className="font-bold">Синхронизация</h3><p className="text-slate-500 text-sm">Ваши слова и группы сохраняются в облаке и доступны на любом устройстве.</p></div>
                  </div>
               </div>
            )}

            {step === 1 && (
               <div>
                  <h3 className="font-bold text-xl mb-4">Какой у вас уровень английского?</h3>
                  <p className="text-slate-500 mb-6">Это поможет ИИ подбирать правильные примеры и дистракторы в режимах обучения.</p>
                  
                  <div className="space-y-3">
                     {['Beginner', 'Intermediate', 'Advanced'].map(l => (
                        <button key={l} onClick={() => setLevel(l)} className={`w-full p-4 rounded-2xl border-2 font-bold text-left transition-colors ${level === l ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-slate-100 hover:border-slate-200'}`}>
                           {l}
                        </button>
                     ))}
                  </div>
               </div>
            )}
         </div>

         <div className="p-4 bg-slate-50 border-t border-slate-100 p-8 pt-4">
            <button onClick={() => { if (step === 0) setStep(1); else onSave(level); }} className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl active:scale-95 transition-transform">
               {step === 0 ? 'Далее' : 'Начать обучение'}
            </button>
         </div>
      </motion.div>
    </motion.div>
  );
}

function AddWordModal({ category, groups, onClose, onSave, userProfile }: any) {
  const [original, setOriginal] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done'>('idle');
  const [translations, setTranslations] = useState<Translation[]>([]);

  const handleAnalyze = async () => {
    if (!original.trim()) return;
    setStatus('analyzing');
    const results = await ApiClient.aiGenerateTranslations(original, category, userProfile?.level);
    setTranslations(results);
    setStatus('done');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end max-w-md mx-auto">
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Добавить новое слово</h2>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6">
          <div>
            <div className="relative">
              <input autoFocus placeholder="..." value={original} onChange={e => setOriginal(e.target.value)} disabled={status !== 'idle'} className="w-full bg-slate-50 pl-12 pr-4 py-4 rounded-2xl text-lg font-medium border outline-none focus:border-blue-500" />
              <Search className="absolute left-4 top-4.5 text-slate-400 w-5 h-5" />
            </div>
            {status === 'idle' && (
              <button onClick={handleAnalyze} disabled={!original.trim()} className="mt-4 w-full py-4 bg-slate-900 text-white font-bold rounded-2xl flex items-center justify-center gap-2">
                <Brain className="w-5 h-5"/> Анализировать ИИ
              </button>
            )}
            {status === 'analyzing' && (
              <div className="mt-8 flex flex-col items-center justify-center text-slate-500 space-y-4">
                 <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                 <span className="font-medium">ИИ анализирует...</span>
              </div>
            )}
          </div>

          {status === 'done' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
               <div className="space-y-3">
                   {translations.map((tr, i) => (
                      <div key={i} className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                         <div className="font-bold text-blue-900 mb-2">{tr.text}</div>
                         <div className="text-blue-700/80 text-sm italic">"{tr.examples[0]}"</div>
                      </div>
                   ))}
               </div>
               {groups.length > 0 && (
                 <div>
                    <h3 className="text-sm font-bold text-slate-400 mb-3">Группы</h3>
                    <div className="flex flex-wrap gap-2">
                       {groups.map((g: Group) => (
                         <button key={g.id} onClick={() => {
                              const s = new Set(selectedGroups); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setSelectedGroups(s);
                           }} className={`px-4 py-2 rounded-xl text-sm border ${selectedGroups.has(g.id) ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-200'}`}>{g.name}</button>
                       ))}
                    </div>
                 </div>
               )}
               <button onClick={() => onSave({ original, translations, category, groupIds: Array.from(selectedGroups) })} className="w-full py-4 bg-blue-500 text-white font-bold rounded-2xl">
                 Сохранить в словарь
               </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}


// --- TRAINING MODES ---

function ModeFlashcards({ words, onProgress, onFinish }: any) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [direction, setDirection] = useState<'forward' | 'reverse'>('forward');
  const word = words[currentIndex];

  const handleAnswer = (isCorrect: boolean) => {
    onProgress(word.id, isCorrect);
    if (currentIndex >= words.length - 1) { onFinish(); return; }
    setIsFlipped(false);
    setTimeout(() => setCurrentIndex(c => c + 1), 150);
  };

  if (!word) return null;
  return (
    <div className="w-full max-w-sm flex flex-col items-center mx-auto">
      <div className="mb-8 flex items-center justify-between w-full">
         <span className="text-slate-400 font-medium">{currentIndex + 1} / {words.length}</span>
         <button onClick={() => setDirection(d => d === 'forward' ? 'reverse' : 'forward')} className="bg-slate-800 px-4 py-2 rounded-full text-sm text-white border border-slate-700">Изменить направление</button>
      </div>

      <div className="w-full h-96 relative perspective-1000 cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
         <motion.div animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} className="w-full h-full relative [transform-style:preserve-3d]">
            <div className="absolute inset-0 [backface-visibility:hidden] bg-white rounded-[2.5rem] flex items-center justify-center p-8 text-center text-slate-800 shadow-2xl">
               <h2 className="text-4xl font-bold">{direction === 'forward' ? word.original : word.translations[0]?.text}</h2>
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-blue-600 rounded-[2.5rem] flex flex-col items-center justify-center p-8 text-center text-white shadow-2xl">
               <h2 className="text-3xl font-bold mb-4">{direction === 'forward' ? word.translations[0]?.text : word.original}</h2>
               {direction === 'forward' && <p className="italic text-blue-100 text-sm">"{word.translations[0]?.examples[0]}"</p>}
            </div>
         </motion.div>
      </div>
      
      <div className="mt-12 w-full flex gap-4">
         <button onClick={() => handleAnswer(false)} className="flex-1 py-4 bg-rose-500/10 text-rose-500 border border-rose-500/30 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"><XOctagon className="w-5 h-5"/> Не вспомнил</button>
         <button onClick={() => handleAnswer(true)} className="flex-1 py-4 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"><CheckCircle2 className="w-5 h-5" /> Вспомнил</button>
      </div>
    </div>
  );
}

function ModeQuiz({ words, onProgress, onFinish }: any) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [options, setOptions] = useState<string[]>([]);
  const [correct, setCorrect] = useState('');
  const [ansIdx, setAnsIdx] = useState<number | null>(null);
  const word = words[currentIndex];

  useEffect(() => {
    if (!word) return;
    const load = async () => {
      setOptions([]); setAnsIdx(null);
      const c = word.translations[0]?.text || '';
      setCorrect(c);
      const dist = await ApiClient.aiGenerateDistractors(word.original, c);
      setOptions([...dist, c].sort(() => Math.random() - 0.5));
    };
    load();
  }, [word]);

  if (!word) return null;
  return (
    <div className="w-full max-w-sm flex flex-col">
       <span className="text-slate-400 font-medium text-center mb-8">{currentIndex + 1} / {words.length}</span>
       <div className="bg-slate-800 rounded-3xl p-8 text-center mb-8 border border-slate-700 shadow-xl">
          <h2 className="text-3xl font-bold text-white">{word.original}</h2>
       </div>
       {options.length === 0 ? (
          <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-blue-500"/></div>
       ) : (
          <div className="space-y-3">
             {options.map((opt, i) => {
                let stateClass = "bg-white text-slate-800";
                if (ansIdx !== null) {
                   if (opt === correct) stateClass = "bg-emerald-500 text-white border-transparent";
                   else if (i === ansIdx) stateClass = "bg-rose-500 text-white border-transparent";
                   else stateClass = "bg-white/50 text-slate-500 opacity-50";
                }
                return (
                  <button key={i} onClick={() => { 
                      if(ansIdx===null) { 
                         setAnsIdx(i); 
                         onProgress(word.id, opt === correct);
                         setTimeout(() => { if(currentIndex >= words.length-1) onFinish(); else setCurrentIndex(c=>c+1); }, 1500) 
                      } 
                   }} className={`w-full p-5 rounded-2xl font-bold text-lg active:scale-[0.98] transition-all shadow-sm ${stateClass}`}>
                     {opt}
                  </button>
                );
             })}
          </div>
       )}
    </div>
  );
}

function ModeSentence({ words, onProgress, onFinish }: any) {
   const [currentIndex, setCurrentIndex] = useState(0);
   const [input, setInput] = useState('');
   const [status, setStatus] = useState<'idle'|'checking'|'correct'|'incorrect'>('idle');
   const [fb, setFb] = useState('');
   const word = words[currentIndex];
 
   if (!word) return null;
   return (
     <div className="w-full max-w-sm flex flex-col relative h-[80vh]">
        <div className="flex-1">
          <span className="text-slate-400 font-medium text-center block mb-6">{currentIndex + 1} / {words.length}</span>
          <div className="bg-slate-800 rounded-3xl p-8 mb-6 border border-slate-700 shadow-xl">
            <h2 className="text-3xl font-bold text-white mb-2">{word.original}</h2>
            <p className="text-slate-400 italic font-medium">{word.translations[0]?.text}</p>
          </div>
          <textarea autoFocus value={input} onChange={e => { setInput(e.target.value); setStatus('idle'); }} placeholder="Напишите предложение..." disabled={status === 'checking' || status === 'correct'} className="w-full bg-white/10 border border-slate-700 focus:border-blue-500 text-white p-5 rounded-2xl min-h-[120px] outline-none" />
          {status !== 'idle' && status !== 'checking' && (
             <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`mt-4 p-4 rounded-2xl flex items-start gap-3 ${status === 'correct' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'}`}>
                {status === 'correct' ? <CheckCircle2 className="w-6 h-6 shrink-0"/> : <XCircle className="w-6 h-6 shrink-0"/>}
                <p className="font-medium text-sm leading-relaxed">{fb}</p>
             </motion.div>
          )}
        </div>
        <div className="pb-8">
           {status === 'idle' && <button onClick={async () => { 
                setStatus('checking'); 
                const r = await ApiClient.aiCheckSentence(word.original, input); 
                setFb(r.feedback); 
                setStatus(r.isCorrect ? 'correct' : 'incorrect'); 
                onProgress(word.id, r.isCorrect);
             }} disabled={!input} className="w-full bg-blue-500 text-white font-bold py-4 rounded-2xl flex gap-2 justify-center"><Brain className="w-5 h-5"/> Проверить ИИ</button>}
           {status === 'checking' && <div className="w-full bg-slate-800 text-blue-400 font-bold py-4 rounded-2xl flex justify-center"><Loader2 className="animate-spin w-5 h-5" /> Анализируем...</div>}
           {(status === 'correct' || status === 'incorrect') && <button onClick={() => { if(currentIndex >= words.length-1) onFinish(); else { setCurrentIndex(c=>c+1); setInput(''); setStatus('idle'); } }} className="w-full bg-slate-700 text-white font-bold py-4 rounded-2xl">Дальше <ArrowRight className="w-5 h-5 inline"/></button>}
        </div>
     </div>
   );
 }

function ModeTimeAttack({ words, onProgress, onFinish }: any) {
   const [time, setTime] = useState(60);
   const [score, setScore] = useState(0);
   const [idx, setIdx] = useState(0);
   const [input, setInput] = useState('');
   const [flash, setFlash] = useState<null | 'success' | 'error'>(null);
   const [shuffledWords, setShuffledWords] = useState<any[]>([]);

   useEffect(() => {
      setShuffledWords([...words].sort(() => Math.random() - 0.5));
   }, [words]);

   useEffect(() => {
     if (time <= 0 || (shuffledWords.length > 0 && idx >= shuffledWords.length)) return;
     const t = setInterval(() => setTime(prev => prev - 1), 1000);
     return () => clearInterval(t);
   }, [time, idx, shuffledWords.length]);
 
   if (time <= 0 || (shuffledWords.length > 0 && idx >= shuffledWords.length)) {
      return (
         <div className="text-center w-full max-w-sm">
            <Timer className="w-20 h-20 text-rose-500 mx-auto mb-6" />
            <h2 className="text-4xl text-white font-bold mb-2">{time <= 0 ? 'Время вышло!' : 'Слова пройдены!'}</h2>
            <p className="text-slate-400 mb-12 text-lg">Ваш счет: <span className="text-emerald-400 font-bold">{score}</span></p>
            <button onClick={onFinish} className="bg-white text-slate-900 w-full py-4 rounded-full font-bold active:scale-95 transition-transform">Выход</button>
         </div>
      );
   }

   const word = shuffledWords[idx];
   if (!word) return null;

   return (
     <div className="w-full max-w-sm flex flex-col items-center">
        <div className="text-center mb-8 border-4 border-slate-700 w-24 h-24 flex items-center justify-center rounded-full"><span className={`text-4xl font-mono font-bold ${time <= 10 ? 'text-rose-500 animate-pulse' : 'text-white'}`}>{time}</span></div>
        <motion.div animate={flash === 'error' ? { x: [-10, 10, -10, 10, 0] } : {}} className={`w-full shadow-2xl bg-slate-800 rounded-3xl p-10 text-center border-2 ${flash === 'success' ? 'border-emerald-500 bg-emerald-500/10' : flash === 'error' ? 'border-rose-500 bg-rose-500/10' : 'border-slate-700'}`}>
           <h2 className="text-4xl font-black text-white">{word.original}</h2>
        </motion.div>
        <input autoFocus value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {
           if(e.key==='Enter') {
              const isCorrect = word.translations.some((t: any) => t.text.toLowerCase().includes(input.toLowerCase().trim()));
              onProgress(word.id, isCorrect);
              if (isCorrect) {
                 setScore(s=>s+100); 
                 setFlash('success'); 
                 setInput(''); 
                 setTimeout(()=>{setFlash(null);setIdx(c=>c+1);},200);
              } else { 
                 setFlash('error'); 
                 setTimeout(()=>setFlash(null),300);
                 setTimeout(()=>{setIdx(c=>c+1); setInput('');}, 300);
              }
           }
        }} placeholder="Впишите перевод..." className="w-full bg-slate-800 border border-slate-700 text-white text-center p-5 rounded-2xl text-2xl font-bold mt-8 outline-none focus:border-blue-500" />
     </div>
   );
}
