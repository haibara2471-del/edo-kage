/**
 * RL 环境服务器：localhost HTTP，Python 直接读取观测（坐标/血量等全部状态）。
 * POST /reset {scenario?, seed?} → {obs}
 * POST /step  {action}          → {obs, reward, done, info}
 * GET  /meta                    → {obsSize, actionCount, scenarios}
 */
import { createServer } from 'node:http';
import { GameEnv, type Scenario } from './env';

const PORT = 8787;
const envs = new Map<string, GameEnv>();

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.url === '/meta' && req.method === 'GET') {
      const e = new GameEnv('ashigaru');
      res.end(JSON.stringify({ obsSize: e.obsSize, actionCount: e.actionCount, scenarios: ['ashigaru', 'wave1', 'waves', 'boss', 'bossEasy', 'flyers', 'bossSquad'] }));
      return;
    }

    const body = JSON.parse((await readBody(req)) || '{}');
    const sid = String(body.session ?? 'default');

    if (req.url === '/reset' && req.method === 'POST') {
      const scenario = (body.scenario ?? 'ashigaru') as Scenario;
      const seed = Number(body.seed ?? 1);
      let env = envs.get(sid);
      if (!env || body.scenario) {
        env = new GameEnv(scenario);
        envs.set(sid, env);
      }
      const obs = env.reset(seed);
      res.end(JSON.stringify({ obs }));
      return;
    }

    if (req.url === '/step' && req.method === 'POST') {
      const env = envs.get(sid);
      if (!env) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'call /reset first' }));
        return;
      }
      const r = env.step(Number(body.action ?? 0));
      res.end(JSON.stringify(r));
      return;
    }

    // 批量端点：N 个环境一次请求（RL 训练吞吐关键）
    if (req.url === '/vreset' && req.method === 'POST') {
      const sessions = (body.sessions ?? []) as string[];
      const scenario = (body.scenario ?? 'ashigaru') as Scenario;
      const seed = Number(body.seed ?? 1);
      const obs: Record<string, number[]> = {};
      sessions.forEach((s, i) => {
        let env = envs.get(s);
        if (!env || body.scenario) {
          env = new GameEnv(scenario);
          envs.set(s, env);
        }
        obs[s] = env.reset(seed + i * 97);
      });
      res.end(JSON.stringify({ obs }));
      return;
    }

    if (req.url === '/vstep' && req.method === 'POST') {
      const actions = (body.actions ?? {}) as Record<string, number>;
      const out: Record<string, unknown> = {};
      for (const [s, a] of Object.entries(actions)) {
        const env = envs.get(s);
        if (env) out[s] = env.step(Number(a));
      }
      res.end(JSON.stringify(out));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'unknown endpoint' }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`edo-kage RL env server @ http://127.0.0.1:${PORT}`);
});
