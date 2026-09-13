'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  FolderOpen,
  Menu,
  RotateCcw,
  Sparkles,
  Target,
  Upload,
  UserCircle,
  X,
  Trash2,
  Star,
} from 'lucide-react';

type Question = {
  id: string;
  type: '单选题' | '多选题' | '判断题';
  prompt: string;
  options: string[];
  answer: string[];
  explanation: string;
  category?: string;
  last_result?: number | null;
};

type Bank = { id: string; name: string; total: number; answered: number; correct: number };

async function apiFetch(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  if (response.status === 401) {
    const data = await response.clone().json() as { code?: string };
    if (data.code === 'LOGIN_REQUIRED') {
      window.location.replace('/');
      throw new Error('登录已失效，请重新登录');
    }
  }
  return response;
}

const navItems = [
  { label: '开始练习', icon: Sparkles },
  { label: '题库', icon: BookOpen },
  { label: '错题本', icon: RotateCcw },
];

export default function Home() {
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [view, setView] = useState('开始练习');
  const [accessState, setAccessState] = useState<
    'checking' | 'granted' | 'denied'
  >('checking');
  const [accessInput, setAccessInput] = useState('');
  const [username, setUsername] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');
  const [accessMessage, setAccessMessage] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('全部题型');
  const [mobileNav, setMobileNav] = useState(false);
  const [showImporter, setShowImporter] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [remembered, setRemembered] = useState(false);
  const [questionList, setQuestionList] = useState<Question[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankId, setBankId] = useState('');
  const [loadedBankId, setLoadedBankId] = useState('');
  const [bankRevision, setBankRevision] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showAnswerCard, setShowAnswerCard] = useState(false);
  const [finishMessage, setFinishMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<
    { id: string; prompt: string; type: string; category: string }[]
  >([]);
  const question = questionList[current] ?? questionList[0];
  const filteredQuestions = questionList
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        (typeFilter === '全部题型' || item.type === typeFilter) &&
        `${item.prompt} ${item.category || ''}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    );
  const isCorrect =
    submitted && !!question &&
    selected.length === question.answer.length &&
    selected.every((item) => question.answer.includes(item));
  const answeredCount = questionList.filter(item => item.last_result != null).length;
  const correctCount = questionList.filter(item => item.last_result === 1).length;
  const progress = questionList.length ? Math.round((answeredCount / questionList.length) * 100) : 0;
  const currentBank = banks.find(bank => bank.id === bankId);


  async function enterPlatform() {
    setLoginBusy(true);
    setAccessMessage('');
    try {
      const response = await fetch('/api/access/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: accessInput }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '登录失败');
      setAccessInput('');
      setAccessState('granted');
      setView('开始练习');
    } catch (error) {
      setAccessState('denied');
      setAccessMessage(error instanceof Error ? error.message : '网络异常，请重试');
    } finally { setLoginBusy(false); }
  }

  async function logout(otherDevices: boolean) {
    setSessionBusy(true);
    setSessionMessage('');
    try {
      const response = await apiFetch(`/api/access/${otherDevices ? 'logout-others' : 'logout'}`, { method: 'POST' });
      if (!response.ok) throw new Error('退出失败，请重试');
      if (otherDevices) {
        setSessionMessage('已退出其他设备，当前设备保持登录。');
      } else {
        window.location.replace('/');
      }
    } catch (error) {
      setSessionMessage(error instanceof Error ? error.message : '网络异常，请重试');
    } finally { setSessionBusy(false); }
  }

  useEffect(() => {
    const cleanUrl = new URL(window.location.href);
    if (cleanUrl.searchParams.has('token')) {
      cleanUrl.searchParams.delete('token');
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }
    void fetch('/api/access').then(async response => {
      if (!response.ok) { setAccessState('denied'); return; }
      const data = await response.json() as { username: string };
      setUsername(data.username);
      setAccessState('granted');
    }).catch(() => { setAccessState('denied'); setAccessMessage('无法连接服务，请重试'); });
  }, []);

  useEffect(() => {
    if (accessState !== 'granted') return;
    const controller = new AbortController();
    void apiFetch('/api/state', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('题库加载失败');
      return await response.json() as { banks: Bank[] };
    }).then(data => {
      if (controller.signal.aborted) return;
      setBanks(data.banks);
      setBankId(currentBank => data.banks.some(bank => bank.id === currentBank) ? currentBank : data.banks[0]?.id || '');
    }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [accessState, bankRevision]);

  useEffect(() => {
    if (accessState !== 'granted' || !bankId) return;
    const controller = new AbortController();
    void apiFetch(`/api/questions?bankId=${encodeURIComponent(bankId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('题目加载失败，请重试');
        return await response.json() as Question[];
      }).then(items => {
        if (controller.signal.aborted) return;
        setQuestionList(items);
        let saved = 0;
        try { saved = Number(window.localStorage.getItem(`qifa-quiz-current:${username}:${bankId}`) || 0); } catch { /* storage may be disabled */ }
        const position = Number.isInteger(saved) && saved >= 0 && saved < items.length ? saved : 0;
        setCurrent(position);
        setSelected([]);
        setSubmitted(false);
        setRemembered(position > 0);
        setLoadedBankId(bankId);
        setLoadError('');
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [bankId, accessState, username]);

  useEffect(() => {
    if (!bankId || bankId !== loadedBankId || accessState !== 'granted') return;
    try { window.localStorage.setItem(`qifa-quiz-current:${username}:${bankId}`, String(current)); } catch { /* storage may be disabled */ }
  }, [current, bankId, loadedBankId, username, accessState]);

  useEffect(() => {
    if (!username || !bankId) return;
    try { setFavorites(JSON.parse(localStorage.getItem(`qifa-quiz-favorites:${username}:${bankId}`) || '[]')); } catch { setFavorites([]); }
  }, [username, bankId]);

  function toggleFavorite() {
    if (!question) return;
    const next = favorites.includes(question.id) ? favorites.filter(id => id !== question.id) : [...favorites, question.id];
    setFavorites(next);
    try { localStorage.setItem(`qifa-quiz-favorites:${username}:${bankId}`, JSON.stringify(next)); } catch {}
  }

  useEffect(() => {
    if (accessState !== 'granted' || view !== '错题本' || !bankId) return;
    const controller = new AbortController();
    void apiFetch(`/api/wrong?bankId=${encodeURIComponent(bankId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('错题加载失败');
        return await response.json() as { id: string; prompt: string; type: string; category: string }[];
      }).then(items => { if (!controller.signal.aborted) setWrongQuestions(items); })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [view, accessState, bankId]);

  function toggleOption(option: string) {
    if (submitted || saving || !question) return;
    if (question.type !== '多选题') {
      setSelected([option]);
      return;
    }
    setSelected((items) =>
      items.includes(option)
        ? items.filter((item) => item !== option)
        : [...items, option],
    );
  }
  function next() {
    if (current >= questionList.length - 1) { setFinishMessage('本轮练习已完成，可以查看答题卡或重新开始。'); return; }
    setCurrent((value) => value + 1);
    setSelected([]);
    setSubmitted(false);
  }

  async function deleteBank(id: string) {
    if (!window.confirm('删除题库后题目和进度不可恢复，确定删除吗？')) return;
    const response = await apiFetch(`/api/admin/banks/${id}`, { method: 'DELETE' });
    if (!response.ok) { setLoadError('删除题库失败，请先登录管理权限'); return; }
    setBankRevision(v => v + 1);
    if (bankId === id) { setBankId(''); setQuestionList([]); }
  }

  async function submit() {
    if (!selected.length || !question || saving) return;
    setSaving(true);
    try {
      const response = await apiFetch('/api/progress', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questionId: question.id, selected }),
      });
      if (!response.ok) throw new Error('答案保存失败，请重试');
      const data = await response.json() as { correct: boolean };
      setQuestionList(items => items.map(item => item.id === question.id ? { ...item, last_result: Number(data.correct) } : item));
      setSubmitted(true);
      setLoadError('');
    } catch (error) { setLoadError(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  }

  async function importWorkbook(file: File) {
    if (!adminPassword) {
      setImportMessage('请输入题库管理密码');
      return;
    }
    const login = await apiFetch('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    });
    if (!login.ok) {
      setImportMessage(
        ((await login.json()) as { error?: string }).error || '管理登录失败',
      );
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const previewResponse = await apiFetch('/api/admin/preview', {
      method: 'POST',
      body: form,
    });
    const preview = (await previewResponse.json()) as {
      questions?: Question[];
      errors?: { row: number; message: string }[];
      error?: string;
    };
    if (!previewResponse.ok || !preview.questions?.length) {
      setImportMessage(
        preview.error || preview.errors?.[0]?.message || '没有识别到有效题目',
      );
      return;
    }
    const bankResponse = await apiFetch('/api/admin/banks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: file.name.replace(/\.[^.]+$/, '') || '导入题库',
        questions: preview.questions,
      }),
    });
    if (!bankResponse.ok) {
      setImportMessage(
        ((await bankResponse.json()) as { error?: string }).error ||
          '保存题库失败',
      );
      return;
    }
    setImportMessage(
      `已导入 ${preview.questions.length} 道题目${preview.errors?.length ? `，${preview.errors.length} 行未导入` : ''}`,
    );
    const imported = await bankResponse.json() as { id: string };
    setBankRevision(value => value + 1);
    setBankId(imported.id);
    setShowImporter(false);
  }

  if (accessState !== 'granted') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f9fc] px-4 text-slate-900">
        <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-[0_18px_50px_rgba(31,63,114,0.1)]">
          <div className="mb-6 flex items-center gap-3">
            <div className="brand-mark">
              <span>Q</span>
            </div>
            <div>
              <p className="font-bold">Qifa Quiz</p>
              <p className="text-xs text-slate-500">账号登录</p>
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            账号密码登录
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            登录后可选择题库练习，并在用户中心管理登录设备。
          </p>
          <form
            className="mt-6 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void enterPlatform();
            }}
          >
            <input
              aria-label="账号" autoComplete="username" required
              value={username} onChange={event => setUsername(event.target.value)}
              placeholder="账号"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#2161db]"
            />
            <input
              aria-label="密码" autoComplete="current-password" required
              type="password"
              value={accessInput}
              onChange={(event) => setAccessInput(event.target.value)}
              placeholder="密码"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#2161db] focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="submit"
              disabled={loginBusy || accessState === 'checking'}
              className="w-full rounded-xl bg-[#2161db] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1853c4]"
            >
              {accessState === 'checking' ? '检查登录状态…' : loginBusy ? '正在登录…' : '登录'}
            </button>
          </form>
          {accessMessage && (
            <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
              {accessMessage}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-4 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
              aria-label="打开导航"
              onClick={() => setMobileNav((value) => !value)}
            >
              <Menu size={21} />
            </button>
            <div className="brand-mark">
              <span>Q</span>
            </div>
            <div>
              <p className="text-[15px] font-bold tracking-tight">Qifa Quiz</p>
              <p className="hidden text-[11px] text-slate-500 sm:block">
                让每一次练习都留下进步
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 md:flex">
            <CircleHelp size={15} /> 快捷键：按数字键选择答案
          </div>
          <button
            onClick={() => {
              setView('用户中心');
            }}
            className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            <UserCircle size={16} />
            <span className="hidden sm:inline">用户中心</span>
          </button>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside
          className={`${mobileNav ? 'block' : 'hidden'} border-r border-slate-200 bg-white lg:block`}
        >
          <div className="sticky top-16 p-4 lg:p-5">
            <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
              学习空间
            </p>
            <nav className="space-y-1">
              {navItems.map(({ label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => {
                    setView(label);
                    setMobileNav(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === label ? 'bg-[#eaf2ff] text-[#2161db]' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Icon size={17} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="mt-8 border-t border-slate-100 pt-5">
              <p className="mb-3 px-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                我的题库
              </p>
              <button
                onClick={() => {
                  setView('开始练习');
                  setMobileNav(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                <FolderOpen size={17} />
                {currentBank?.name || '选择题库'}
              </button>
              <button
                onClick={() => {
                  setImportMessage('');
                  setShowImporter(true);
                }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-[#2161db] hover:bg-[#f0f5ff]"
              >
                <Upload size={17} />
                导入 Excel 题库
              </button>
            </div>
            <div className="mt-10 rounded-2xl bg-[#f2f6ff] p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600">
                  当前题库进度
                </span>
                <Target size={16} className="text-[#2161db]" />
              </div>
              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className="h-full rounded-full bg-[#2161db]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                已完成 {answeredCount} / {questionList.length} 道题
              </p>
            </div>
          </div>
        </aside>
        <section className="min-w-0 px-4 py-6 sm:px-8 lg:px-12 lg:py-10">
          <div className="mx-auto max-w-5xl">
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-sm font-semibold text-[#2161db]">
                  {view === '用户中心' ? username : currentBank?.name || '选择题库'} · {view}
                </p>
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {view === '用户中心' ? '用户中心' : view === '错题本'
                    ? '复习你的错题'
                    : view === '题库'
                      ? '我的题库'
                      : '继续你的练习'}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  {view === '用户中心' ? '管理账号与登录设备。' : view === '错题本'
                    ? `当前有 ${wrongQuestions.length} 道待复习题目。`
                    : view === '题库'
                      ? '浏览全部题目，按题型筛选，或选择一道题开始练习。'
                      : `记住上次刷到的位置，今天从第 ${current + 1} 题开始。`}
                </p>
              </div>
              {view !== '用户中心' && banks.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="whitespace-nowrap">当前题库</span>
                  <select
                    aria-label="选择题库"
                    value={bankId}
                    onChange={(event) => { setBankId(event.target.value); setWrongQuestions([]); setLoadError(''); }}
                    disabled={saving}
                    className="max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-medium text-slate-700 outline-none focus:border-blue-500"
                  >
                    {banks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.name}（{bank.total}题）
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {view === '错题本' && (
              <div className="mb-6 rounded-2xl border border-orange-100 bg-orange-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-semibold text-orange-800">
                    需要复习的题目
                  </p>
                  <button
                    onClick={() => setView('开始练习')}
                    className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-orange-700 shadow-sm hover:bg-orange-100"
                  >
                    返回刷题
                  </button>
                </div>
                {wrongQuestions.length ? (
                  <div className="space-y-2">
                    {wrongQuestions.slice(0, 8).map((item, index) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          const position = questionList.findIndex(
                            (questionItem) => questionItem.id === item.id,
                          );
                          if (position >= 0) {
                            setCurrent(position);
                            setView('开始练习');
                            setSelected([]);
                            setSubmitted(false);
                          }
                        }}
                        className="block w-full rounded-xl bg-white p-3 text-left text-sm text-slate-700 hover:bg-orange-100"
                      >
                        <span className="mr-2 font-semibold text-orange-600">
                          {index + 1}.
                        </span>
                        {item.prompt}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-orange-700">
                    还没有错题，先完成几道练习吧。
                  </p>
                )}
              </div>
            )}
            {remembered && view === '开始练习' && (
              <div className="mb-5 flex items-center justify-between rounded-xl border border-[#dbe8ff] bg-[#f0f5ff] px-4 py-3 text-sm text-[#2161db]">
                <span>已恢复你上次的练习进度：第 {current + 1} 题</span>
                <button
                  onClick={() => {
                    setCurrent(0);
                    setRemembered(false);
                  }}
                  className="font-semibold hover:underline"
                >
                  从头开始
                </button>
              </div>
            )}
            {loadError && <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{loadError}</p>}
            {view === '用户中心' ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-xl font-bold">账号：{username}</h2>
                <p className="mt-2 text-sm text-slate-500">退出其他设备后，当前设备可以继续使用。</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <button disabled={sessionBusy} onClick={() => void logout(true)} className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">退出其他设备</button>
                  <button disabled={sessionBusy} onClick={() => void logout(false)} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">退出登录</button>
                </div>
                {sessionMessage && <p role="status" className="mt-4 text-sm text-slate-600">{sessionMessage}</p>}
              </div>
            ) : bankId && loadedBankId !== bankId ? (
              <p className="rounded-2xl bg-white p-8 text-slate-500">正在加载题库…</p>
            ) : !question ? (
              <p className="rounded-2xl bg-white p-8 text-slate-500">暂无题目，请导入题库。</p>
            ) : view === '题库' ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_35px_rgba(31,63,114,0.06)] sm:p-8">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      全部题目
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                      共 {questionList.length} 道题，点击题目即可开始练习。
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setView('开始练习');
                      setCurrent(0);
                      setSelected([]);
                      setSubmitted(false);
                    }}
                    className="rounded-xl bg-[#2161db] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-100 hover:bg-[#1853c4]"
                  >
                    开始刷题
                  </button>
                </div>
                <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_160px]">
                  <input
                    aria-label="搜索题目"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索题干或分类"
                    className="min-w-0 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                  <select
                    aria-label="筛选题型"
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-blue-500"
                  >
                    {['全部题型', '单选题', '多选题', '判断题'].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  显示 {filteredQuestions.length} / {questionList.length} 道题
                </p>
                <div className="mb-4 flex flex-wrap gap-2">
                  {banks.map(bank => <button key={bank.id} onClick={() => void deleteBank(bank.id)} className="inline-flex items-center gap-1 rounded-lg border border-rose-100 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50"><Trash2 size={13}/>删除“{bank.name}”</button>)}
                </div>
                <div className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
                  {filteredQuestions.map(({ item, index }) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setCurrent(index);
                        setView('开始练习');
                        setSelected([]);
                        setSubmitted(false);
                      }}
                      className="flex w-full items-start gap-4 p-4 text-left transition hover:bg-slate-50 sm:p-5"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#eaf2ff] text-sm font-bold text-[#2161db]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            {item.type}
                          </span>
                          {item.category && (
                            <span className="text-xs text-slate-400">
                              {item.category}
                            </span>
                          )}
                          <span
                            className={`text-xs ${item.last_result === 1 ? 'text-emerald-600' : item.last_result === 0 ? 'text-orange-600' : 'text-slate-400'}`}
                          >
                            {item.last_result === 1
                              ? '已答对'
                              : item.last_result === 0
                                ? '待复习'
                                : '未作答'}
                          </span>
                        </span>
                        <span className="block text-[15px] leading-6 text-slate-800">
                          {item.prompt}
                        </span>
                      </span>
                      <ChevronRight
                        size={18}
                        className="mt-2 shrink-0 text-slate-300"
                      />
                    </button>
                  ))}
                  {!filteredQuestions.length && (
                    <p className="p-8 text-center text-sm text-slate-500">
                      没有符合条件的题目，请调整搜索词或题型。
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_250px]">
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_12px_35px_rgba(31,63,114,0.06)] sm:p-8">
                  <div className="mb-7 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#eaf2ff] px-3 py-1.5 text-xs font-bold text-[#2161db]">
                        {question.type}
                      </span>
                      <span className="text-xs text-slate-400">
                        第 {current + 1} / {questionList.length} 题
                      </span>
                    </div>
                    <div className="flex items-center gap-3"><button aria-label={favorites.includes(question.id) ? '取消收藏' : '收藏题目'} onClick={toggleFavorite} className="text-amber-500"><Star size={19} fill={favorites.includes(question.id) ? 'currentColor' : 'none'} /></button><button onClick={() => setShowAnswerCard(true)} className="text-xs font-semibold text-slate-500 hover:text-[#2161db]">答题卡</button><span className="text-xs font-semibold text-slate-400">{progress}% 完成</span></div>
                  </div>
                  <div className="mb-7 h-1.5 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-[#2161db] transition-all"
                      style={{ width: `${Math.max(10, progress)}%` }}
                    />
                  </div>
                  <h2 className="max-w-3xl text-xl font-semibold leading-relaxed tracking-tight sm:text-2xl">
                    {question.prompt}
                  </h2>
                  <p className="mb-5 mt-3 text-sm text-slate-400">
                    {question.type === '多选题'
                      ? '请选择所有正确答案'
                      : '请选择一个答案'}
                  </p>
                  <div className="space-y-3">
                    {question.options.map((option, index) => {
                      const letter = String.fromCharCode(65 + index);
                      const active = selected.includes(letter);
                      const correct =
                        submitted && question.answer.includes(letter);
                      return (
                        <button
                          key={letter}
                          onClick={() => toggleOption(letter)}
                          className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition ${correct ? 'border-emerald-300 bg-emerald-50' : active ? 'border-[#2161db] bg-[#f0f5ff] shadow-sm' : 'border-slate-200 hover:border-[#9bbcff] hover:bg-slate-50'}`}
                        >
                          <span
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${correct ? 'bg-emerald-500 text-white' : active ? 'bg-[#2161db] text-white' : 'bg-slate-100 text-slate-500'}`}
                          >
                            {correct ? <Check size={16} /> : letter}
                          </span>
                          <span className="pt-0.5 text-[15px] leading-6">
                            {option}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {submitted && (
                    <div
                      className={`mt-6 rounded-2xl border p-4 ${isCorrect ? 'border-emerald-200 bg-emerald-50' : 'border-orange-200 bg-orange-50'}`}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {isCorrect ? (
                          <>
                            <Check size={18} className="text-emerald-600" />
                            回答正确
                          </>
                        ) : (
                          <>
                            <X size={18} className="text-orange-600" />
                            再想一想
                          </>
                        )}
                        <span className="text-sm font-normal text-slate-600">
                          正确答案：{question.answer.join('、')}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {question.explanation}
                      </p>
                    </div>
                  )}
                  <div className="mt-8 flex items-center justify-between gap-3">
                    <button
                      onClick={() => {
                        setCurrent(Math.max(0, current - 1));
                        setSelected([]);
                        setSubmitted(false);
                      }}
                      disabled={current === 0 || saving}
                      className="flex items-center gap-1 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ChevronLeft size={17} />
                      上一题
                    </button>
                    {submitted ? (
                      <button
                        onClick={next}
                        className="flex items-center gap-2 rounded-xl bg-[#2161db] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-200 hover:bg-[#1853c4]"
                      >
                        下一题
                        <ChevronRight size={17} />
                      </button>
                    ) : (
                      <button
                        onClick={() => void submit()}
                        disabled={!selected.length || saving}
                        className="rounded-xl bg-[#2161db] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-200 hover:bg-[#1853c4] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        提交答案
                      </button>
                    )}
                  </div>
                  {finishMessage && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">{finishMessage}</p>}
                </div>
                <aside className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-white p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <BookOpen size={17} className="text-[#2161db]" />
                      <h3 className="font-semibold">题库概览</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-xl font-bold">
                          {questionList.length}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">总题数</p>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-3">
                        <p className="text-xl font-bold">
                          {answeredCount ? `${Math.round(correctCount / answeredCount * 100)}%` : '—'}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">正确率</p>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                      <span>已掌握 {correctCount} 题</span>
                      <span>
                        待复习{' '}
                        {answeredCount - correctCount} 题
                      </span>
                    </div>
                  </div>
                  <div className="rounded-3xl border border-[#dbe8ff] bg-[#f0f5ff] p-5">
                    <div className="mb-2 flex items-center gap-2 text-[#2161db]">
                      <Sparkles size={17} />
                      <h3 className="font-semibold">学习提醒</h3>
                    </div>
                    <p className="text-sm leading-6 text-slate-600">
                      每天完成 10 道题，连续练习比一次刷完更容易记住。
                    </p>
                  </div>
                </aside>
              </div>
            )}
          </div>
        </section>
      </div>
      {showImporter && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4">
          <dialog
            open
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">导入 Excel 题库</h2>
                <p className="mt-1 text-sm text-slate-500">
                  支持 .xlsx 文件，导入后立即开始练习。
                </p>
              </div>
              <button
                onClick={() => setShowImporter(false)}
                className="rounded-lg p-2 hover:bg-slate-100"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            </div>
            <input
              type="password"
              value={adminPassword}
              onChange={(event) => setAdminPassword(event.target.value)}
              placeholder="题库管理密码"
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#2161db]"
            />
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#b9d0ff] bg-[#f6f9ff] px-5 py-10 text-center hover:bg-[#f0f5ff]">
              <FileSpreadsheet size={30} className="mb-3 text-[#2161db]" />
              <span className="text-sm font-semibold text-slate-700">
                点击选择 Excel 文件
              </span>
              <span className="mt-1 text-xs text-slate-400">
                或将文件拖拽到这里
              </span>
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importWorkbook(file).catch(() => setImportMessage('导入失败，请检查网络后重试'));
                  event.target.value = '';
                }}
              />
            </label>
            {importMessage && (
              <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-700">
                {importMessage}
              </p>
            )}
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
              建议列：题目、题型、选项、答案、解析、分类。
              <a
                className="ml-1 font-semibold text-[#2161db]"
                href="/api/template"
              >
                下载模板
              </a>
            </div>
          </dialog>
        </div>
      )}
      {showAnswerCard && <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 p-4" onClick={() => setShowAnswerCard(false)}><div role="dialog" aria-label="答题卡" className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">答题卡</h2><button aria-label="关闭" onClick={() => setShowAnswerCard(false)}><X size={18}/></button></div><div className="grid grid-cols-6 gap-2 sm:grid-cols-8">{questionList.map((item, index) => <button key={item.id} onClick={() => { setCurrent(index); setSelected([]); setSubmitted(false); setShowAnswerCard(false); setFinishMessage(''); }} className={`h-9 rounded-lg text-sm font-semibold ${index === current ? 'bg-[#2161db] text-white' : item.last_result === 1 ? 'bg-emerald-100 text-emerald-700' : item.last_result === 0 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{index + 1}</button>)}</div><p className="mt-4 text-xs text-slate-500">蓝色为当前题，绿色已答对，橙色待复习。</p></div></div>}
    </main>
  );
}
