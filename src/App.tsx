/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers, PlayCircle, Settings, Plus, X, CheckCircle2, XCircle, 
  ArrowRight, Brain, Timer, Type, FlipHorizontal, Check, Loader2, 
  BookOpen, Trash2, FolderPlus, ArrowLeft, Edit3, XOctagon, AlertTriangle, RefreshCw,
  LogOut
} from 'lucide-react';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider, 
  signOut, deleteUser, User 
} from 'firebase/auth';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';

export interface Example { text: string; translation: string; }
export interface Word {
  id: string; original: string; translation: string; cambridgeTranslation: string;
  transcriptionUK: string; transcriptionUS: string; examples: Example[];
  groupIds: string[]; createdAt: number; correctAnswers: number;
  incorrectAnswers: number; masteryLevel: number;
}
export interface Group { id: string; name: string; }
export const LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate", "Upper-Intermediate", "Advanced"];

class ApiClient {
  static BASE_URL = '/.netlify/functions';

  static async aiGenerateWord(word: string, level?: string): Promise<Partial<Word>> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'translate', word, level }) });
      if (!res.ok) throw new Error('API Error'); return await res.json();
    } catch(e) { return { translation: `${word} (Ошибка ИИ)`, examples: [] }; }
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
    } catch(e) { return { isCorrect: false, feedback: 'Ошибка сети при проверке.' }; }
  }

  static async aiRegenerateExample(word: string, level?: string): Promise<Example> {
    try {
      const res = await fetch(`${this.BASE_URL}/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'example', word, level }) });
      if (!res.ok) throw new Error('API Error'); return await res.json();
    } catch(e) { return { text: "Network error", translation: "Ошибка сети" }; }
  }
}

export default function AppWrapper() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, u => setUser(u)), []);

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5]"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F7F7F5]">
        <div className="bg-white/60 p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl border border-white/60 w-full max-w-sm flex flex-col items-center">
           <BookOpen className="w-16 h-16 text-teal-600 mb-6" />
           <h1 className="text-4xl font-black mb-2 text-center text-stone-800">Words</h1>
           <p className="text-stone-500 text-center mb-10 text-sm">Умный словарь с ИИ и дзен-дизайном.</p>
           <button onClick={() => signInWithPopup(auth, new GoogleAuthProvider()).catch(e=>alert(e.message))} className="w-full mb-4 py-4 bg-white border border-stone-100 text-stone-800 font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform"><img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="G" /> Google</button>
           <button onClick={() => signInWithPopup(auth, new OAuthProvider('apple.com')).catch(e=>alert(e.message))} className="w-full py-4 bg-stone-900 text-white font-bold rounded-2xl shadow-sm flex items-center justify-center gap-3 active:scale-95 transition-transform"><svg viewBox="0 0 384 512" className="w-5 h-5 fill-current"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg> Apple ID</button>
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
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    const unsubWords = onSnapshot(collection(db, 'users', user.uid, 'words'), snap => setWords(snap.docs.map(d => ({ id: d.id, ...d.data() } as Word))));
    const unsubGroups = onSnapshot(collection(db, 'users', user.uid, 'groups'), snap => setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() } as Group))));
    const unsubProfile = onSnapshot(doc(db, 'users', user.uid, 'profile', 'data'), snap => {
       if (snap.exists()) setUserProfile(snap.data() as any); else setUserProfile({ level: 'Intermediate', onboarded: false });
       setIsDataLoaded(true);
    });
    return () => { unsubWords(); unsubGroups(); unsubProfile(); };
  }, [user.uid]);

  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  
  // Модалки
  const [showAddWord, setShowAddWord] = useState(false);
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [viewingWordId, setViewingWordId] = useState<string | null>(null);
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null);
  const [showBulkAddGroup, setShowBulkAddGroup] = useState(false);
  const [showSmartSelection, setShowSmartSelection] = useState(false);
  
  const [activeTrainingMode, setActiveTrainingMode] = useState<'flashcards'|'quiz'|'sentence'|'constructor'|'brainstorm'|'stats'|null>(null);
  const [sessionStats, setSessionStats] = useState({ correct: 0, total: 0 });

  const getTrainingWords = () => {
    let selectedSet = new Set(selectedWordIds);
    words.forEach(w => { if (w.groupIds?.some(id => selectedGroupIds.has(id))) selectedSet.add(w.id); });
    return Array.from(selectedSet).map(id => words.find(w => w.id === id)).filter(Boolean) as Word[];
  };

  const deleteWords = (ids: string[]) => {
    ids.forEach(id => deleteDoc(doc(db, 'users', user.uid, 'words', id)));
    const newSelected = new Set(selectedWordIds); ids.forEach(id => newSelected.delete(id)); setSelectedWordIds(newSelected);
  };

  const deleteGroup = (groupId: string) => {
    deleteDoc(doc(db, 'users', user.uid, 'groups', groupId));
    words.forEach(w => { if (w.groupIds?.includes(groupId)) updateDoc(doc(db, 'users', user.uid, 'words', w.id), { groupIds: w.groupIds.filter(id => id !== groupId) }); });
  };

  const handleUpdateProgress = (wordId: string, isCorrect: boolean, mode: string = 'general') => {
    setSessionStats(s => ({ correct: s.correct + (isCorrect ? 1 : 0), total: s.total + 1 }));
    const word = words.find(w => w.id === wordId); if (!word) return;
    if (mode === 'sentence' && isCorrect) return; 
    const correctAnswers = (word.correctAnswers || 0) + (isCorrect ? 1 : 0);
    const incorrectAnswers = (word.incorrectAnswers || 0) + (!isCorrect ? 1 : 0);
    let masteryLevel = (word.masteryLevel || 0) + (isCorrect ? 20 : -10);
    if (masteryLevel > 100) masteryLevel = 100; if (masteryLevel < 0) masteryLevel = 0;
    updateDoc(doc(db, 'users', user.uid, 'words', wordId), { correctAnswers, incorrectAnswers, masteryLevel });
  };

  if (!isDataLoaded) return <div className="min-h-screen flex items-center justify-center bg-[#F7F7F5]"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  if (userProfile && !userProfile.onboarded) return <OnboardingModal user={user} onSave={(level: string) => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { level, onboarded: true }, { merge: true })} />;

  return (
    <div className="min-h-screen bg-[#F7F7F5] font-sans text-stone-800 md:flex flex-row relative overflow-hidden">
      {!activeTrainingMode && (
        <aside className="hidden md:flex flex-col w-64 bg-white/70 backdrop-blur-xl border-r border-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 z-40 fixed top-0 bottom-0 left-0">
          <div className="flex items-center gap-3 mb-10 px-2 mt-4 text-teal-600"><BookOpen className="w-8 h-8" /> <span className="text-2xl font-black text-stone-800">Words</span></div>
          <nav className="flex-1 space-y-2">
             <SidebarItem active={activeTab === 'dict'} icon={<BookOpen />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'groups'} icon={<Layers />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'train'} icon={<PlayCircle />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
             <SidebarItem active={activeTab === 'settings'} icon={<Settings />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
          </nav>
        </aside>
      )}

      {!activeTrainingMode && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-20 bg-white/70 backdrop-blur-xl border-t border-white/60 flex justify-around items-center px-2 z-40 pb-safe shadow-[0_-8px_30px_rgb(0,0,0,0.02)]">
          <NavItem active={activeTab === 'dict'} icon={<BookOpen className="w-6 h-6" />} label="Словарь" onClick={() => { setActiveTab('dict'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'groups'} icon={<Layers className="w-6 h-6" />} label="Группы" onClick={() => { setActiveTab('groups'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'train'} icon={<PlayCircle className="w-6 h-6" />} label="Тренировка" onClick={() => { setActiveTab('train'); setViewingGroupId(null); }} />
          <NavItem active={activeTab === 'settings'} icon={<Settings className="w-6 h-6" />} label="Настройки" onClick={() => { setActiveTab('settings'); setViewingGroupId(null); }} />
        </nav>
      )}

      <main className={`flex-1 flex flex-col h-screen overflow-y-auto ${!activeTrainingMode ? 'md:ml-64 pb-24 md:pb-0' : ''}`}>
        <div className="max-w-4xl mx-auto w-full relative min-h-full flex flex-col">
          {!activeTrainingMode && !viewingGroupId && (
            <div className="sticky top-0 z-30 bg-[#F7F7F5]/80 backdrop-blur-xl pt-12 md:pt-8 pb-4 px-4 md:px-8 border-b border-stone-200/50">
              <h1 className="text-3xl font-bold tracking-tight text-stone-800">
                 {activeTab === 'dict' ? 'Ваш словарь' : activeTab === 'groups' ? 'Группы слов' : activeTab === 'train' ? 'Тренировка' : 'Настройки'}
              </h1>
            </div>
          )}

          <div className="flex-1 w-full relative">
            {!activeTrainingMode && !viewingGroupId && activeTab === 'dict' && (
              <div className="p-4 md:p-8 space-y-3 pb-32 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {words.length > 0 && <div className="flex justify-between items-center px-1 mb-2"><button onClick={() => selectedWordIds.size === words.length ? setSelectedWordIds(new Set()) : setSelectedWordIds(new Set(words.map(w => w.id)))} className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"><CheckCircle2 className="w-4 h-4"/> Выбрать все</button></div>}
                {words.length === 0 ? <div className="text-center text-stone-400 py-12">Словарь пуст.</div> : words.map(word => (
                  <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                     <button onClick={() => { const n = new Set(selectedWordIds); n.has(word.id)?n.delete(word.id):n.add(word.id); setSelectedWordIds(n); }} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}>{selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}</button>
                     <div className="flex-1 cursor-pointer" onClick={() => setViewingWordId(word.id)}>
                       <h3 className="text-lg font-bold text-stone-800">{word.original}</h3>
                       <p className="text-stone-500 text-sm mt-0.5 line-clamp-1">{word.translation}</p>
                       <MasteryBar masteryLevel={word.masteryLevel || 0} />
                     </div>
                  </div>
                ))}
                
                {selectedWordIds.size === 0 && (
                   <button onClick={() => setShowAddWord(true)} className="fixed bottom-24 md:bottom-8 right-5 md:right-8 w-14 h-14 bg-teal-600 text-white rounded-full shadow-[0_8px_30px_rgb(13,148,136,0.3)] flex items-center justify-center active:scale-90 transition-all z-20"><Plus className="w-6 h-6" /></button>
                )}
                <BulkActions selectedWordIds={selectedWordIds} onTrain={() => setActiveTab('train')} onDelete={deleteWords} onAddToGroup={() => setShowBulkAddGroup(true)} />
              </div>
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'groups' && (
              <div className="p-4 md:p-8 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                 <button onClick={() => setShowAddGroup(true)} className="w-full bg-teal-50 border border-teal-100 text-teal-700 font-bold py-4 rounded-[2rem] flex items-center justify-center gap-2 mb-4 active:scale-95 transition-transform"><Plus className="w-5 h-5"/> Создать группу</button>
                 {groups.length === 0 ? <div className="text-center text-stone-400 py-12">Нет групп.</div> : groups.map(group => (
                   <div key={group.id} onClick={() => setViewingGroupId(group.id)} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-transform">
                       <div className="w-12 h-12 bg-sky-50 rounded-2xl flex items-center justify-center shrink-0"><Layers className="w-6 h-6 text-sky-600" /></div>
                       <div className="flex-1"><h3 className="text-lg font-bold text-stone-800">{group.name}</h3><p className="text-stone-500 text-sm mt-0.5">{words.filter(w=>w.groupIds?.includes(group.id)).length} слов</p></div>
                       <ArrowRight className="w-5 h-5 text-stone-300" />
                   </div>
                 ))}
              </div>
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'train' && (
              <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {getTrainingWords().length === 0 ? (
                   <div className="mb-8">
                      <p className="text-stone-500 mb-4">Выберите базу для тренировки:</p>
                      <div className="space-y-3">
                         <button onClick={() => setShowSmartSelection(true)} className="w-full bg-indigo-50 border border-indigo-100 text-indigo-700 p-5 rounded-[2rem] font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between">
                            <span className="flex items-center gap-2"><Brain className="w-5 h-5"/> Умный подбор</span> <span className="font-normal opacity-70">Слабые слова</span>
                         </button>
                         <button onClick={() => setSelectedWordIds(new Set(words.map(w => w.id)))} className="w-full bg-teal-50 p-5 rounded-[2rem] shadow-sm border border-teal-100 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between text-teal-700"><span>Весь словарь</span> <span className="font-normal opacity-70">{words.length} слов</span></button>
                         {groups.map(group => (
                               <button key={group.id} onClick={() => setSelectedGroupIds(new Set([group.id]))} className="w-full bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 font-bold text-left active:scale-[0.98] transition-transform flex items-center justify-between"><span>{group.name}</span> <span className="text-stone-400 font-normal">{words.filter(w => w.groupIds?.includes(group.id)).length} слов</span></button>
                         ))}
                      </div>
                   </div>
                ) : (
                   <>
                      <div className="flex items-center justify-between mb-8 bg-white/50 p-4 rounded-2xl border border-white/60">
                         <p className="text-stone-600 font-medium">Выбрано: <span className="font-black text-stone-900">{getTrainingWords().length}</span></p>
                         <button onClick={() => { setSelectedWordIds(new Set()); setSelectedGroupIds(new Set()); }} className="text-stone-400 font-bold bg-stone-200/50 px-4 py-2 rounded-xl active:scale-95 transition-transform flex items-center gap-1"><X className="w-4 h-4"/> Очистить</button>
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
              </div>
            )}

            {!activeTrainingMode && !viewingGroupId && activeTab === 'settings' && (
              <div className="p-4 md:p-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="bg-white rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60 mb-6">
                     <div className="font-bold text-lg text-stone-800 mb-1">{user?.displayName || 'Пользователь'}</div>
                     <div className="text-stone-500 text-sm mb-6">{user?.email || 'Скрытый email'}</div>
                     <div className="border-t border-stone-100 pt-6">
                        <h3 className="font-bold text-stone-800 mb-4">Уровень языка</h3>
                        <div className="grid grid-cols-2 gap-2">
                          {LEVELS.map((lvl) => (
                            <button key={lvl} onClick={() => setDoc(doc(db, 'users', user.uid, 'profile', 'data'), { ...(userProfile || {}), level: lvl }, { merge: true })} className={`py-3 text-xs font-bold rounded-xl transition-all ${userProfile?.level === lvl ? 'bg-teal-600 text-white shadow-sm' : 'bg-stone-50 text-stone-500 hover:bg-stone-100'}`}>{lvl}</button>
                          ))}
                        </div>
                     </div>
                  </div>
                  <div className="space-y-3">
                    <button onClick={() => signOut(auth)} className="w-full py-4 bg-stone-200/50 text-stone-700 font-bold rounded-2xl active:scale-95 transition-transform flex justify-center items-center gap-2"><LogOut className="w-5 h-5"/> Выйти</button>
                    <button onClick={handleDeleteAccount} className="w-full py-4 bg-orange-50 text-orange-500 font-bold rounded-2xl active:scale-95 transition-transform flex items-center justify-center gap-2"><AlertTriangle className="w-5 h-5"/> Удалить аккаунт</button>
                  </div>
              </div>
            )}
          </div>

          <AnimatePresence>
            {showAddWord && <AddWordModal userProfile={userProfile} groups={groups} onClose={() => setShowAddWord(false)} onSave={(w:any) => { const id=doc(collection(db,'users',user.uid,'words')).id; setDoc(doc(db,'users',user.uid,'words',id),{...w,id,createdAt:Date.now(),masteryLevel:0}); setShowAddWord(false); }} />}
            {viewingWordId && <WordEditorModal word={words.find(w=>w.id===viewingWordId)!} groups={groups} userProfile={userProfile} onClose={() => setViewingWordId(null)} onSave={(w:any) => { updateDoc(doc(db,'users',user.uid,'words',w.id),w); setViewingWordId(null); }} onDelete={() => { deleteWords([viewingWordId!]); setViewingWordId(null); }} />}
            {showAddGroup && <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { const id=doc(collection(db,'users',user.uid,'groups')).id; setDoc(doc(db,'users',user.uid,'groups',id),{id,name:n}); setShowAddGroup(false); }} />}
            
            {showBulkAddGroup && (
               <BulkAddGroupModal groups={groups} onClose={() => setShowBulkAddGroup(false)} 
                 onOpenAddGroup={() => { setShowAddGroup(true); }} 
                 onSave={(gid:string) => { 
                   words.forEach(w=>{if(selectedWordIds.has(w.id)&&!w.groupIds?.includes(gid)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),gid]});}); 
                   setShowBulkAddGroup(false); setSelectedWordIds(new Set()); 
                 }} 
               />
            )}

            {showSmartSelection && (
               <SmartSelectionModal 
                  words={words} 
                  onClose={() => setShowSmartSelection(false)} 
                  onSelect={(pickedIds: string[]) => {
                     setSelectedWordIds(new Set(pickedIds));
                     setSelectedGroupIds(new Set());
                     setShowSmartSelection(false);
                  }} 
               />
            )}

            {showBulkAddGroup && showAddGroup && (
               <AddGroupModal onClose={() => setShowAddGroup(false)} onSave={(n:string) => { 
                   const newId = doc(collection(db,'users',user.uid,'groups')).id; 
                   setDoc(doc(db,'users',user.uid,'groups',newId), {id: newId, name:n}); 
                   words.forEach(w=>{if(selectedWordIds.has(w.id)&&!w.groupIds?.includes(newId)) updateDoc(doc(db,'users',user.uid,'words',w.id),{groupIds:[...(w.groupIds||[]),newId]});}); 
                   setShowAddGroup(false); setShowBulkAddGroup(false); setSelectedWordIds(new Set());
               }} />
            )}

            {viewingGroupId && <GroupView group={groups.find(g=>g.id===viewingGroupId)!} words={words.filter(w=>w.groupIds?.includes(viewingGroupId!))} onClose={()=>setViewingGroupId(null)} onDeleteGroup={()=>{deleteGroup(viewingGroupId); setViewingGroupId(null);}} onRemoveFromGroup={(wid:string)=>{ const w=words.find(x=>x.id===wid); if(w) updateDoc(doc(db,'users',user.uid,'words',wid),{groupIds:w.groupIds.filter(g=>g!==viewingGroupId)}); }} selectedWordIds={selectedWordIds} setSelectedWordIds={setSelectedWordIds} onTrain={()=>{ setActiveTab('train'); setViewingGroupId(null); }} onWordClick={(id:string)=>setViewingWordId(id)} />}
          </AnimatePresence>
        </div>
      </main>

      {/* TRAINING OVERLAY */}
      <AnimatePresence>
         {activeTrainingMode && (
            <motion.div initial={{ opacity: 0, y: '10%' }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: '10%' }} className="fixed inset-0 bg-[#F7F7F5] z-50 flex flex-col">
               <div className="flex justify-between items-center p-4 md:p-8 bg-white/70 backdrop-blur-xl border-b border-stone-200/50">
                  <span className="font-bold text-stone-800 tracking-tight capitalize">{activeTrainingMode === 'stats' ? 'Результаты' : activeTrainingMode}</span>
                  {activeTrainingMode !== 'stats' && (
                     <button onClick={() => setActiveTrainingMode('stats')} className="px-4 py-2 bg-stone-200/50 text-stone-600 rounded-full hover:bg-stone-200 active:scale-95 transition-all font-bold text-sm flex items-center gap-2">Завершить <X className="w-4 h-4" /></button>
                  )}
                  {activeTrainingMode === 'stats' && (
                     <button onClick={() => setActiveTrainingMode(null)} className="p-2 bg-stone-100 rounded-full hover:bg-stone-200 active:scale-95 transition-all"><X className="w-5 h-5 text-stone-600" /></button>
                  )}
               </div>
               <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center justify-center">
                  {activeTrainingMode === 'stats' ? <SessionStats stats={sessionStats} onClose={() => setActiveTrainingMode(null)} /> : (
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

// --- ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ---

function SidebarItem({ active, icon, label, onClick }: any) {
  return <button onClick={onClick} className={`flex items-center w-full px-4 py-4 gap-3 rounded-2xl transition-colors ${active ? 'text-teal-700 bg-teal-50 font-bold' : 'text-stone-500 hover:bg-stone-100 font-medium'} `}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{React.cloneElement(icon, { className: "w-6 h-6" })}</div><span>{label}</span></button>;
}
function NavItem({ active, icon, label, onClick }: any) {
  return <button onClick={onClick} className={`flex flex-col items-center flex-1 py-1 gap-1 transition-colors ${active ? 'text-teal-600 font-bold' : 'text-stone-400 font-medium'}`}><div className={`${active ? 'scale-110' : 'scale-100'} transition-transform`}>{icon}</div><span className="text-[10px]">{label}</span></button>;
}
function MasteryBar({ masteryLevel }: { masteryLevel: number }) {
   return <div className="mt-3 w-full bg-stone-100 rounded-full h-1 overflow-hidden"><div className={`h-full ${masteryLevel > 70 ? 'bg-teal-500' : masteryLevel > 30 ? 'bg-sky-400' : 'bg-orange-400'} transition-all duration-700`} style={{ width: `${masteryLevel}%` }} /></div>;
}
function TrainCard({ title, desc, icon, color, bg, className="", onClick }: any) {
  return <div onClick={onClick} className={`bg-white p-6 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.03)] border border-white/60 flex flex-col gap-4 active:scale-95 transition-transform cursor-pointer ${className}`}><div className={`w-14 h-14 rounded-2xl ${bg} flex items-center justify-center`}>{React.cloneElement(icon, { className: `w-7 h-7 ${color}` })}</div><div><div className="font-bold text-stone-800 text-lg">{title}</div><div className="text-xs text-stone-400 font-medium">{desc}</div></div></div>;
}
function BulkActions({ selectedWordIds, onTrain, onDelete, onAddToGroup }: any) {
  if (selectedWordIds.size === 0) return null;
  return (
    <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-30 border border-stone-200/50 w-[90%] max-w-sm">
      <button onClick={() => onDelete(Array.from(selectedWordIds))} className="flex flex-col items-center p-2 text-orange-400 active:opacity-70 flex-1"><Trash2 className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">Удалить</span></button>
      <button onClick={onAddToGroup} className="flex flex-col items-center p-2 text-sky-600 active:opacity-70 flex-1 border-l border-stone-100"><FolderPlus className="w-5 h-5 mb-1" /> <span className="text-[10px] font-bold">В группу</span></button>
      <button onClick={onTrain} className="flex flex-col items-center p-2 text-teal-600 active:opacity-70 flex-1 border-l border-stone-100"><PlayCircle className="w-5 h-5 mb-1 fill-teal-600/10" /> <span className="text-[10px] font-bold">Учить ({selectedWordIds.size})</span></button>
    </motion.div>
  );
}

// --- МОДАЛКИ И ФУНКЦИИ ---

function SmartSelectionModal({ words, onClose, onSelect }: any) {
   const [count, setCount] = useState(Math.min(10, words.length));
   return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white w-full max-w-sm rounded-[2rem] p-6 shadow-2xl relative z-10">
           <h2 className="text-xl font-bold mb-2 text-stone-800">Умный подбор</h2>
           <p className="text-stone-500 text-sm mb-6">ИИ выберет слова, которые даются вам сложнее всего (низкий уровень знания).</p>
           <div className="bg-stone-50 p-4 rounded-2xl mb-6 border border-stone-200">
              <div className="flex justify-between text-xs font-bold text-stone-400 mb-2 uppercase"><span>Количество</span><span>Всего: {words.length}</span></div>
              <input type="number" min="1" max={words.length} value={count} onChange={e => { let val = parseInt(e.target.value) || 1; if(val > words.length) val = words.length; setCount(val); }} className="w-full text-2xl font-black bg-transparent outline-none text-stone-800" />
           </div>
           <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 py-4 bg-stone-100 text-stone-700 font-bold rounded-2xl active:bg-stone-200">Отмена</button>
              <button onClick={() => {
                 const sorted = [...words].sort((a, b) => (a.masteryLevel || 0) - (b.masteryLevel || 0));
                 const picked = sorted.slice(0, count).map(w => w.id);
                 onSelect(picked);
              }} className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl active:bg-indigo-700 flex justify-center items-center gap-2"><Brain className="w-4 h-4"/> Выбрать</button>
           </div>
        </motion.div>
      </div>
   );
}

function AddWordModal({ userProfile, groups, onClose, onSave }: any) {
  const [original, setOriginal] = useState('');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'done'>('idle');
  const [wordData, setWordData] = useState<Partial<Word>>({});
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  const handleAnalyze = async () => {
    if (!original.trim()) return; setStatus('analyzing');
    const result = await ApiClient.aiGenerateWord(original, userProfile?.level);
    setWordData(result); setStatus('done');
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end items-center">
      <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
        <div className="flex justify-between items-center mb-6 shrink-0"><h2 className="text-xl font-bold text-stone-800">Новое слово</h2><button onClick={onClose} className="p-2 bg-stone-100 rounded-full"><X className="w-5 h-5 text-stone-600" /></button></div>
        <div className="flex-1 overflow-y-auto space-y-6 pb-6 hide-scrollbar">
          <input autoFocus placeholder="Введите слово..." value={original} onChange={e => setOriginal(e.target.value)} disabled={status !== 'idle'} className="w-full bg-stone-50 px-6 py-5 rounded-[2rem] text-lg font-bold border border-stone-200 outline-none focus:border-teal-500" />
          {status === 'idle' && <button onClick={handleAnalyze} disabled={!original.trim()} className="w-full py-5 bg-teal-600 text-white font-bold rounded-[2rem] active:scale-95 transition-transform disabled:opacity-50">Добавить слово</button>}
          {status === 'analyzing' && <div className="py-12 flex flex-col items-center justify-center text-stone-500"><Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-2" /> Изучаем контекст...</div>}
          {status === 'done' && (
            <div className="space-y-4">
               <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-100">
                  <h3 className="text-3xl font-black text-stone-800 text-center mb-6">{wordData.original || original}</h3>
                  <div className="space-y-5">
                      <div><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-1">Перевод ИИ</div><div className="font-bold text-stone-800 text-2xl text-center">{wordData.translation}</div></div>
                      <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-1">Cambridge Dictionary</div><div className="text-stone-600 text-center text-sm leading-relaxed">{wordData.cambridgeTranslation}</div></div>
                      <div className="pt-4 border-t border-stone-200/50"><div className="text-[10px] font-bold text-stone-400 uppercase text-center mb-2">Транскрипция</div><div className="flex justify-center gap-4 text-sm font-medium text-stone-500"><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">UK: [{wordData.transcriptionUK}]</span><span className="bg-white px-3 py-1 rounded-lg border border-stone-200 shadow-sm">US: [{wordData.transcriptionUS}]</span></div></div>
                  </div>
                  {wordData.examples?.map((ex:any, i:number) => <div key={i} className="mt-6 p-5 bg-teal-50 border border-teal-100 rounded-2xl text-center"><div className="text-[10px] font-bold text-teal-600/70 uppercase mb-2">Пример ИИ</div><div className="font-medium text-teal-900 mb-2 text-lg">"{ex.text}"</div><div className="text-sm text-teal-700/80">{ex.translation}</div></div>)}
               </div>
               {groups.length > 0 && <div className="px-2 pt-2"><h3 className="text-sm font-bold text-stone-400 mb-3">Добавить в группы:</h3><div className="flex flex-wrap gap-2">{groups.map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(selectedGroups); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setSelectedGroups(s); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${selectedGroups.has(g.id) ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-stone-200 text-stone-500'}`}>{selectedGroups.has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>}
               <button onClick={() => onSave({ original: wordData.original || original, ...wordData, groupIds: Array.from(selectedGroups) })} className="w-full py-5 mt-4 bg-stone-900 text-white font-bold rounded-[2rem] active:scale-95 transition-transform">Сохранить в словарь</button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function WordEditorModal({ word, groups, userProfile, onClose, onSave, onDelete }: any) {
  const [original, setOriginal] = useState(word.original);
  const [translation, setTranslation] = useState(word.translation);
  const [cambridgeTranslation, setCambridgeTranslation] = useState(word.cambridgeTranslation || '');
  const [transcriptionUK, setTranscriptionUK] = useState(word.transcriptionUK || '');
  const [transcriptionUS, setTranscriptionUS] = useState(word.transcriptionUS || '');
  const [exampleText, setExampleText] = useState(word.examples?.[0]?.text || '');
  const [exampleTranslation, setExampleTranslation] = useState(word.examples?.[0]?.translation || '');
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set(word.groupIds || []));
  const [isRegenerating, setIsRegenerating] = useState(false);

  const handleRegenerateExample = async () => {
     setIsRegenerating(true);
     const newEx = await ApiClient.aiRegenerateExample(original, userProfile?.level);
     if (newEx.text) { setExampleText(newEx.text); setExampleTranslation(newEx.translation); }
     setIsRegenerating(false);
  };

  const handleSave = () => onSave({ ...word, original, translation, cambridgeTranslation, transcriptionUK, transcriptionUS, groupIds: Array.from(groupIds), examples: exampleText ? [{ text: exampleText, translation: exampleTranslation }] : [] });

  return (
     <div className="fixed inset-0 z-[100] flex flex-col justify-end items-center">
        <div className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={onClose} />
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="bg-white w-full max-w-lg rounded-t-[2rem] p-6 shadow-2xl flex flex-col max-h-[90vh] relative z-10">
           <div className="flex justify-between items-center mb-6 shrink-0">
              <h2 className="text-xl font-bold text-stone-800 flex items-center gap-2"><Edit3 className="w-5 h-5 text-teal-600"/> Редактор</h2>
              <div className="flex items-center gap-2"><button onClick={onDelete} className="p-2 bg-orange-50 text-orange-500 rounded-full mr-2"><Trash2 className="w-5 h-5" /></button><button onClick={onClose} className="p-2 bg-stone-100 rounded-full"><X className="w-5 h-5 text-stone-500" /></button></div>
           </div>
           
           <div className="flex-1 overflow-y-auto space-y-4 pb-6 hide-scrollbar">
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Слово (англ)</label><input value={original} onChange={e => setOriginal(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 font-bold" /></div>
              <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">UK Транскрипция</label><input value={transcriptionUK} onChange={e => setTranscriptionUK(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500" /></div>
                  <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">US Транскрипция</label><input value={transcriptionUS} onChange={e => setTranscriptionUS(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500" /></div>
              </div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Перевод</label><input value={translation} onChange={e => setTranslation(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 font-bold text-teal-700" /></div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Cambridge Dictionary</label><textarea value={cambridgeTranslation} onChange={e => setCambridgeTranslation(e.target.value)} className="w-full bg-stone-50 px-4 py-3 rounded-2xl border border-stone-200 outline-none focus:border-teal-500 text-sm min-h-[60px]" /></div>
              <div className="space-y-1">
                 <div className="flex justify-between items-center"><label className="text-[10px] font-bold text-stone-400 uppercase">Пример ИИ</label><button onClick={handleRegenerateExample} disabled={isRegenerating} className="text-[10px] font-bold text-teal-600 flex items-center gap-1 active:scale-95"><RefreshCw className={`w-3 h-3 ${isRegenerating?'animate-spin':''}`}/> Перегенерировать</button></div>
                 <textarea value={exampleText} onChange={e => setExampleText(e.target.value)} className="w-full bg-teal-50 px-4 py-3 rounded-2xl border border-teal-100 outline-none focus:border-teal-500 text-sm min-h-[60px]" />
              </div>
              <div className="space-y-1"><label className="text-[10px] font-bold text-stone-400 uppercase">Перевод примера</label><textarea value={exampleTranslation} onChange={e => setExampleTranslation(e.target.value)} className="w-full bg-teal-50/50 px-4 py-3 rounded-2xl border border-teal-100/50 outline-none focus:border-teal-500 text-sm min-h-[60px]" /></div>
              <div className="pt-4 border-t border-stone-100 mt-4"><label className="text-[10px] font-bold text-stone-400 uppercase mb-3 block">Группы</label><div className="flex flex-wrap gap-2 mb-4">{groups.map((g: Group) => <button key={g.id} onClick={() => { const s = new Set(groupIds); s.has(g.id) ? s.delete(g.id) : s.add(g.id); setGroupIds(s); }} className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${groupIds.has(g.id) ? 'bg-sky-600 border-sky-600 text-white' : 'bg-white border-stone-200 text-stone-500'}`}>{groupIds.has(g.id) && <Check className="w-4 h-4"/>} {g.name}</button>)}</div></div>
           </div>
           <button onClick={handleSave} className="w-full py-5 bg-teal-600 text-white font-bold rounded-[2rem] active:bg-teal-700 transition-colors text-lg shrink-0">Сохранить</button>
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
              {groups.map((g: Group) => <button key={g.id} onClick={() => onSave(g.id)} className="w-full text-left p-4 bg-stone-50 rounded-2xl font-medium active:bg-stone-100 flex items-center justify-between text-stone-800">{g.name} <Plus className="w-5 h-5 text-teal-600"/></button>)}
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
            <div className="flex-1 ml-2"><h2 className="text-xl font-bold text-stone-800">{group.name}</h2><p className="text-stone-500 text-sm">{words.length} элементов</p></div>
            <button onClick={()=>{ if(window.confirm('Удалить группу? Слова останутся в общем словаре.')) onDeleteGroup(); }} className="p-2 bg-orange-50 text-orange-500 rounded-full"><Trash2 className="w-5 h-5"/></button>
         </div>
         <div className="p-4 md:p-8 space-y-3 overflow-auto flex-1">
            {words.length > 0 && <div className="flex justify-between items-center px-1 mb-2"><button onClick={() => { const groupWordIds = words.map((w: Word) => w.id); const allSelected = groupWordIds.every((id: string) => selectedWordIds.has(id)); const newSet = new Set(selectedWordIds); if (allSelected) { groupWordIds.forEach((id: string) => newSet.delete(id)); } else { groupWordIds.forEach((id: string) => newSet.add(id)); } setSelectedWordIds(newSet); }} className="text-sm font-bold text-teal-600 flex items-center gap-1 active:opacity-70"><CheckCircle2 className="w-4 h-4"/> Выбрать все в группе</button></div>}
            {words.length === 0 ? <div className="text-center text-stone-400 p-8">В этой группе пока нет слов.</div> : words.map((word: Word) => (
                  <div key={word.id} className="bg-white p-5 rounded-[2rem] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-white/60 flex items-center gap-4 active:scale-[0.98] transition-transform">
                     <button onClick={() => { const newSet = new Set(selectedWordIds); newSet.has(word.id) ? newSet.delete(word.id) : newSet.add(word.id); setSelectedWordIds(newSet); }} className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${selectedWordIds.has(word.id) ? 'bg-teal-500 border-teal-500' : 'border-stone-300'}`}>{selectedWordIds.has(word.id) && <Check className="w-4 h-4 text-white" />}</button>
                     <div className="flex-1 cursor-pointer" onClick={() => onWordClick(word.id)}><h3 className="text-lg font-bold text-stone-800">{word.original}</h3><p className="text-stone-500 text-sm line-clamp-1">{word.translation}</p><MasteryBar masteryLevel={word.masteryLevel || 0} /></div>
                     <button onClick={() => onRemoveFromGroup(word.id)} className="p-2 text-stone-400 hover:text-orange-500 bg-stone-50 rounded-full shrink-0"><X className="w-5 h-5"/></button>
                  </div>
            ))}
         </div>
         <AnimatePresence>
            {selectedWordIds.size > 0 && words.some((w: Word) => selectedWordIds.has(w.id)) && (
               <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-xl rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.1)] p-2 flex items-center justify-around z-30 border border-stone-200/50 w-[90%] max-w-sm">
                  <button onClick={() => { words.forEach((w: Word) => { if (selectedWordIds.has(w.id)) onRemoveFromGroup(w.id); }); const newSet = new Set(selectedWordIds); words.forEach((w: Word) => newSet.delete(w.id)); setSelectedWordIds(newSet); }} className="flex flex-col items-center p-2 text-orange-400 active:opacity-70 flex-1"><Trash2 className="w-5 h-5 mb-1" /><span className="text-[10px] font-bold">Убрать из группы</span></button>
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
   return <div className="w-full text-center flex flex-col items-center"><div className="bg-white rounded-[2rem] p-10 w-full shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 mb-8"><div className="text-6xl font-black text-teal-600 mb-2">{accuracy}%</div><div className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Точность</div><div className="flex justify-around text-lg font-bold"><div className="flex flex-col"><span className="text-teal-500 text-2xl">{stats.correct}</span><span className="text-stone-400 text-xs uppercase">Верно</span></div><div className="flex flex-col"><span className="text-orange-400 text-2xl">{stats.total - stats.correct}</span><span className="text-stone-400 text-xs uppercase">Ошибок</span></div></div></div><button onClick={onClose} className="w-full bg-teal-600 text-white font-bold py-5 rounded-[2rem] shadow-[0_8px_20px_rgb(13,148,136,0.3)]">Закрыть</button></div>;
}

function ModeConstructor({ words, onProgress, onFinish }: any) {
   const [sessionWords] = useState(words);
   const [idx, setIdx] = useState(0);
   const [letters, setLetters] = useState<{id:number, char:string}[]>([]);
   const [answer, setAnswer] = useState<{id:number, char:string}[]>([]);
   const word = sessionWords[idx];

   useEffect(() => {
      if(!word) return;
      const chars = word.original.split('').map((char:string, i:number) => ({ id: i, char }));
      setLetters(chars.sort(() => Math.random() - 0.5));
      setAnswer([]);
   }, [word]);

   const handleKeyDown = useCallback((e: KeyboardEvent) => {
      const char = e.key.toLowerCase();
      const availableLetter = letters.find(l => l.char.toLowerCase() === char);
      
      if (availableLetter) {
         setLetters(prev => prev.filter(l => l.id !== availableLetter.id));
         setAnswer(prev => {
            const newAns = [...prev, availableLetter];
            if (newAns.length === word.original.length) {
               const isCorrect = newAns.map(a => a.char).join('') === word.original;
               onProgress(word.id, isCorrect);
               setTimeout(() => { if (idx >= sessionWords.length - 1) onFinish(); else setIdx(c => c + 1); }, 1000);
            }
            return newAns;
         });
      }
   }, [letters, word, idx, sessionWords, onFinish, onProgress]);

   useEffect(() => {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
   }, [handleKeyDown]);

   const handlePick = (item: any) => {
      setLetters(prev => prev.filter(l => l.id !== item.id));
      setAnswer(prev => {
         const newAns = [...prev, item];
         if (newAns.length === word.original.length) {
            const isCorrect = newAns.map(a => a.char).join('') === word.original;
            onProgress(word.id, isCorrect);
            setTimeout(() => { if (idx >= sessionWords.length - 1) onFinish(); else setIdx(c => c + 1); }, 1000);
         }
         return newAns;
      });
   };

   if (!word) return null;
   const isFull = answer.length === word.original.length;
   const isCorrect = answer.map(a => a.char).join('') === word.original;

   return (
      <div className="w-full flex flex-col items-center">
         <span className="text-stone-400 font-bold mb-8">{idx + 1} / {sessionWords.length}</span>
         <div className="text-xl font-bold text-stone-500 mb-8 text-center">{word.translation}</div>
         <div className={`flex flex-wrap justify-center gap-2 mb-12 min-h-[60px] p-4 rounded-3xl w-full ${isFull ? (isCorrect ? 'bg-teal-50 border-teal-200 border' : 'bg-orange-50 border-orange-200 border') : 'bg-white border-2 border-dashed border-stone-200'}`}>
            {answer.map(a => <motion.div layoutId={`char-${a.id}`} key={a.id} className={`w-10 h-12 flex items-center justify-center font-bold text-xl rounded-xl text-white ${isFull ? (isCorrect ? 'bg-teal-500' : 'bg-orange-400') : 'bg-stone-800'}`}>{a.char}</motion.div>)}
         </div>
         <div className="flex flex-wrap justify-center gap-2">
            {letters.map(l => <motion.div layoutId={`char-${l.id}`} key={l.id} onClick={() => handlePick(l)} className="w-12 h-14 bg-white border border-stone-200 shadow-sm flex items-center justify-center font-bold text-xl rounded-xl text-stone-800 cursor-pointer active:scale-90">{l.char}</motion.div>)}
         </div>
      </div>
   );
}

function ModeFlashcards({ words, onProgress, onFinish }: any) {
  const [sessionWords] = useState(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const word = sessionWords[currentIndex];

  const handleAnswer = (isCorrect: boolean) => {
    onProgress(word.id, isCorrect);
    setIsFlipped(false);
    setTimeout(() => {
       if (currentIndex >= sessionWords.length - 1) onFinish();
       else setCurrentIndex(c => c + 1);
    }, 250); 
  };

  if (!word) return null;
  return (
    <div className="w-full flex flex-col items-center">
      <span className="text-stone-400 font-bold mb-8">{currentIndex + 1} / {sessionWords.length}</span>
      <div className="w-full h-96 relative cursor-pointer perspective-1000" onClick={() => setIsFlipped(!isFlipped)}>
         <motion.div animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ type: "spring", stiffness: 100, damping: 20 }} className="w-full h-full relative [transform-style:preserve-3d]">
            <div className="absolute inset-0 [backface-visibility:hidden] bg-white rounded-[2rem] shadow-[0_10px_40px_rgb(0,0,0,0.05)] border border-stone-100 flex flex-col items-center justify-center p-8 text-center">
               <h2 className="text-4xl font-black text-stone-800">{word.original}</h2><div className="text-stone-400 mt-4 font-medium">[{word.transcriptionUK}]</div>
            </div>
            <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)] bg-teal-600 rounded-[2rem] shadow-[0_10px_40px_rgb(13,148,136,0.2)] flex flex-col items-center justify-center p-8 text-center text-white">
               <h2 className="text-3xl font-bold mb-2">{word.translation}</h2><p className="text-teal-100/80 text-sm mb-4">{word.cambridgeTranslation}</p>
               {word.examples?.[0] && <p className="italic text-teal-50 bg-black/10 p-3 rounded-xl text-sm">"{word.examples[0].text}"</p>}
            </div>
         </motion.div>
      </div>
      <div className="mt-12 w-full flex gap-4"><button onClick={() => handleAnswer(false)} className="flex-1 py-5 bg-orange-50 text-orange-500 font-bold rounded-2xl active:scale-95 transition-transform">Не помню</button><button onClick={() => handleAnswer(true)} className="flex-1 py-5 bg-teal-50 text-teal-600 font-bold rounded-2xl active:scale-95 transition-transform">Вспомнил</button></div>
    </div>
  );
}

