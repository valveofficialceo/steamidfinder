"use client";

import { useState, useCallback, useRef, useEffect } from "react";

type SteamIdStatus = "AVAILABLE" | "TAKEN" | "RESERVED_OR_UNKNOWN";

type CheckResult = {
  vanityUrl: string;
  status: SteamIdStatus;
  steamId64?: string;
  reason?: string;
  error?: string;
  cached?: boolean;
};

type HistoryItem = {
  id: number;
  vanityUrl: string;
  status: string;
  steamId64?: string;
  reason?: string;
  checkedAt: string;
};

type RepeatingMode =
  | "same_digit"
  | "same_letter"
  | "same_any"
  | "repeated_pair"
  | "sequential_digits"
  | "palindrome"
  | "prefix_repeat"
  | "suffix_repeat"
  | "all";

const REPEATING_MODES: { value: RepeatingMode; label: string; icon: string; desc: string }[] = [
  { value: "same_digit", label: "Одинаковые цифры", icon: "🔢", desc: "666, 9999, 1111" },
  { value: "same_letter", label: "Одинаковые буквы", icon: "🔤", desc: "aaa, zzzz, bbbb" },
  { value: "same_any", label: "Все одинаковые", icon: "🎯", desc: "Цифры + буквы" },
  { value: "repeated_pair", label: "Повторяющиеся пары", icon: "🔁", desc: "6969, abab, 1212" },
  { value: "sequential_digits", label: "Последовательности", icon: "📈", desc: "1234, 4567, 9876" },
  { value: "palindrome", label: "Палиндромы", icon: "🪞", desc: "1221, abba, 12321" },
  { value: "prefix_repeat", label: "Префикс + повтор", icon: "➡️", desc: "a666, x999, b111" },
  { value: "suffix_repeat", label: "Повтор + суффикс", icon: "⬅️", desc: "666a, 999x, 111b" },
  { value: "all", label: "Все типы сразу", icon: "🌟", desc: "Все комбинации" },
];

// Helpers for status
function getStatusIcon(status: SteamIdStatus): string {
  switch (status) {
    case "AVAILABLE": return "✅";
    case "TAKEN": return "❌";
    case "RESERVED_OR_UNKNOWN": return "⚠️";
  }
}

function getStatusLabel(status: SteamIdStatus): string {
  switch (status) {
    case "AVAILABLE": return "Вероятно свободен";
    case "TAKEN": return "Занят";
    case "RESERVED_OR_UNKNOWN": return "Зарезервирован";
  }
}

function getStatusColor(status: SteamIdStatus): string {
  switch (status) {
    case "AVAILABLE": return "text-[#4caf50]";
    case "TAKEN": return "text-[#f44336]";
    case "RESERVED_OR_UNKNOWN": return "text-[#ff9800]";
  }
}

function getStatusBgColor(status: SteamIdStatus): string {
  switch (status) {
    case "AVAILABLE": return "bg-[#1e3a1e] text-[#4caf50]";
    case "TAKEN": return "bg-[#3a1e1e] text-[#f44336]";
    case "RESERVED_OR_UNKNOWN": return "bg-[#3a2a1e] text-[#ff9800]";
  }
}

