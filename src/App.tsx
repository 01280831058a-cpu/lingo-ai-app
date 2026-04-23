/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, PlayCircle, Settings, Plus, X, CheckCircle2, XCircle, 
  ArrowRight, Brain, Timer, Type, FlipHorizontal, Check, Loader2, 
  BookOpen, Trash2, FolderPlus, ArrowLeft, Edit3, XOctagon, Apple, AlertTriangle
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider, 
  signOut, deleteUser, User 
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// --- TYPES ---
export interface Example {
  text: string;
  translation: string;
}

export interface Word {
  id: string;
  original: string;
  translation: string;
  cambridgeTranslation: string;
  transcriptionUK: string;
  transcriptionUS: string;
  examples: Example[];
  groupIds: string[];
  createdAt: number;
  correctAnswers: number;
  incorrectAnswers: number;
  masteryLevel: number;
}

export interface Group {
  id: string;
  name: string;
}

export const LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate", "Upper-Intermediate", "Advanced"];

// --- API CLIENT ---
class ApiClient {
  static BASE_URL = '/.netlify/functions';

  static async aiGenerateWord(word: string, level?: string): Promise<Partial<Word>> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'translate', word, level })
      });
      if (!res.ok) throw new Error('API Error');
      return await res.json();
    } catch(e) {
      return { translation: `${word} (Ошибка ИИ)`, examples: [] };
    }
  }

  static async aiGenerateDistractors(word: string, correctTranslation: string): Promise<string[]> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'distractors', word, correctTranslation })
      });
      if (!res.ok) return ['Вариант 1', 'Вариант 2', 'Вариант 3'];
      return await res.json();
    } catch(e) {
      return ['Случайное', 'Ошибочный', 'Другой'];
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

// --- MAIN APP SHELL ---
export default function AppWrapper() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => setUser(u));
    return () => unsubscribe();
  }, []);

  const handleLoginGoogle = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } 
    catch (error: any) { alert("Ошибка Google: " + error.message); }
  };

  const handleLoginApple = async () => {
    try { await signInWithPopup(auth, new OAuthProvider('apple.com')); } 
    catch (error: any) { alert("Ошибка Apple: " + error.message); }
  };

  if (user === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5] text-stone-800 font-bold">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600 mr-2" />
    </div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F7F5]">
        <div className="bg-white/60 p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl border border-white/60 w-full max-w-sm flex flex-col items-center">
           <BookOpen className="w-16 h-16 text-teal-600 mb-6" />
           <h1 className="text-4xl font-black mb-2 text-center text-stone-800">ZenWords</h1>
           <p className="text-stone-500 text-center mb-10 text-sm">Погрузитесь в спокойное изучение языков.</p>
           
           <button onClick={handleLoginGoogle} className="w-full mb-4 py-4 bg-white border border-stone-100 text-stone-800 font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform">
             <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" /> Google
           </button>
           <button onClick={handleLoginApple} className="w-full py-4 bg-stone-900 text-white font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform">
             <Apple className="w-6 h-6" /> Apple ID
           </button>
        </div>
      </div>
    );
  }

  return <MainApp user={user} />;
}