function ModeQuiz({ words, onProgress, onFinish }: any) {
  const [sessionWords] = useState(words);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'playing'>('loading');
  const [quizData, setQuizData] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [ansIdx, setAnsIdx] = useState<number | null>(null);

  useEffect(() => {
    const fetchBatch = async () => {
      setPhase('loading');
      const distsData = await ApiClient.aiGenerateBatchDistractors(sessionWords);
      const formatted = sessionWords.map((w: any) => {
         const item = distsData.find((d:any) => d.id === w.id);
         const dists = item && item.distractors && item.distractors.length >= 3 ? item.distractors.slice(0,3) : ['Неверно 1', 'Неверно 2', 'Неверно 3'];
         const options = [...dists, w.translation].sort(() => Math.random() - 0.5);
         return { ...w, options };
      });
      setQuizData(formatted);
      setPhase('ready');
    };
    fetchBatch();
  }, [sessionWords]);

  if (phase === 'loading') return <div className="flex flex-col items-center justify-center p-8 h-64"><Loader2 className="w-8 h-8 animate-spin text-teal-600 mb-4"/><p className="text-stone-500 font-bold text-center">ИИ подготавливает хитрые<br/>варианты ответов...</p></div>;
  if (phase === 'ready') return (
     <div className="flex flex-col items-center justify-center p-8 text-center">
        <CheckCircle2 className="w-16 h-16 text-teal-500 mb-6" />
        <h2 className="text-2xl font-black text-stone-800 mb-2">Викторина готова!</h2>
        <p className="text-stone-500 mb-8">Уникальные варианты ответов для {sessionWords.length} слов загружены.</p>
        <button onClick={() => setPhase('playing')} className="w-full bg-teal-600 text-white font-bold py-5 rounded-[2rem] active:scale-95 transition-transform shadow-[0_8px_20px_rgb(13,148,136,0.3)]">Начать</button>
     </div>
  );

  const currentItem = quizData[currentIndex];
  if (!currentItem) return null;

  return (
    <div className="w-full max-w-sm flex flex-col">
       <span className="text-stone-400 font-medium text-center mb-8">{currentIndex + 1} / {sessionWords.length}</span>
       <div className="bg-white rounded-[2rem] p-8 text-center mb-8 border border-stone-100 shadow-sm"><h2 className="text-3xl font-black text-stone-800">{currentItem.original}</h2></div>
       <div className="space-y-3">
          {currentItem.options.map((opt: string, i: number) => {
             let stateClass = "bg-white text-stone-800 border-stone-200";
             if (ansIdx !== null) { if (opt === currentItem.translation) stateClass = "bg-teal-500 text-white border-transparent"; else if (i === ansIdx) stateClass = "bg-orange-400 text-white border-transparent"; else stateClass = "bg-white/50 text-stone-400 opacity-50"; }
             return <button key={i} onClick={() => { if(ansIdx===null) { setAnsIdx(i); onProgress(currentItem.id, opt === currentItem.translation); setTimeout(() => { if(currentIndex >= sessionWords.length-1) onFinish(); else {setCurrentIndex(c=>c+1); setAnsIdx(null);} }, 1500) } }} className={`w-full p-5 rounded-2xl border font-bold text-lg active:scale-[0.98] transition-all shadow-sm ${stateClass}`}>{opt}</button>;
          })}
       </div>
    </div>
  );
}