function isAvailable(status: SteamIdStatus): boolean {
  return status === "AVAILABLE";
}

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<"search" | "repeating" | "single" | "history">("search");

  // --- Batch search state ---
  const [minLength, setMinLength] = useState(4);
  const [maxLength, setMaxLength] = useState(5);
  const [charset, setCharset] = useState("alphanumeric");
  const [batchSize, setBatchSize] = useState(10);
  const [pattern, setPattern] = useState("");
  const [results, setResults] = useState<CheckResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [totalChecked, setTotalChecked] = useState(0);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [autoSearch, setAutoSearch] = useState(false);
  const autoSearchRef = useRef(false);

  // --- Repeating search state ---
  const [repMode, setRepMode] = useState<RepeatingMode>("same_digit");
  const [repMinLen, setRepMinLen] = useState(3);
  const [repMaxLen, setRepMaxLen] = useState(6);
  const [repLimit, setRepLimit] = useState(15);
  const [repOffset, setRepOffset] = useState(0);
  const [repResults, setRepResults] = useState<CheckResult[]>([]);
  const [repIsSearching, setRepIsSearching] = useState(false);
  const [repHasMore, setRepHasMore] = useState(false);
  const [repTotalGenerated, setRepTotalGenerated] = useState(0);
  const [repTotalChecked, setRepTotalChecked] = useState(0);
  const [repTotalAvailable, setRepTotalAvailable] = useState(0);

  // --- Single check state ---
  const [singleId, setSingleId] = useState("");
  const [singleResult, setSingleResult] = useState<CheckResult | null>(null);
  const [isSingleChecking, setIsSingleChecking] = useState(false);

  // --- History state ---
  const [historyAvailable, setHistoryAvailable] = useState<HistoryItem[]>([]);
  const [historyRecent, setHistoryRecent] = useState<HistoryItem[]>([]);

  // ========== BATCH SEARCH ==========
  const runBatchSearch = useCallback(async () => {
    setIsSearching(true);
    try {
      const res = await fetch("/api/check-steam-ids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minLength, maxLength, charset, batchSize, pattern: pattern || "" }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setResults((prev) => [...data.results, ...prev]);
      setTotalChecked((prev) => prev + data.totalChecked);
      setTotalAvailable((prev) => prev + data.totalAvailable);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  }, [minLength, maxLength, charset, batchSize, pattern]);

  useEffect(() => {
    autoSearchRef.current = autoSearch;
  }, [autoSearch]);

  useEffect(() => {
    if (!autoSearch) return;
    let cancelled = false;
    const loop = async () => {
      while (autoSearchRef.current && !cancelled) {
        await runBatchSearch();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    };
    loop();
    return () => { cancelled = true; };
  }, [autoSearch, runBatchSearch]);

  // ========== REPEATING SEARCH ==========
  const runRepeatingSearch = useCallback(async (resetResults = false) => {
    setRepIsSearching(true);
    const currentOffset = resetResults ? 0 : repOffset;
    try {
      const res = await fetch("/api/check-repeating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: repMode,
          minLength: repMinLen,
          maxLength: repMaxLen,
          offset: currentOffset,
          limit: repLimit,
        }),
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();

      if (resetResults) {
        setRepResults(data.results);
      } else {
        setRepResults((prev) => [...prev, ...data.results]);
      }
      setRepHasMore(data.hasMore);
      setRepTotalGenerated(data.totalGenerated);
      setRepTotalChecked((prev) => (resetResults ? data.totalChecked : prev + data.totalChecked));
      setRepTotalAvailable((prev) => (resetResults ? data.totalAvailable : prev + data.totalAvailable));
      setRepOffset(currentOffset + data.results.length);
    } catch (err) {
      console.error(err);
    } finally {
      setRepIsSearching(false);
    }
  }, [repMode, repMinLen, repMaxLen, repLimit, repOffset]);

  const startNewRepeatingSearch = useCallback(() => {
    setRepOffset(0);
    setRepResults([]);
    setRepTotalChecked(0);
    setRepTotalAvailable(0);
    runRepeatingSearch(true);
  }, [runRepeatingSearch]);

  // ========== SINGLE CHECK ==========
  const checkSingleId = async () => {
    if (!singleId.trim()) return;
    setIsSingleChecking(true);
    setSingleResult(null);
    try {
      const res = await fetch("/api/check-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vanityUrl: singleId.trim() }),
      });
      if (!res.ok) throw new Error("Check failed");
      const data = await res.json();
      setSingleResult(data);
    } catch {
      setSingleResult({ 
        vanityUrl: singleId, 
        status: "RESERVED_OR_UNKNOWN", 
        error: "Ошибка проверки" 
      });
    } finally {
      setIsSingleChecking(false);
    }
  };

  // ========== HISTORY ==========
  const loadHistory = async () => {
    try {
      const res = await fetch("/api/history");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setHistoryAvailable(data.available);
      setHistoryRecent(data.recent);
    } catch {
      console.error("Failed to load history");
    }
  };

  useEffect(() => {
    if (activeTab === "history") loadHistory();
  }, [activeTab]);

  const availableResults = results.filter((r) => isAvailable(r.status));
  const repAvailableResults = repResults.filter((r) => isAvailable(r.status));

  // Global counters
  const globalChecked = totalChecked + repTotalChecked;
  const globalAvailable = totalAvailable + repTotalAvailable;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-[#171a21] border-b border-[#2a475e] sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎮</div>
            <div>
              <h1 className="text-xl font-bold text-[#66c0f4]">Steam ID Finder</h1>
              <p className="text-xs text-[#8f98a0]">Поиск свободных коротких Steam ID</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[#8f98a0]">Проверено:</span>
            <span className="text-[#66c0f4] font-bold">{globalChecked}</span>
            <span className="text-[#8f98a0] ml-2">Вероятно свободно:</span>
            <span className="text-[#4caf50] font-bold">{globalAvailable}</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="bg-[#1b2838] border-b border-[#2a475e]">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto">
            {([
              { key: "search" as const, label: "🔍 Массовый поиск" },
              { key: "repeating" as const, label: "🔢 Повторяющиеся" },
              { key: "single" as const, label: "🎯 Проверить один" },
              { key: "history" as const, label: "📋 История" },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap ${
                  activeTab === tab.key
                    ? "border-[#66c0f4] text-[#66c0f4] bg-[#2a475e]/30"
                    : "border-transparent text-[#8f98a0] hover:text-[#c7d5e0] hover:bg-[#2a475e]/20"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-6">

        {/* ==================== BATCH SEARCH TAB ==================== */}
        {activeTab === "search" && (
          <div className="space-y-6">
            <div className="bg-[#16202d] rounded-lg border border-[#2a475e] p-6">
              <h2 className="text-lg font-semibold text-[#66c0f4] mb-4">⚙️ Настройки поиска</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Мин. длина</label>
                  <input type="number" min={3} max={20} value={minLength}
                    onChange={(e) => setMinLength(Math.max(3, Math.min(20, parseInt(e.target.value) || 3)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Макс. длина</label>
                  <input type="number" min={3} max={20} value={maxLength}
                    onChange={(e) => setMaxLength(Math.max(3, Math.min(20, parseInt(e.target.value) || 5)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Набор символов</label>
                  <select value={charset} onChange={(e) => setCharset(e.target.value)}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors">
                    <option value="alphanumeric">Буквы + цифры (a-z, 0-9)</option>
                    <option value="letters">Только буквы (a-z)</option>
                    <option value="digits">Только цифры (0-9)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Размер пачки</label>
                  <input type="number" min={1} max={20} value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(1, Math.min(20, parseInt(e.target.value) || 5)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm text-[#8f98a0] mb-1">Паттерн (опционально, * = любой символ)</label>
                  <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)}
                    placeholder="Пример: a*** или **69 или pro*"
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors placeholder:text-[#4e6a7e]" />
                </div>
              </div>
              <div className="flex flex-wrap gap-3 mt-6">
                <button onClick={runBatchSearch} disabled={isSearching}
                  className="px-6 py-2.5 bg-[#4caf50] hover:bg-[#45a049] text-white font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {isSearching && !autoSearch ? (<><span className="animate-spin-slow inline-block">⏳</span>Поиск...</>) : (<>🔍 Запустить поиск</>)}
                </button>
                <button onClick={() => setAutoSearch(!autoSearch)}
                  className={`px-6 py-2.5 font-medium rounded transition-all flex items-center gap-2 ${autoSearch ? "bg-[#f44336] hover:bg-[#d32f2f] text-white animate-pulse-glow" : "bg-[#2196f3] hover:bg-[#1976d2] text-white"}`}>
                  {autoSearch ? (<>⏹️ Остановить авто-поиск</>) : (<>🔄 Авто-поиск</>)}
                </button>
                <button onClick={() => { setResults([]); setTotalChecked(0); setTotalAvailable(0); }}
                  className="px-6 py-2.5 bg-[#2a475e] hover:bg-[#3d6c8e] text-[#c7d5e0] font-medium rounded transition-all">
                  🗑️ Очистить
                </button>
              </div>
            </div>

            {/* Results grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ResultPanel 
                title="✅ Вероятно свободные ID" 
                items={availableResults} 
                bgHeader="bg-[#1e3a1e]" 
                borderHeader="border-[#2a5a2a]" 
                titleColor="text-[#4caf50]" 
                emptyIcon="🔍" 
                emptyText="Свободные ID появятся здесь" 
              />
              <AllResultsPanel items={results} />
            </div>
          </div>
        )}

        {/* ==================== REPEATING TAB ==================== */}
        {activeTab === "repeating" && (
          <div className="space-y-6">
            {/* Mode selector */}
            <div className="bg-[#16202d] rounded-lg border border-[#2a475e] p-6">
              <h2 className="text-lg font-semibold text-[#66c0f4] mb-2">🔢 Поиск повторяющихся комбинаций</h2>
              <p className="text-sm text-[#8f98a0] mb-5">Ищет свободные Steam ID из одинаковых цифр, букв, последовательностей и паттернов</p>

              {/* Warning about reserved IDs */}
              <div className="mb-5 p-3 bg-[#3a2a1e] border border-[#5a3a1e] rounded-lg">
                <p className="text-sm text-[#ff9800]">
                  ⚠️ <strong>Внимание:</strong> Многие короткие и повторяющиеся ID зарезервированы Steam и не могут быть заняты, 
                  даже если профиль не найден. Статус «Вероятно свободен» не гарантирует возможность регистрации.
                </p>
              </div>

              {/* Mode cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {REPEATING_MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setRepMode(m.value)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      repMode === m.value
                        ? "border-[#66c0f4] bg-[#2a475e]/50 shadow-lg shadow-[#66c0f4]/10"
                        : "border-[#2a475e] bg-[#1b2838] hover:border-[#3d6c8e] hover:bg-[#2a475e]/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{m.icon}</span>
                      <span className={`text-sm font-medium ${repMode === m.value ? "text-[#66c0f4]" : "text-[#c7d5e0]"}`}>
                        {m.label}
                      </span>
                    </div>
                    <div className="text-xs text-[#8f98a0] font-mono">{m.desc}</div>
                  </button>
                ))}
              </div>

              {/* Length settings */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Мин. длина</label>
                  <input type="number" min={3} max={12} value={repMinLen}
                    onChange={(e) => setRepMinLen(Math.max(3, Math.min(12, parseInt(e.target.value) || 3)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Макс. длина</label>
                  <input type="number" min={3} max={12} value={repMaxLen}
                    onChange={(e) => setRepMaxLen(Math.max(3, Math.min(12, parseInt(e.target.value) || 6)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
                <div>
                  <label className="block text-sm text-[#8f98a0] mb-1">Проверять за раз</label>
                  <input type="number" min={1} max={30} value={repLimit}
                    onChange={(e) => setRepLimit(Math.max(1, Math.min(30, parseInt(e.target.value) || 15)))}
                    className="w-full bg-[#2a475e] border border-[#3d6c8e] rounded px-3 py-2 text-[#c7d5e0] focus:outline-none focus:border-[#66c0f4] transition-colors" />
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <button onClick={startNewRepeatingSearch} disabled={repIsSearching}
                  className="px-6 py-2.5 bg-[#4caf50] hover:bg-[#45a049] text-white font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {repIsSearching ? (<><span className="animate-spin-slow inline-block">⏳</span>Проверяю...</>) : (<>🚀 Начать проверку</>)}
                </button>
                {repHasMore && repResults.length > 0 && (
                  <button onClick={() => runRepeatingSearch(false)} disabled={repIsSearching}
                    className="px-6 py-2.5 bg-[#2196f3] hover:bg-[#1976d2] text-white font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                    {repIsSearching ? (<><span className="animate-spin-slow inline-block">⏳</span>Загружаю...</>) : (<>📥 Загрузить ещё</>)}
                  </button>
                )}
                <button onClick={() => { setRepResults([]); setRepOffset(0); setRepTotalChecked(0); setRepTotalAvailable(0); }}
                  className="px-6 py-2.5 bg-[#2a475e] hover:bg-[#3d6c8e] text-[#c7d5e0] font-medium rounded transition-all">
                  🗑️ Очистить
                </button>
              </div>

              {/* Stats bar */}
              {repResults.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8f98a0]">Всего комбинаций:</span>
                    <span className="text-[#66c0f4] font-bold">{repTotalGenerated}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8f98a0]">Проверено:</span>
                    <span className="text-[#66c0f4] font-bold">{repResults.length}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#8f98a0]">Вероятно свободно:</span>
                    <span className="text-[#4caf50] font-bold">{repAvailableResults.length}</span>
                  </div>
                  {repHasMore && (
                    <div className="text-[#ff9800] text-xs flex items-center gap-1">
                      ⚡ Есть ещё комбинации для проверки
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Repeating Results */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ResultPanel 
                title="✅ Вероятно свободные ID" 
                items={repAvailableResults}
                bgHeader="bg-[#1e3a1e]" 
                borderHeader="border-[#2a5a2a]" 
                titleColor="text-[#4caf50]"
                emptyIcon="🔢" 
                emptyText="Свободные повторяющиеся ID появятся здесь" 
              />
              <AllResultsPanel items={repResults} />
            </div>
          </div>
        )}

        {/* ==================== SINGLE CHECK TAB ==================== */}
        {activeTab === "single" && (
          <div className="max-w-xl mx-auto space-y-6">
            <div className="bg-[#16202d] rounded-lg border border-[#2a475e] p-6">
              <h2 className="text-lg font-semibold text-[#66c0f4] mb-4">🎯 Проверить конкретный Steam ID</h2>
              <div className="flex gap-3">
                <div className="flex-1">
                  <div className="flex items-center bg-[#2a475e] border border-[#3d6c8e] rounded overflow-hidden focus-within:border-[#66c0f4] transition-colors">
                    <span className="px-3 text-sm text-[#8f98a0] whitespace-nowrap">steamcommunity.com/id/</span>
                    <input type="text" value={singleId} onChange={(e) => setSingleId(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && checkSingleId()}
                      placeholder="your_id"
                      className="flex-1 bg-transparent py-2.5 pr-3 text-[#c7d5e0] focus:outline-none placeholder:text-[#4e6a7e] font-mono" />
                  </div>
                </div>
                <button onClick={checkSingleId} disabled={isSingleChecking || !singleId.trim()}
                  className="px-6 py-2.5 bg-[#66c0f4] hover:bg-[#4fa3d4] text-[#1b2838] font-medium rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                  {isSingleChecking ? (<span className="animate-spin-slow inline-block">⏳</span>) : "Проверить"}
                </button>
              </div>

              {singleResult && (
                <div className={`mt-6 p-4 rounded-lg border animate-slide-in ${
                  singleResult.status === "AVAILABLE" ? "bg-[#1e3a1e] border-[#2a5a2a]"
                    : singleResult.status === "RESERVED_OR_UNKNOWN" ? "bg-[#3a2a1e] border-[#5a3a1e]"
                    : "bg-[#3a1e1e] border-[#5a2a2a]"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">
                        {singleResult.status === "AVAILABLE" ? "🎉" 
                          : singleResult.status === "RESERVED_OR_UNKNOWN" ? "⚠️" 
                          : "😞"}
                      </span>
                      <div>
                        <div className="font-mono font-bold text-lg">{singleResult.vanityUrl}</div>
                        <div className={`text-sm ${getStatusColor(singleResult.status)}`}>
                          {getStatusIcon(singleResult.status)} {getStatusLabel(singleResult.status)}
                        </div>
                        {singleResult.reason && (
                          <div className="text-xs text-[#8f98a0] mt-1">{singleResult.reason}</div>
                        )}
                        {singleResult.steamId64 && (
                          <div className="text-xs text-[#8f98a0] mt-1">
                            Steam ID: {singleResult.steamId64}
                          </div>
                        )}
                      </div>
                    </div>
                    <a href={`https://steamcommunity.com/id/${singleResult.vanityUrl}`} target="_blank" rel="noopener noreferrer"
                      className="text-sm px-4 py-2 bg-[#2a475e] hover:bg-[#3d6c8e] rounded text-[#66c0f4] transition-colors">
                      Открыть в Steam ↗
                    </a>
                  </div>
                  {singleResult.cached && (
                    <div className="mt-2 text-xs text-[#8f98a0]">📦 Результат из кеша (проверено ранее)</div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-[#16202d] rounded-lg border border-[#2a475e] p-6">
              <h3 className="text-sm font-semibold text-[#66c0f4] mb-3">💡 О статусах проверки</h3>
              <ul className="space-y-2 text-sm text-[#8f98a0]">
                <li className="flex items-start gap-2">
                  <span className="text-[#4caf50]">✅</span>
                  <span><strong className="text-[#4caf50]">Вероятно свободен</strong> — профиль не найден и паттерн допустим. Но Steam может отклонить при попытке регистрации.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#f44336]">❌</span>
                  <span><strong className="text-[#f44336]">Занят</strong> — ID уже используется другим аккаунтом Steam.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#ff9800]">⚠️</span>
                  <span><strong className="text-[#ff9800]">Зарезервирован</strong> — короткий ID, только цифры, или известный паттерн, который Steam обычно не разрешает.</span>
                </li>
              </ul>
            </div>

            <div className="bg-[#16202d] rounded-lg border border-[#2a475e] p-6">
              <h3 className="text-sm font-semibold text-[#66c0f4] mb-3">📋 Правила Steam Custom URL</h3>
              <ul className="space-y-2 text-sm text-[#8f98a0]">
                <li className="flex items-start gap-2"><span>•</span><span>Разрешены: буквы (a-z), цифры (0-9), подчёркивание (_), дефис (-)</span></li>
                <li className="flex items-start gap-2"><span>•</span><span>Длина: от 3 до 32 символов</span></li>
                <li className="flex items-start gap-2"><span>•</span><span>ID из <strong>только цифр</strong> (111, 1234) обычно зарезервированы</span></li>
                <li className="flex items-start gap-2"><span>•</span><span>Очень короткие ID (3-4 символа) часто зарезервированы</span></li>
                <li className="flex items-start gap-2"><span>•</span><span>Слова "steam", "valve", "admin" и т.п. зарезервированы</span></li>
              </ul>
            </div>
          </div>
        )}

        {/* ==================== HISTORY TAB ==================== */}
        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#66c0f4]">📋 История проверок</h2>
              <button onClick={loadHistory} className="px-4 py-2 bg-[#2a475e] hover:bg-[#3d6c8e] text-[#c7d5e0] text-sm rounded transition-colors">
                🔄 Обновить
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-[#16202d] rounded-lg border border-[#2a475e] overflow-hidden">
                <div className="px-4 py-3 bg-[#1e3a1e] border-b border-[#2a5a2a]">
                  <h3 className="font-semibold text-[#4caf50]">✅ Вероятно свободные ID ({historyAvailable.length})</h3>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {historyAvailable.length === 0 ? (
                    <div className="p-8 text-center text-[#4e6a7e]"><div className="text-4xl mb-2">🔍</div><p>Пока нет свободных ID</p></div>
                  ) : (
                    <div className="divide-y divide-[#2a475e]">
                      {historyAvailable.map((item) => (
                        <div key={item.id} className="px-4 py-3 flex items-center justify-between hover:bg-[#2a475e]/20 transition-colors">
                          <div>
                            <span className="font-mono text-[#4caf50] font-bold">{item.vanityUrl}</span>
                            <span className="text-xs text-[#8f98a0] ml-2">{new Date(item.checkedAt).toLocaleString("ru-RU")}</span>
                            {item.reason && <div className="text-xs text-[#8f98a0]">{item.reason}</div>}
                          </div>
                          <a href={`https://steamcommunity.com/id/${item.vanityUrl}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs px-3 py-1 bg-[#2a475e] hover:bg-[#3d6c8e] rounded text-[#66c0f4] transition-colors">Открыть ↗</a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="bg-[#16202d] rounded-lg border border-[#2a475e] overflow-hidden">
                <div className="px-4 py-3 bg-[#2a475e]/30 border-b border-[#2a475e]">
                  <h3 className="font-semibold text-[#c7d5e0]">🕐 Последние проверки ({historyRecent.length})</h3>
                </div>
                <div className="max-h-[600px] overflow-y-auto">
                  {historyRecent.length === 0 ? (
                    <div className="p-8 text-center text-[#4e6a7e]"><div className="text-4xl mb-2">📊</div><p>Нет истории проверок</p></div>
                  ) : (
                    <div className="divide-y divide-[#2a475e]">
                      {historyRecent.map((item) => (
                        <div key={item.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-[#2a475e]/20 transition-colors">
                          <div className="flex items-center gap-2">
                            <span>{getStatusIcon(item.status as SteamIdStatus)}</span>
                            <span className={`font-mono text-sm ${getStatusColor(item.status as SteamIdStatus)}`}>{item.vanityUrl}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${getStatusBgColor(item.status as SteamIdStatus)}`}>
                              {getStatusLabel(item.status as SteamIdStatus)}
                            </span>
                            <span className="text-xs text-[#4e6a7e]">{new Date(item.checkedAt).toLocaleString("ru-RU")}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#2a475e] mt-8">
        <div className="max-w-6xl mx-auto px-4 py-4 text-center text-sm text-[#4e6a7e]">
          <p>Steam ID Finder — проверяет доступность Custom URL на{" "}
            <a href="https://steamcommunity.com" target="_blank" rel="noopener noreferrer" className="text-[#66c0f4] hover:underline">steamcommunity.com</a>
          </p>
          <p className="mt-1 text-xs">
            ⚠️ Статус «Вероятно свободен» не гарантирует возможность регистрации — Steam резервирует многие короткие и популярные ID.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ==================== REUSABLE COMPONENTS ==================== */

function ResultPanel({ title, items, bgHeader, borderHeader, titleColor, emptyIcon, emptyText }: {
  title: string; items: CheckResult[]; bgHeader: string; borderHeader: string; titleColor: string; emptyIcon: string; emptyText: string;
}) {
  return (
    <div className="bg-[#16202d] rounded-lg border border-[#2a475e] overflow-hidden">
      <div className={`px-4 py-3 ${bgHeader} border-b ${borderHeader} flex items-center justify-between`}>
        <h3 className={`font-semibold ${titleColor} flex items-center gap-2`}>
          {title}
          <span className="bg-[#4caf50] text-white text-xs px-2 py-0.5 rounded-full">{items.length}</span>
        </h3>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-8 text-center text-[#4e6a7e]">
            <div className="text-4xl mb-2">{emptyIcon}</div>
            <p>{emptyText}</p>
          </div>
        ) : (
          <div className="divide-y divide-[#2a475e]">
            {items.map((r, i) => (
              <div key={`${r.vanityUrl}-${i}`} className="px-4 py-3 flex items-center justify-between hover:bg-[#2a475e]/30 transition-colors animate-slide-in">
                <div>
                  <span className="font-mono text-[#4caf50] font-bold text-lg">{r.vanityUrl}</span>
                  <span className="text-xs text-[#8f98a0] ml-2">({r.vanityUrl.length} символов)</span>
                  {r.reason && <div className="text-xs text-[#8f98a0]">{r.reason}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { navigator.clipboard.writeText(r.vanityUrl); }}
                    className="text-xs px-2 py-1 bg-[#2a475e] hover:bg-[#3d6c8e] rounded text-[#8f98a0] hover:text-[#c7d5e0] transition-colors"
                    title="Копировать"
                  >📋</button>
                  <a href={`https://steamcommunity.com/id/${r.vanityUrl}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs px-3 py-1 bg-[#2a475e] hover:bg-[#3d6c8e] rounded text-[#66c0f4] transition-colors">
                    Открыть ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AllResultsPanel({ items }: { items: CheckResult[] }) {
  return (
    <div className="bg-[#16202d] rounded-lg border border-[#2a475e] overflow-hidden">
      <div className="px-4 py-3 bg-[#2a475e]/30 border-b border-[#2a475e] flex items-center justify-between">
        <h3 className="font-semibold text-[#c7d5e0] flex items-center gap-2">
          📋 Все результаты
          <span className="bg-[#2a475e] text-[#8f98a0] text-xs px-2 py-0.5 rounded-full">{items.length}</span>
        </h3>
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {items.length === 0 ? (
          <div className="p-8 text-center text-[#4e6a7e]">
            <div className="text-4xl mb-2">📊</div>
            <p>Результаты проверки появятся здесь</p>
          </div>
        ) : (
          <div className="divide-y divide-[#2a475e]">
            {items.map((r, i) => (
              <div key={`${r.vanityUrl}-all-${i}`} className="px-4 py-2.5 flex items-center justify-between hover:bg-[#2a475e]/20 transition-colors animate-slide-in">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${getStatusColor(r.status)}`}>
                      {getStatusIcon(r.status)}
                    </span>
                    <span className={`font-mono text-sm ${getStatusColor(r.status)}`}>{r.vanityUrl}</span>
                  </div>
                  {r.reason && (
                    <div className="text-xs text-[#8f98a0] ml-6 truncate">{r.reason}</div>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ml-2 ${getStatusBgColor(r.status)}`}>
                  {getStatusLabel(r.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