function MainApp({ user }: { user: User }) {
  const [activeTab, setActiveTab] = useState<'dict' | 'groups' | 'train' | 'settings'>('dict');
  const [words, setWords] = useState<Word[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [userProfile, setUserProfile] = useState<{ level: string, onboarded: boolean } | null>(null);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);

  useEffect(() => {
    const wordsRef = collection(db, 'users', user.uid, 'words');
    const groupsRef = collection(db, 'users', user.uid, 'groups');
    const profileRef = doc(db, 'users', user.uid, 'profile', 'data');

    const unsubWords = onSnapshot(wordsRef, snap => setWords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Word))));
    const unsubGroups = onSnapshot(groupsRef, snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group))));
    const unsubProfile = onSnapshot(profileRef, snap => {
       if (snap.exists()) {
          setUserProfile(snap.data() as any);
       } else {
          setUserProfile({ level: 'Intermediate', onboarded: false });
       }
       setIsProfileLoaded(true);
    });

    return () => { unsubWords(); unsubGroups(); unsubProfile(); };
  }, [user.uid]);

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());

  const [showAddWord, setShowAddWord] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [viewingWordId, setViewingWordId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [showBulkAddGroup, setShowBulkAddGroup] = useState(false);

  const [activeTrainingMode, setActiveTrainingMode] = useState<'flashcards'|'quiz'|'sentence'|'timeattack'|'constructor'|'brainstorm'|'stats'|null>(null);
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });

  const getTrainingWords = () => {
    let selectedSet = new Set(selectedWordIds);
    words.forEach(w => {
      if (w.groupIds.some(id => selectedGroupIds.has(id))) selectedSet.add(w.id);
    });
    return Array.from(selectedSet).map(id => words.find(w => w.id === id)).filter(Boolean) as Word[];
  };

  const deleteWords = (ids: string[]) => {
    ids.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'words', id)).catch(console.error));
    const newSelected = new Set(selectedWordIds);
    ids.forEach(id => newSelected.delete(id));
    setSelectedWordIds(newSelected);
  };

  const handleDeleteAccount = async () => {
     if(window.confirm("Вы уверены? Это навсегда удалит ваш аккаунт и все слова.")) {
        try {
           await deleteUser(user);
        } catch(e: any) {
           alert("Необходимо перезайти в аккаунт перед удалением (в целях безопасности).");
           signOut(auth);
        }
     }
  };

  const handleUpdateProgress = (wordId: string, isCorrect: boolean, mode: string = 'general') => {
    setSessionStats(s => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    const word = words.find(w => w.id === wordId);
    if (!word) return;
    
    if (mode === 'sentence' && isCorrect) return; 

    const correctAnswers = word.correctAnswers + (isCorrect ? 1 : 0);
    const incorrectAnswers = word.incorrectAnswers + (!isCorrect ? 1 : 0);
    let masteryLevel = word.masteryLevel + (isCorrect ? 20 : -10);
    if (masteryLevel > 100) masteryLevel = 100;
    if (masteryLevel < 0) masteryLevel = 0;
    
    updateDoc(doc(db, 'users', user.uid, 'words', wordId), { correctAnswers, incorrectAnswers, masteryLevel }).catch(console.error);
  };

  const springConfig = { type: 'spring', stiffness: 150, damping: 25 };

  if (!isProfileLoaded) {
    return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5]"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  }

  // ОНБОРДИНГ
  if (userProfile && !userProfile.onboarded) {
    return <OnboardingModal user={user} onSave={(level: string) => {
       setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, onboarded: true }, { merge: true })
        .then(() => setUserProfile({ level, onboarded: true }))
        .catch(console.error);
    }} />;
  }

  return (
    <div className="min-h-screen bg-[#F7F7F5] font-sans text-stone-800 md:flex flex-row relative overflow-hidden">
      
      {/* DESKTOP SIDEBAR */}
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-white/70 backdrop-blur-xl border-r border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4 text-teal-600">
             <BookOpen className="w-8 h-8" /> <span className="text-2xl font-black text-stone-800">ZenWords</span>
          </div>
          <nav className="flex-1 space-y-2">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {/* MOBILE BOTTOM NAV */}
      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-white/70 backdrop-blur-xl border-t border-white/60 flex justify-around items-center px-2 z-40 pb-safe shadow-[0_-8px_30px_rgb(0,0,0,0.02)]">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-6 h-6" />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-6 h-6" />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-6 h-6" />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-6 h-6" />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      {/* MAIN CONTENT AREA */}
      <main className={`flex-1 flex flex-col h-screen overflow-y-auto ${!activeTrainingMode ? 'md:ml-64 pb-24 md:pb-0' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col">
          
          {!activeTrainingMode && !viewingGroupId && activeTab !== 'settings' && activeTab !== 'train' && (
            <div className="sticky top-0 z-30 bg-[#F7F7F5]/80 backdrop-blur-xl pt-12 md:pt-8 pb-4 px-4 md:px-8 border-b border-stone-200/50">
              <h1 className="text-3xl font-bold tracking-tight text-stone-800">
                {activeTab === 'dict' ? 'Ваш словарь' : 'Группы слов'}
              </h1>
            </div>
          )}

          {/* VIEWS */}
          <AnimatePresence mode="wait">
            {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
              <motion.div key="dict" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={springConfig} className="p-4 md:p-8 space-y-3 pb-32">
                {words.length > 0 && (
                  <div className="flex justify-between items-center px-1 mb-2">
                    <button onClick={() => {
                        if (selectedWordIds.size === words.length) setSelectedWordIds(new Set());
                        else setSelectedWordIds(new Set(words.map(w => w.id)));
                      }} 
                      className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"
                    >
                      <CheckCircle2 className="w-4 h-4"/> Выбрать все
                    </button>
                  </div>
                )}
                {words.length === 0 ? (
                  <div className="text-center text-stone-400 py-12">Нет добавленных слов. Нажмите +, чтобы добавить.</div>
                ) : (
                  words.map(word => (
                    <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                       <button onClick={() => {
                            const newSet = new Set(selectedWordIds);
                            newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id);
                            setSelectedWordIds(newSet);
                         }}
                         className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}
                       >
                         {selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}
                       </button>
                       <div className="flex-1 cursor-pointer" onClick={() => setViewingWordId(word.id)}>
                         <h3 className="text-lg font-bold text-stone-800">{word.original}</h3>
                         <p className="text-stone-500 text-sm mt-0.5">{word.translation}</p>
                         <MasteryBar masteryLevel={word.masteryLevel} />
                       </div>
                    </div>
                  ))
                )}

                <button onClick={() => setShowAddWord(true)} className="fixed bottom-24 md:bottom-8 right-5 md:right-8 w-14 h-14 bg-teal-600 text-white rounded-full shadow-[0_8px_30px_rgb(13,148,136,0.3)] flex items-center justify-center hover:bg-teal-700 active:scale-90 transition-all z-20">
                  <Plus className="w-6 h-6" />
                </button>

                <AnimatePresence>
                   {selectedWordIds.size > 0 && (
                      <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} transition={springConfig} className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-10 border border-stone-200/50 w-[90%] max-w-sm">
                         <button onClick={() => deleteWords(Array.from(selectedWordIds))} className="flex flex-col items-center p-2 text-orange-400 active:opacity-70 flex-1">
                            <Trash2 className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">Удалить</span>
                         </button>
                         <button onClick={() => setShowBulkAddGroup(true)} className="flex flex-col items-center p-2 text-sky-600 active:opacity-70 flex-1 border-l border-stone-100">
                            <FolderPlus className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">В группу</span>
                         </button>
                         <button onClick={() => { setActiveTab('train'); }} className="flex flex-col items-center p-2 text-teal-600 active:opacity-70 flex-1 border-l border-stone-100">
                            <PlayCircle className="w-5 h-5 mb-1 fill-teal-600/10" /> <span className="text-[10px] font-bold">Учить ({selectedWordIds.size})</span>
                         </button>
                      </motion.div>
                   )}
                </AnimatePresence>
              </motion.div>
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
              <motion.div key="groups" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={springConfig} className="p-4 md:p-8 space-y-3">
                 <button onClick={() => setShowAddGroup(true)} className="w-full bg-teal-50 border border-teal-100 text-teal-700 font-bold py-4 rounded-[2rem] flex items-center justify-center gap-2 mb-4 active:scale-95 transition-transform"><Plus className="w-5 h-5"/> Создать группу</button>
                 {groups.length === 0 ? (
                  <div className="text-center text-stone-400 py-12">Нет групп.</div>
                ) : (
                  groups.map(group => {
                    const count = words.filter(w => w.groupIds.includes(group.id)).length;
                    return (
                      <div key={group.id} onClick={() => setViewingGroupId(group.id)} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform">
                          <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center shrink-0">
                            <Layers className="w-6 h-6 text-sky-600" />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-stone-800">{group.name}</h3>
                            <p className="text-stone-500 text-sm mt-0.5">{count} элементов</p>
                          </div>
                          <ArrowRight className="w-5 h-5 text-stone-300 shrink-0" />
                      </div>
                    )
                  })
                )}
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
                 selectedWordIds={selectedWordIds}
                 setSelectedWordIds={setSelectedWordIds}
                 onTrain={() => setActiveTab('train')}
               />
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
              <motion.div key="train" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springConfig} className="p-4 md:p-8 pt-12 md:pt-8">
                <h1 className="text-3xl font-bold tracking-tight mb-6 text-stone-800">Тренировка</h1>
                
                {getTrainingWords().length === 0 ? (
                   <div className="mb-8">
                      <p className="text-stone-500 mb-4">Выберите базу для тренировки:</p>
                      <div className="space-y-3">
                         <button onClick={() => setSelectedWordIds(new Set(words.map(w => w.id)))} className="w-full bg-teal-50 p-5 rounded-[2rem] shadow-sm border border-teal-100 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between text-teal-700">
                            <span>Весь словарь</span> <span className="font-normal opacity-70">{words.length} слов</span>
                         </button>
                         {groups.map(group => {
                            const count = words.filter(w => w.groupIds.includes(group.id)).length;
                            return (
                               <button key={group.id} onClick={() => setSelectedGroupIds(new Set([group.id]))} className="w-full bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between">
                                  <span>{group.name}</span> <span className="text-stone-400 font-normal">{count} слов</span>
                               </button>
                            )
                         })}
                      </div>
                   </div>
                ) : (
                   <>
                      <div className="flex items-center justify-between mb-8 bg-white/50 p-4 rounded-2xl border border-white/60">
                         <p className="text-stone-600 font-medium">Выбрано: <span className="font-black text-stone-900">{getTrainingWords().length}</span></p>
                         <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-stone-400 font-bold text-sm bg-stone-200/50 px-4 py-2 rounded-xl active:scale-95 transition-transform">Изменить</button>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <TrainCard title="Карточки" desc="Базовое запоминание" icon={<FlipHorizontal />} color="text-sky-600" bg="bg-sky-50" onClick={() => { setActiveTrainingMode('flashcards'); setSessionStats({correct:0, total:0}); }} />
                        <TrainCard title="Викторина" desc="Тест вариантов" icon={<CheckCircle2 />} color="text-teal-600" bg="bg-teal-50" onClick={() => { setActiveTrainingMode('quiz'); setSessionStats({correct:0, total:0}); }} />
                        <TrainCard title="Конструктор" desc="Собери слово" icon={<Layers />} color="text-orange-500" bg="bg-orange-50" onClick={() => { setActiveTrainingMode('constructor'); setSessionStats({correct:0, total:0}); }} />
                        <TrainCard title="Фразы" desc="Свой контекст" icon={<Type />} color="text-indigo-500" bg="bg-indigo-50" onClick={() => { setActiveTrainingMode('sentence'); setSessionStats({correct:0, total:0}); }} />
                        <TrainCard title="Брейншторм" desc="Комбо-режим" icon={<Brain />} color="text-purple-500" bg="bg-purple-50" className="col-span-2" onClick={() => { setActiveTrainingMode('brainstorm'); setSessionStats({correct:0, total:0}); }} />
                      </div>
                   </>
                )}
              </motion.div>
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={springConfig} className="p-4 md:p-8 pt-12 md:pt-8 flex flex-col justify-between h-full">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight mb-8 text-stone-800">Настройки</h1>
                  <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 mb-6">
                     <div className="font-bold text-lg text-stone-800 mb-1">{user?.displayName || 'Пользователь'}</div>
                     <div className="text-stone-500 text-sm mb-6">{user?.email}</div>

                     <div className="border-t border-stone-100 pt-6">
                        <h3 className="font-bold text-stone-800 mb-4">Уровень языка</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {LEVELS.map((lvl) => (
                            <button key={lvl} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...userProfile, level: lvl }, { merge: true })}
                              className={`py-3 text-xs font-bold rounded-xl transition-all ${userProfile?.level === lvl ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'}`}
                            >{lvl}</button>
                          ))}
                        </div>
                     </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <button onClick={() => signOut(auth)} className="w-full py-4 bg-stone-200/50 text-stone-700 font-bold rounded-2xl active:scale-95 transition-transform">Выйти</button>
                  <button onClick={handleDeleteAccount} className="w-full py-4 bg-orange-50 text-orange-500 font-bold rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"><AlertTriangle className="w-4 h-4"/> Удалить аккаунт</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* MODALS */}
          <AnimatePresence>
            {showAddWord && (
              <AddWordModal userProfile={userProfile} onClose={() => setShowAddWord(false)} onSave={(newWord: any) => { 
                    const id = doc(collection(db, 'users', user.uid, 'words')).id;
                    setDoc(doc(db, 'users', user.uid, 'words', id), { ...newWord, id, createdAt: Date.now(), correctAnswers: 0, incorrectAnswers: 0, masteryLevel: 0 })
                      .catch(console.error);
                    setShowAddWord(false); 
                }}
              />
            )}
            {showAddGroup && (
               <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(name: string) => {
                    const id = doc(collection(db, 'users', user.uid, 'groups')).id;
                    setDoc(doc(db, 'users', user.uid, 'groups', id), { id, name }).catch(console.error);
                    setShowAddGroup(false);
                  }}
               />
            )}
            {viewingWordId && (
               <WordEditorModal 
                  word={words.find(w => w.id === viewingWordId)!} groups={groups} userProfile={userProfile}
                  onClose={() => setViewingWordId(null)}
                  onSave={(updatedWord: any) => { updateDoc(doc(db, 'users', user.uid, 'words', updatedWord.id), updatedWord).catch(console.error); setViewingWordId(null); }}
                  onDelete={() => { deleteWords([viewingWordId]); setViewingWordId(null); }}
               />
            )}
            {showBulkAddGroup && (
               <BulkAddGroupModal groups={groups} onClose={() => setShowBulkAddGroup(false)} onSave={(groupId: string) => {
                     words.forEach(w => { if (selectedWordIds.has(w.id) && !w.groupIds.includes(groupId)) updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: [...w.groupIds, groupId] }).catch(console.error); });
                     setShowBulkAddGroup(false); setSelectedWordIds(new Set());
                  }}
               />
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* TRAINING OVERLAY */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div initial={{ opacity: 0, y: '10%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '10%' }} transition={springConfig} className="fixed inset-0 bg-[#F7F7F5] z-50 flex flex-col">
               <div className="flex justify-between items-center p-4 md:p-8 bg-white/70 backdrop-blur-xl border-b border-stone-200/50">
                  <span className="font-bold text-stone-800 tracking-tight capitalize">{activeTrainingMode === 'stats' ? 'Результаты' : activeTrainingMode}</span>
                  <button onClick={() => setActiveTrainingMode(null)} className="p-2 bg-stone-100 rounded-full hover:bg-stone-200 active:scale-95 transition-all"><X className="w-5 h-5 text-stone-600" /></button>
               </div>
               <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center">
                  {activeTrainingMode === 'stats' ? (
                     <SessionStats stats={sessionStats} onClose={() => setActiveTrainingMode(null)} />
                  ) : (
                     <div className="w-full max-w-sm">
                        {activeTrainingMode === 'flashcards' && <ModeFlashcards words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'quiz' && <ModeQuiz words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'constructor' && <ModeConstructor words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'sentence' && <ModeSentence words={getTrainingWords()} onProgress={(w: string, c: boolean) => handleUpdateProgress(w, c, 'sentence')} onFinish={() => setActiveTrainingMode('stats')} />}
                        {activeTrainingMode === 'brainstorm' && <ModeBrainstorm words={getTrainingWords()} onProgress={handleUpdateProgress} onFinish={() => setActiveTrainingMode('stats')} />}
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
// UI COMPONENTS
// =========================================================================

function SidebarItem({ active, icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex items-center w-full px-4 py-4 gap-3 rounded-2xl transition-colors ${active ? 'text-teal-700 bg-teal-50 font-bold' : 'text-stone-500 hover:bg-stone-100 font-medium'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-6 h-6" })}</div>
      <span>{label}</span>
    </button>
  );
}

function NavItem({ active, icon, label, onClick }: any) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center flex-1 py-1 gap-1 transition-colors ${active ? 'text-teal-600 font-bold' : 'text-stone-400 font-medium'}`}>
      <div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{icon}</div>
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

function MasteryBar({ masteryLevel }: { masteryLevel: number }) {
   let color = 'bg-orange-400';
   if (masteryLevel > 30) color = 'bg-sky-400';
   if (masteryLevel > 70) color = 'bg-teal-500';
   return (
      <div className="mt-3 w-full bg-stone-100 rounded-full h-1 overflow-hidden">
         <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${masteryLevel}%` }} />
      </div>
   );
}

function TrainCard({ title, desc, icon, color, bg, className="", onClick }: any) {
  return (
    <div onClick={onClick} className={`bg-white p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 flex flex-col gap-4 active:scale-95 transition-transform cursor-pointer ${className}`}>
      <div className={`w-14 h-14 rounded-2xl ${bg} flex items-center justify-center`}>{React.cloneElement(icon, { className: `w-7 h-7 ${color}` })}</div>
      <div>
         <div className="font-bold text-stone-800 text-lg">{title}</div>
         <div className="text-xs text-stone-400 font-medium">{desc}</div>
      </div>
    </div>
  );
}

// =========================================================================
// MODALS & VIEWS
// =========================================================================

function OnboardingModal({ user, onSave }: any) {
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState('Intermediate');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{type:'spring', stiffness: 200, damping: 25}} className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-[0_20px_60px_rgb(0,0,0,0.1)]">
         <div className="p-8">
            <h2 className="text-3xl font-black mb-6 text-stone-800">Привет, {user?.displayName?.split(' ')[0] || 'студент'}! 🌿</h2>
            
            {step === 0 && (
               <div className="space-y-6">
                  <p className="text-stone-500 mb-4">Добро пожаловать в ZenWords. Здесь обучение происходит спокойно и эффективно.</p>
                  <div className="space-y-4">
                     <div className="flex items-start gap-4"><div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-600 shrink-0"><BookOpen className="w-5 h-5"/></div><div><h3 className="font-bold text-stone-800">Умный словарь ИИ</h3><p className="text-stone-500 text-sm">Транскрипции, переводы из Cambridge и точные примеры.</p></div></div>
                     <div className="flex items-start gap-4"><div className="w-10 h-10 rounded-2xl bg-sky-50 flex items-center justify-center text-sky-600 shrink-0"><Layers className="w-5 h-5"/></div><div><h3 className="font-bold text-stone-800">Конструктор и Брейншторм</h3><p className="text-stone-500 text-sm">Новые режимы для тренировки правописания и глубокого запоминания.</p></div></div>
                  </div>
               </div>
            )}

            {step === 1 && (
               <div>
                  <h3 className="font-bold text-xl mb-4 text-stone-800">Ваш текущий уровень?</h3>
                  <p className="text-stone-500 text-sm mb-6">Это настроит сложность ИИ-примеров.</p>
                  <div className="grid grid-cols-2 gap-3">
                     {LEVELS.map(l => (
                        <button key={l} onClick={() => setLevel(l)} className={`p-4 rounded-2xl border-2 font-bold text-center transition-colors text-sm ${level === l ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-stone-100 text-stone-500'}`}>{l}</button>
                     ))}
                  </div>
               </div>
            )}
         </div>

         <div className="p-6 bg-stone-50 border-t border-stone-100 flex gap-3">
            {step === 1 && <button onClick={() => setStep(0)} className="px-6 bg-stone-200 text-stone-600 font-bold rounded-2xl">Назад</button>}
            <button onClick={() => { if (step === 0) setStep(1); else onSave(level); }} className="flex-1 bg-teal-600 text-white font-bold py-4 rounded-2xl active:scale-95 transition-transform shadow-[0_8px_20px_rgb(13,148,136,0.2)]">
               {step === 0 ? 'Продолжить' : 'Начать путь'}
            </button>
         </div>
      </motion.div>
    </motion.div>
  );
}

