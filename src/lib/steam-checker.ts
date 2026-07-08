/**
 * Steam Vanity URL Checker
 * 
 * Проверяет доступность Steam Custom URL с учётом:
 * - Занятых профилей
 * - Зарезервированных Steam коротких ID
 * - Запрещённых паттернов (только цифры, и т.д.)
 */

export type SteamIdStatus = "AVAILABLE" | "TAKEN" | "RESERVED_OR_UNKNOWN";

export interface SteamCheckResult {
  vanityUrl: string;
  status: SteamIdStatus;
  steamId64?: string; // Если занят — ID владельца
  reason?: string;    // Пояснение статуса
}

// Паттерны, которые Steam обычно не разрешает использовать
const FORBIDDEN_PATTERNS = [
  /^\d+$/,           // Только цифры: 111, 1234, 999999
  /^[_-]+$/,         // Только символы: ___, ---
  /^.{1,2}$/,        // Слишком короткие (< 3 символов)
];

// Известные зарезервированные слова Steam
const RESERVED_WORDS = [
  "valve", "steam", "steamcommunity", "steampowered", "admin", "administrator",
  "moderator", "support", "help", "official", "dota", "dota2", "csgo", "cs2",
  "counter-strike", "half-life", "halflife", "portal", "tf2", "teamfortress",
  "left4dead", "l4d", "gaben", "newell", "root", "system", "null", "undefined",
  "api", "www", "mail", "ftp", "cdn", "login", "logout", "register", "signup",
  "signin", "account", "profile", "settings", "config", "test", "demo",
];

/**
 * Предварительная проверка на запрещённые паттерны
 */
function checkForbiddenPatterns(vanityUrl: string): { forbidden: boolean; reason?: string } {
  const lower = vanityUrl.toLowerCase();
  
  // Проверка длины
  if (vanityUrl.length < 3) {
    return { forbidden: true, reason: "Слишком короткий (минимум 3 символа)" };
  }
  
  if (vanityUrl.length > 32) {
    return { forbidden: true, reason: "Слишком длинный (максимум 32 символа)" };
  }
  
  // Проверка символов
  if (!/^[a-zA-Z0-9_-]+$/.test(vanityUrl)) {
    return { forbidden: true, reason: "Недопустимые символы (разрешены a-z, 0-9, _, -)" };
  }
  
  // Только цифры — Steam не разрешает
  if (/^\d+$/.test(vanityUrl)) {
    return { forbidden: true, reason: "Только цифры — Steam не разрешает" };
  }
  
  // Начинается с цифры — часто проблема
  if (/^\d/.test(vanityUrl) && vanityUrl.length <= 5) {
    return { forbidden: true, reason: "Короткие ID, начинающиеся с цифры, обычно зарезервированы" };
  }
  
  // Только подчёркивания или дефисы
  if (/^[_-]+$/.test(vanityUrl)) {
    return { forbidden: true, reason: "Только символы _ и - не разрешены" };
  }
  
  // Зарезервированные слова
  if (RESERVED_WORDS.includes(lower)) {
    return { forbidden: true, reason: "Зарезервированное слово Steam" };
  }
  
  // Содержит зарезервированные слова
  for (const word of ["valve", "steam", "admin", "official"]) {
    if (lower.includes(word)) {
      return { forbidden: true, reason: `Содержит зарезервированное слово: ${word}` };
    }
  }
  
  return { forbidden: false };
}

/**
 * Проверка через Steam Community страницу
 */
async function checkViaSteamCommunity(vanityUrl: string): Promise<{
  exists: boolean;
  steamId64?: string;
  redirected?: boolean;
  finalUrl?: string;
}> {
  const url = `https://steamcommunity.com/id/${vanityUrl}`;
  
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    signal: AbortSignal.timeout(15000),
  });
  
  const finalUrl = response.url;
  const html = await response.text();
  
  // Проверяем редирект на profiles/STEAMID64
  const profileRedirectMatch = finalUrl.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (profileRedirectMatch) {
    return {
      exists: true,
      steamId64: profileRedirectMatch[1],
      redirected: true,
      finalUrl,
    };
  }
  
  // Проверяем наличие ошибки "profile not found"
  if (
    html.includes("The specified profile could not be found") ||
    html.includes("profile_fatalerror")
  ) {
    return { exists: false };
  }
  
  // Проверяем наличие элементов профиля (значит профиль существует)
  if (
    html.includes("profile_header") ||
    html.includes("playerAvatarAutoSizeInner") ||
    html.includes("actual_persona_name")
  ) {
    // Пытаемся извлечь SteamID64 из страницы
    const steamIdMatch = html.match(/g_steamID\s*=\s*"(\d+)"/);
    const steamId64 = steamIdMatch ? steamIdMatch[1] : undefined;
    
    return {
      exists: true,
      steamId64,
      redirected: false,
      finalUrl,
    };
  }
  
  // Неопределённое состояние — лучше считать занятым/зарезервированным
  return { exists: true };
}

