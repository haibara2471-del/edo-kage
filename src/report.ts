import { SUPABASE_URL, SUPABASE_KEY } from './config';

export interface RunReport {
  v: number;             // 上报格式版本
  name: string;          // 玩家忍名（首次登记，localStorage 持久化）
  seed: number;          // 本局随机种子（回放复现用）
  result: 'clear' | 'dead';
  wave: number;          // 到达波次
  duration: number;      // 逻辑帧数（60 = 1 秒）
  hpLeft: number;
  log: { f: number; a: string; d: number }[]; // 输入日志 [帧, 动作, 按下1/松开0]
  env: 'local' | 'prod'; // 本地开发 or 线上
  ua: string;
  at: string;            // ISO 时间
}

/** 每局结束时上报一次到 Supabase（未配置则静默跳过；失败不打扰游戏） */
export async function reportRun(data: RunReport): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/runs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(data),
    });
  } catch { /* 网络失败静默 */ }
}

export interface RunRecord extends RunReport {
  id: number;
  created_at: string;
}

/** 拉取一条战报（回放用）：?replay=<id> 或 ?replay=latest */
export async function fetchRun(id: string): Promise<RunRecord | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const q = id === 'latest' ? 'select=*&order=id.desc&limit=1' : `select=*&id=eq.${id}`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/runs?${q}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = (await res.json()) as RunRecord[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}