function AddWordModal({ userProfile, onClose, onSave }: any) {
  const [original, setOriginal] = useState('');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done'>('idle');
  const [wordData, setWordData] = useState<Partial<Word>>({});

  const handleAnalyze = async () => {
    if (!original.trim()) return;
    setStatus('analyzing');
    const result = await ApiClient.aiGenerateWord(original, userProfile?.level);
    setWordData(result);
    setStatus('done');
  };

  return (
    <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[60] flex flex-col justify-end">
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{type:'spring', stiffness: 200, damping: 25}} className="bg-white w-full rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] mx-auto max-w-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-stone-800">Новое слово</h2>
          <button onClick={onClose} className="p-2 bg-stone-100 rounded-full"><X className="w-5 h-5 text-stone-600" /></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
          <div className="relative">
            <input autoFocus placeholder="Введите слово..." value={original} onChange={e => setOriginal(e.target.value)} disabled={status !== 'idle'} className="w-full bg-stone-50 px-6 py-5 rounded-[2rem] text-lg font-bold border border-stone-200 outline-none focus:border-teal-500 transition-colors" />
          </div>

          {status === 'idle' && (
            <button onClick={handleAnalyze} disabled={!original.trim()} className="w-full py-5 bg-teal-600 text-white font-bold rounded-[2rem] flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50">
              Добавить в словарь
            </button>
          )}

          {status === 'analyzing' && (
            <div className="py-12 flex flex-col items-center justify-center text-stone-500 space-y-4">
               <Loader2 className="w-8 h-8 animate-spin text-teal-600" /> <span className="font-medium">Изучаем контекст...</span>
            </div>
          )}

          {status === 'done' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
               <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                  <div className="text-center mb-4">
                    <h3 className="text-2xl font-black text-stone-800">{original}</h3>
                    <div className="flex justify-center gap-4 text-sm font-medium text-stone-400 mt-2">
                        <span>UK: {wordData.transcriptionUK}</span> <span>US: {wordData.transcriptionUS}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mt-6">
                     <div className="font-bold text-stone-800 text-2xl text-center">{wordData.translation}</div>
                     <div className="text-stone-600 text-center text-sm">{wordData.cambridgeTranslation}</div>
                  </div>

                  {wordData.examples && wordData.examples.map((ex, i) => (
                     <div key={i} className="mt-6 p-5 bg-teal-50 border border-teal-100 rounded-2xl">
                        <div className="font-medium text-teal-900 mb-1">{ex.text}</div>
                        <div className="text-sm text-teal-700/80">{ex.translation}</div>
                     </div>
                  ))}
               </div>
               
               <button onClick={() => onSave({ original, ...wordData, groupIds: [] })} className="w-full py-5 mt-4 bg-stone-900 text-white font-bold rounded-[2rem] active:scale-95 transition-transform">
                 Сохранить
               </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AddGroupModal({ onClose, onSave }: any) {
   const [name, setName] = useState('');
   return (
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl">
           <h2 className="text-xl font-bold mb-4 text-stone-800">Новая группа</h2>
           <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Название группы" className="w-full bg-stone-50 px-4 py-4 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 transition-colors" />
           <div className="mt-6 flex gap-3">
              <button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:bg-stone-200">Отмена</button>
              <button onClick={() => name && onSave(name)} className="flex-1 py-4 bg-teal-600 text-white font-bold rounded-2xl active:bg-teal-700 disabled:opacity-50" disabled={!name}>Создать</button>
           </div>
        </motion.div>
      </div>
   );
}

function BulkAddGroupModal({ groups, onClose, onSave }: any) {
   return (
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-50 flex flex-col justify-end max-w-md mx-auto">
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full rounded-t-[2rem] p-6 pb-12 shadow-2xl">
           <div className="flex justify-between items-center mb-4">
               <h2 className="text-xl font-bold text-stone-800">Добавить в группу</h2>
               <button onClick={onClose} className="p-2 bg-stone-100 text-stone-500 rounded-full"><X className="w-5 h-5"/></button>
           </div>
           <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {groups.length === 0 ? <p className="text-stone-500 text-sm">Сначала создайте группу во вкладке "Группы".</p> : null}
              {groups.map((g: Group) => (
                 <button key={g.id} onClick={() => onSave(g.id)} className="w-full text-left p-4 bg-stone-50 rounded-2xl font-medium active:bg-stone-100 flex items-center justify-between text-stone-800">
                    {g.name} <Plus className="w-5 h-5 text-teal-600"/>
                 </button>
              ))}
           </div>
        </motion.div>
      </div>
   );
}

function WordEditorModal({ word, groups, onClose, onSave, onDelete, userProfile }: any) {
   return (
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[100] flex flex-col justify-end max-w-md mx-auto">
         <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 25 }} className="bg-white w-full rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-6">
               <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2"><Edit3 className="w-5 h-5 text-teal-600"/> Данные слова</h2>
               <div className="flex items-center gap-2">
                  <button onClick={onDelete} className="p-2 bg-orange-50 text-orange-500 rounded-full mr-2"><Trash2 className="w-5 h-5" /></button>
                  <button onClick={onClose} className="p-2 bg-stone-100 rounded-full"><X className="w-5 h-5 text-stone-500" /></button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
               <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                  <div className="text-center mb-4">
                    <h3 className="text-2xl font-black text-stone-800">{word.original}</h3>
                    <div className="flex justify-center gap-4 text-sm font-medium text-stone-400 mt-2">
                        <span>UK: {word.transcriptionUK}</span> <span>US: {word.transcriptionUS}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-3 mt-6">
                     <div className="font-bold text-stone-800 text-2xl text-center">{word.translation}</div>
                     <div className="text-stone-600 text-center text-sm">{word.cambridgeTranslation}</div>
                  </div>

                  {word.examples && word.examples.map((ex: any, i: number) => (
                     <div key={i} className="mt-6 p-5 bg-teal-50 border border-teal-100 rounded-2xl">
                        <div className="font-medium text-teal-900 mb-1">{ex.text}</div>
                        <div className="text-sm text-teal-700/80">{ex.translation}</div>
                     </div>
                  ))}
               </div>
            </div>
         </motion.div>
      </div>
   );
}