function ModeSentence({ words, onProgress, onFinish }: any) {
   const [sessionWords] = useState(words);
   const [currentIndex, setCurrentIndex] = useState(0);
   const [input, setInput] = useState('');
   const [status, setStatus] = useState<'idle'|'checking'|'correct'|'incorrect'>('idle');
   const [fb, setFb] = useState('');
   const word = sessionWords[currentIndex];
 
   if (!word) return null;
   return (
     <div className="w-full flex flex-col h-[80vh]">
        <div className="flex-1">
          <span className="text-stone-400 font-bold text-center block mb-6">{currentIndex + 1} / {sessionWords.length}</span>
          <div className="bg-white rounded-[2rem] p-8 mb-6 shadow-sm border border-stone-100 text-center"><h2 className="text-3xl font-black text-stone-800 mb-2">{word.original}</h2><p className="text-stone-400 font-medium">{word.translation}</p></div>
          <textarea autoFocus value={input} onChange={e => { setInput(e.target.value); setStatus('idle'); }} placeholder="Составьте предложение с этим словом..." disabled={status === 'checking' || status === 'correct'} className="w-full bg-stone-50 border border-stone-200 focus:border-teal-500 text-stone-800 p-6 rounded-[2rem] min-h-[140px] outline-none font-medium resize-none" />
          
          {status !== 'idle' && status !== 'checking' && (
             <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`mt-4 p-5 rounded-2xl flex gap-3 ${status === 'correct' ? 'bg-teal-50 text-teal-700' : 'bg-orange-50 text-orange-600'}`}>
                {status === 'correct' ? <CheckCircle2 className="w-6 h-6 shrink-0"/> : <XCircle className="w-6 h-6 shrink-0"/>}
                <p className="font-medium text-sm leading-relaxed">{fb}</p>
             </motion.div>
          )}
        </div>
        <div className="pb-8">
           {status === 'idle' && <button onClick={async () => { setStatus('checking'); const r = await ApiClient.aiCheckSentence(word.original, input); setFb(r.feedback); setStatus(r.isCorrect ? 'correct' : 'incorrect'); onProgress(word.id, r.isCorrect); }} disabled={!input} className="w-full bg-indigo-600 text-white font-bold py-5 rounded-[2rem] flex gap-2 justify-center shadow-[0_8px_20px_rgb(79,70,229,0.2)]"><Brain className="w-5 h-5"/> Проверить ИИ</button>}
           {status === 'checking' && <div className="w-full bg-stone-100 text-stone-500 font-bold py-5 rounded-[2rem] flex justify-center"><Loader2 className="animate-spin w-5 h-5" /> Анализируем...</div>}
           {(status === 'correct' || status === 'incorrect') && <button onClick={() => { if(currentIndex >= sessionWords.length-1) onFinish(); else { setCurrentIndex(c=>c+1); setInput(''); setStatus('idle'); } }} className="w-full bg-stone-800 text-white font-bold py-5 rounded-[2rem]">Продолжить <ArrowRight className="w-5 h-5 inline"/></button>}
        </div>
     </div>
   );
}

