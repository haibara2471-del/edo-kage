const KEY = 'edo-kage-name';

/** 玩家忍名（localStorage 持久化，首次登记后免输入） */
export function getPlayerName(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPlayerName(n: string): void {
  try {
    localStorage.setItem(KEY, n);
  } catch { /* 忽略 */ }
}