function GroupView({ group, words, onClose, onRemoveFromGroup, selectedWordIds, setSelectedWordIds, onTrain }: any) {
   return (
      <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 50 }} className="absolute inset-0 z-20 bg-[#F7F7F5] flex flex-col pb-24 top-0 pt-12 md:pt-8">
         <div className="flex items-center px-4 md:px-8 pb-4 border-b border-stone-200/50 sticky top-0 z-10 bg-[#F7F7F5]/80 backdrop-blur-xl">
            <button onClick={onClose} className="p-2 -ml-2 text-stone-500 active:bg-stone-200 rounded-full"><ArrowLeft className="w-6 h-6" /></button>
            <div className="flex-1 ml-2">
               <h2 className="text-xl font-bold text-stone-800">{group.name}</h2>
               <p className="text-stone-500 text-sm">{words.length} элементов</p>
            </div>
         </div>
         <div className="p-4 md:p-8 space-y-3 overflow-auto flex-1">
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
                  className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"
                >
                  <CheckCircle2 className="w-4 h-4"/> Выбрать все в группе
                </button>
              </div>
            )}
            {words.length === 0 ? (
               <div className="text-center text-stone-400 p-8">В этой группе пока нет слов.</div>
            ) : (
               words.map((word: Word) => (
                  <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                     <button 
                       onClick={() => {
                          const newSet = new Set(selectedWordIds);
                          newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id);
                          setSelectedWordIds(newSet);
                       }}
                       className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}
                     >
                       {selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}
                     </button>
                     <div className="flex-1 cursor-pointer">
                        <h3 className="text-lg font-bold text-stone-800">{word.original}</h3>
                        <p className="text-stone-500 text-sm line-clamp-1">{word.translation}</p>
                        <MasteryBar masteryLevel={word.masteryLevel} />
                     </div>
                     <button onClick={() => onRemoveFromGroup(word.id)} className="p-2 text-stone-400 hover:text-orange-500 bg-stone-50 rounded-full shrink-0">
                        <X className="w-5 h-5"/>
                     </button>
                  </div>
               ))
            )}
         </div>

         <AnimatePresence>
            {selectedWordIds.size > 0 && words.some((w: Word) => selectedWordIds.has(w.id)) && (
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-30 border border-stone-200/50 w-[90%] max-w-sm">
                  <button onClick={() => {
                     words.forEach((w: Word) => {
                        if (selectedWordIds.has(w.id)) onRemoveFromGroup(w.id);
                     });
                     const newSet = new Set(selectedWordIds);
                     words.forEach((w: Word) => newSet.delete(w.id));
                     setSelectedWordIds(newSet);
                  }} className="flex flex-col items-center p-2 text-orange-400 active:opacity-70 flex-1">
                     <Trash2 className="w-5 h-5 mb-1" />
                     <span className="text-[10px] font-bold">Удалить из группы</span>
                  </button>
                  <button onClick={onTrain} className="flex flex-col items-center p-2 text-teal-600 active:opacity-70 border-l border-stone-100 flex-1">
                     <PlayCircle className="w-5 h-5 mb-1 fill-teal-600/10" />
                     <span className="text-[10px] font-bold">Учить ({selectedWordIds.size})</span>
                  </button>
               </motion.div>
            )}
         </AnimatePresence>
      </motion.div>
   );
}