function ModeBrainstorm({ words, onProgress, onFinish }: any) {
   const [sessionWords] = useState(words);
   const [phase, setPhase] = useState<1|2|3>(1);
   const [pool] = useState<any[]>(sessionWords);
   const [selected, setSelected] = useState<Set<string>>(new Set());

   if (phase === 1) return (
         <div className="w-full"><h2 className="text-2xl font-black text-stone-800 mb-2">Брейншторм</h2><p className="text-stone-500 mb-6">Выберите слова, которые хотите прогнать через усиленный цикл тренировки.</p><div className="space-y-2 mb-8 max-h-[50vh] overflow-y-auto">{pool.map(w => <div key={w.id} onClick={() => { const s=new Set(selected); s.has(w.id)?s.delete(w.id):s.add(w.id); setSelected(s); }} className={`p-4 rounded-2xl flex justify-between font-bold cursor-pointer transition-colors ${selected.has(w.id) ? 'bg-purple-100 text-purple-700' : 'bg-white text-stone-700'}`}>{w.original} {selected.has(w.id) && <Check className="w-5 h-5"/>}</div>)}</div><button onClick={() => { if(selected.size>0) setPhase(2); else alert('Выберите слова'); }} className="w-full bg-purple-600 text-white font-bold py-5 rounded-[2rem]">Начать цикл ({selected.size})</button></div>
   );

   const activeWords = sessionWords.filter((w:any) => selected.has(w.id));
   if (phase === 2) return <div className="w-full text-center"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Этап 1: Карточки</h3><ModeFlashcards words={activeWords} onProgress={()=>{}} onFinish={() => setPhase(3)} /></div>;
   if (phase === 3) return <div className="w-full text-center"><h3 className="text-stone-400 font-bold mb-8 uppercase tracking-widest text-xs">Этап 2: Правописание</h3><ModeConstructor words={activeWords} onProgress={onProgress} onFinish={onFinish} /></div>;
   return null;
}