/**
 * Дополнительная эвристика для коротких ID
 */
function checkShortIdHeuristics(vanityUrl: string): { suspicious: boolean; reason?: string } {
  const len = vanityUrl.length;
  
  // Очень короткие ID (3-4 символа) почти всегда зарезервированы
  if (len <= 4) {
    // Исключение: некоторые паттерны букв могут быть доступны
    // Но безопаснее считать их подозрительными
    return { 
      suspicious: true, 
      reason: `Очень короткий ID (${len} символа) — высокая вероятность резервации` 
    };
  }
  
  // Повторяющиеся символы часто зарезервированы
  if (/^(.)\1+$/.test(vanityUrl)) {
    return { 
      suspicious: true, 
      reason: "Повторяющийся символ — часто зарезервировано" 
    };
  }
  
  // Последовательности цифр с буквами (типа a123, 1a1a)
  if (/^\d+[a-z]$|^[a-z]\d+$/i.test(vanityUrl) && len <= 5) {
    return {
      suspicious: true,
      reason: "Короткая комбинация буква+цифры — часто зарезервировано"
    };
  }
  
  return { suspicious: false };
}

/**
 * Основная функция проверки Steam Vanity URL
 */
export async function checkSteamVanityUrl(vanityUrl: string): Promise<SteamCheckResult> {
  const normalizedUrl = vanityUrl.toLowerCase().trim();
  
  // Шаг 1: Проверка на запрещённые паттерны
  const forbiddenCheck = checkForbiddenPatterns(normalizedUrl);
  if (forbiddenCheck.forbidden) {
    return {
      vanityUrl: normalizedUrl,
      status: "RESERVED_OR_UNKNOWN",
      reason: forbiddenCheck.reason,
    };
  }
  
  // Шаг 2: Проверка через Steam Community
  try {
    const communityCheck = await checkViaSteamCommunity(normalizedUrl);
    
    if (communityCheck.exists) {
      return {
        vanityUrl: normalizedUrl,
        status: "TAKEN",
        steamId64: communityCheck.steamId64,
        reason: communityCheck.steamId64 
          ? `Занят профилем ${communityCheck.steamId64}`
          : "Профиль существует",
      };
    }
    
    // Профиль не найден — но это не гарантия доступности!
    
    // Шаг 3: Эвристика для коротких ID
    const heuristicCheck = checkShortIdHeuristics(normalizedUrl);
    if (heuristicCheck.suspicious) {
      return {
        vanityUrl: normalizedUrl,
        status: "RESERVED_OR_UNKNOWN",
        reason: heuristicCheck.reason,
      };
    }
    
    // Шаг 4: Если прошли все проверки — вероятно доступен
    return {
      vanityUrl: normalizedUrl,
      status: "AVAILABLE",
      reason: "Профиль не найден, паттерн допустим",
    };
    
  } catch (error) {
    // Ошибка сети — не можем определить статус
    return {
      vanityUrl: normalizedUrl,
      status: "RESERVED_OR_UNKNOWN",
      reason: error instanceof Error ? error.message : "Ошибка проверки",
    };
  }
}

/**
 * Конвертация статуса в человекочитаемый текст
 */
export function getStatusLabel(status: SteamIdStatus): string {
  switch (status) {
    case "AVAILABLE":
      return "Вероятно свободен";
    case "TAKEN":
      return "Занят";
    case "RESERVED_OR_UNKNOWN":
      return "Зарезервирован / Неизвестно";
  }
}

/**
 * Проверка, можно ли считать ID потенциально свободным
 */
export function isPotentiallyAvailable(status: SteamIdStatus): boolean {
  return status === "AVAILABLE";
}