// =========================================================================
// NEW TRAINING MODES
// =========================================================================

function SessionStats({ stats, onClose }: any) {
   const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
   return (
      <div className="w-full text-center flex flex-col items-center">
         <div className="bg-white rounded-[2rem] p-10 w-full shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 mb-8">
            <div className="text-6xl font-black text-teal-600 mb-2">{accuracy}%</div>
            <div className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Точность</div>
            <div className="flex justify-around text-lg font-bold">
               <div className="flex flex-col"><span className="text-teal-500 text-2xl">{stats.correct}</span><span className="text-stone-400 text-xs uppercase">Верно</span></div>
               <div className="flex flex-col"><span className="text-orange-400 text-2xl">{stats.total - stats.correct}</span><span className="text-stone-400 text-xs uppercase">Ошибок</span></div>
            </div>
         </div>
         <button onClick={onClose} className="w-full bg-teal-600 text-white font-bold py-5 rounded-[2rem] shadow-[0_8px_20px_rgb(13,148,136,0.3)]">Завершить</button>
      </div>
   );
}

function ModeConstructor({ words, onProgress, onFinish }: any) {
   const [idx, setIdx] = useState(0);
   const [letters, setLetters] = useState<{id:number, char:string}[]>([]);
   const [answer, setAnswer] = useState<{id:number, char:string}[]>([]);
   
   const word = words[idx];

   useEffect(() => {
      if(!word) return;
      const chars = word.original.split('').map((char:string, i:number) => ({ id: i, char }));
      setLetters(chars.sort(() => Math.random() - 0.5));
      setAnswer([]);
   }, [word]);

   if (!word) return null;

   const handlePick = (item: any) => {
      setLetters(letters.filter(l => l.id !== item.id));
      const newAnswer = [...answer, item];
      setAnswer(newAnswer);

      if (newAnswer.length === word.original.length) {
         const isCorrect = newAnswer.map(a => a.char).join('') === word.original;
         onProgress(word.id, isCorrect);
         setTimeout(() => { if (idx >= words.length - 1) onFinish(); else setIdx(c => c + 1); }, 1000);
      }
   };

   const isFull = answer.length === word.original.length;
   const isCorrect = answer.map(a => a.char).join('') === word.original;

   return (
      <div className="w-full flex flex-col items-center">
         <span className="text-stone-400 font-bold mb-8">{idx + 1} / {words.length}</span>
         <div className="text-xl font-bold text-stone-500 mb-8">{word.translation}</div>
         
         <div className={`flex flex-wrap justify-center gap-2 mb-12 min-h-[60px] p-4 rounded-3xl ${isFull ? (isCorrect ? 'bg-teal-50 border-teal-200 border' : 'bg-orange-50 border-orange-200 border') : 'bg-white border-2 border-dashed border-stone-200'}`}>
            {answer.map(a => (
               <motion.div layoutId={`char-${a.id}`} key={a.id} className={`w-10 h-12 flex items-center justify-center font-bold text-xl rounded-xl text-white ${isFull ? (isCorrect ? 'bg-teal-500' : 'bg-orange-400') : 'bg-stone-800'}`}>
                  {a.char}
               </motion.div>
            ))}
         </div>

         <div className="flex flex-wrap justify-center gap-2">
            {letters.map(l => (
               <motion.div layoutId={`char-${l.id}`} key={l.id} onClick={() => handlePick(l)} className="w-12 h-14 bg-white border border-stone-200 shadow-sm flex items-center justify-center font-bold text-xl rounded-xl text-stone-800 cursor-pointer active:scale-90">
                  {l.char}
               </motion.div>
            ))}
         </div>
      </div>
   );
}