function OnboardingModal({ user, onSave }: any) {
  const [step, setStep] = useState(0); const [level, setLevel] = useState('Intermediate');
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4"><div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" /><motion.div initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} transition={{type:'spring', stiffness: 200, damping: 25}} className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-[0_20px_60px_rgb(0,0,0,0.1)] relative z-10"><div className="p-8"><h2 className="text-3xl font-black mb-6 text-stone-800">Привет, {user?.displayName?.split(' ')[0] || 'студент'}! 🌿</h2>{step === 0 && <div className="space-y-6"><p className="text-stone-500 mb-4">Добро пожаловать в Words. Здесь обучение происходит спокойно и эффективно.</p><div className="space-y-4"><div className="flex items-start gap-4"><div className="w-10 h-10 rounded-2xl bg-teal-50 flex items-center justify-center text-teal-600 shrink-0"><BookOpen className="w-5 h-5"/></div><div><h3 className="font-bold text-stone-800">Умный словарь ИИ</h3><p className="text-stone-500 text-sm">Транскрипции, переводы из Cambridge и точные примеры.</p></div></div></div></div>}{step === 1 && <div><h3 className="font-bold text-xl mb-4 text-stone-800">Ваш текущий уровень?</h3><p className="text-stone-500 text-sm mb-6">Это настроит сложность ИИ-примеров.</p><div className="grid grid-cols-2 gap-3">{LEVELS.map(l => <button key={l} onClick={() => setLevel(l)} className={`p-4 rounded-2xl border-2 font-bold text-center transition-colors text-sm ${level === l ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-stone-100 text-stone-500'}`}>{l}</button>)}</div></div>}</div><div className="p-6 bg-stone-50 border-t border-stone-100 flex gap-3">{step === 1 && <button onClick={() => setStep(0)} className="px-6 bg-stone-200 text-stone-600 font-bold rounded-2xl">Назад</button>}<button onClick={() => { if (step === 0) setStep(1); else onSave(level); }} className="flex-1 bg-teal-600 text-white font-bold py-4 rounded-2xl active:scale-95 transition-transform shadow-[0_8px_20px_rgb(13,148,136,0.2)]">{step === 0 ? 'Продолжить' : 'Начать путь'}</button></div></motion.div></motion.div>;
}