function ModeBrainstorm({ words, onProgress, onFinish }: any) {
   const [phase, setPhase] = useState<1|2|3>(1);
   const [pool, setPool] = useState<any[]>(words);
   const [selected, setSelected] = useState<Set<string>>(new Set());

   if (phase === 1) {
      return (
         <div className="w-full">
            <h2 className="text-2xl font-black text-stone-800 mb-2">Брейншторм</h2>
            <p className="text-stone-500 mb-6">Выберите слова, которые хотите прогнать через усиленный цикл тренировки.</p>
            <div className="space-y-2 mb-8 max-h-[50vh] overflow-y-auto">
               {pool.map(w => (
                  <div key={w.id} onClick={() => { const s=new Set(selected); s.has(w.id)?s.delete(w.id):s.add(w.id); setSelected(s); }} className={`p-4 rounded-2xl flex justify-between font-bold cursor-pointer transition-colors ${selected.has(w.id) ? 'bg-purple-100 text-purple-700' : 'bg-white text-stone-700'}`}>
                     {w.original} {selected.has(w.id) && <Check className="w-5 h-5"/>}
                  </div>
               ))}
            </div>
            <button onClick={() => { if(selected.size>0) setPhase(2); else alert('Выберите слова'); }} className="w-full bg-purple-600 text-white font-bold py-5 rounded-[2rem]">Начать цикл ({selected.size})</button>
         </div>
      );
   }

   const activeWords = words.filter((w:any) => selected.has(w.id));

   if (phase === 2) {
      return (
         <div className="w-full text-center">
            <h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Этап 1: Карточки</h3>
            <ModeFlashcards words={activeWords} onProgress={()=>{}} onFinish={() => setPhase(3)} />
         </div>
      );
   }

   if (phase === 3) {
      return (
         <div className="w-full text-center">
            <h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Этап 2: Правописание</h3>
            <ModeConstructor words={activeWords} onProgress={onProgress} onFinish={onFinish} />
         </div>
      );
   }

   return null;
}

function ModeFlashcards({ words, onProgress, onFinish }: any) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const word = words[currentIndex];

  const handleAnswer = (isCorrect: boolean) => {
    onProgress(word.id, isCorrect);
    if (currentIndex >= words.length - 1) onFinish();
    else { setIsFlipped(false); setTimeout(() => setCurrentIndex(c => c + 1), 150); }
  };

  if (!word) return null;
  return (
    <div className="w-full flex flex-col items-center">
      <span className="text-stone-400 font-bold mb-8">{currentIndex + 1} / {words.length}</span>
      <div className="w-full h-96 relative cursor-pointer perspective-1000" onClick={() => setIsFlipped(!isFlipped)}>
         <motion.div animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 100, damping: 20 }} className="w-full h-full relative [transform-style:preserve-3d]">
            <div className="absolute inset-0 [backface-visibility:hidden] bg-white rounded-[2rem] shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 flex flex-col items-center justify-center p-8 text-center">
               <h2 className="text-4xl font-black text-stone-800">{word.original}</h2>
               <div className="text-stone-400 mt-4 font-medium">[{word.transcriptionUK}]</div>
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-teal-600 rounded-[2rem] shadow-[0_10px_40px_rgb(13,148,136,0.2)] flex flex-col items-center justify-center p-8 text-center text-white">
               <h2 className="text-3xl font-bold mb-2">{word.translation}</h2>
               <p className="text-teal-100/80 text-sm mb-4">{word.cambridgeTranslation}</p>
               {word.examples?.[0] && <p className="italic text-teal-50 bg-black/10 p-3 rounded-xl text-sm">"{word.examples[0].text}"</p>}
            </div>
         </motion.div>
      </div>
      <div className="mt-12 w-full flex gap-4">
         <button onClick={() => handleAnswer(false)} className="flex-1 py-5 bg-orange-50 text-orange-500 font-bold rounded-2xl active:scale-95 transition-transform">Не помню</button>
         <button onClick={() => handleAnswer(true)} className="flex-1 py-5 bg-teal-50 text-teal-600 font-bold rounded-2xl active:scale-95 transition-transform">Вспомнил</button>
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
      const c = word.translation || '';
      setCorrect(c);
      const dist = await ApiClient.aiGenerateDistractors(word.original, c);
      setOptions([...dist, c].sort(() => Math.random() - 0.5));
    };
    load();
  }, [word]);

  if (!word) return null;
  return (
    <div className="w-full max-w-sm flex flex-col">
       <span className="text-stone-400 font-medium text-center mb-8">{currentIndex + 1} / {words.length}</span>
       <div className="bg-white rounded-[2rem] p-8 text-center mb-8 border border-stone-100 shadow-sm">
          <h2 className="text-3xl font-black text-stone-800">{word.original}</h2>
       </div>
       {options.length === 0 ? (
          <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-teal-600"/></div>
       ) : (
          <div className="space-y-3">
             {options.map((opt, i) => {
                let stateClass = "bg-white text-stone-800 border-stone-200";
                if (ansIdx !== null) {
                   if (opt === correct) stateClass = "bg-teal-500 text-white border-transparent";
                   else if (i === ansIdx) stateClass = "bg-orange-400 text-white border-transparent";
                   else stateClass = "bg-white/50 text-stone-400 opacity-50";
                }
                return (
                  <button key={i} onClick={() => { 
                      if(ansIdx===null) { 
                         setAnsIdx(i); 
                         onProgress(word.id, opt === correct);
                         setTimeout(() => { if(currentIndex >= words.length-1) onFinish(); else setCurrentIndex(c=>c+1); }, 1500) 
                      } 
                   }} className={`w-full p-5 rounded-2xl border font-bold text-lg active:scale-[0.98] transition-all shadow-sm ${stateClass}`}>
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
     <div className="w-full flex flex-col h-[80vh]">
        <div className="flex-1">
          <span className="text-stone-400 font-bold text-center block mb-6">{currentIndex + 1} / {words.length}</span>
          <div className="bg-white rounded-[2rem] p-8 mb-6 shadow-sm border border-stone-100 text-center">
            <h2 className="text-3xl font-black text-stone-800 mb-2">{word.original}</h2>
            <p className="text-stone-400 font-medium">{word.translation}</p>
          </div>
          <textarea autoFocus value={input} onChange={e => { setInput(e.target.value); setStatus('idle'); }} placeholder="Составьте предложение с этим словом..." disabled={status === 'checking' || status === 'correct'} className="w-full bg-stone-50 border border-stone-200 focus:border-teal-500 text-stone-800 p-6 rounded-[2rem] min-h-[140px] outline-none font-medium resize-none" />
          
          {status !== 'idle' && status !== 'checking' && (
             <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`mt-4 p-5 rounded-2xl flex gap-3 ${status === 'correct' ? 'bg-teal-50 text-teal-700' : 'bg-orange-50 text-orange-600'}`}>
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
             }} disabled={!input} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[2rem] flex gap-2 justify-center shadow-[0_8px_20px_rgb(79,70,229,0.2)]"><Brain className="w-5 h-5"/> Проверить ИИ</button>}
           {status === 'checking' && <div className="w-full bg-stone-100 text-stone-500 font-bold py-5 rounded-[2rem] flex justify-center"><Loader2 className="animate-spin w-5 h-5" /> Анализируем...</div>}
           {(status === 'correct' || status === 'incorrect') && <button onClick={() => { if(currentIndex >= words.length-1) onFinish(); else { setCurrentIndex(c=>c+1); setInput(''); setStatus('idle'); } }} className="w-full bg-stone-800 text-white font-bold py-5 rounded-[2rem]">Продолжить <ArrowRight className="w-5 h-5 inline"/></button>}
        </div>
     </div>
   );
 }
