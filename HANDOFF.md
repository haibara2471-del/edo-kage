# 江戸影 EDO NO KAGE — 双窗口交接手册（HANDOFF）

> **用途**：把**游戏迭代**（玩法/手感/功能/玩家反馈）与 **RL 探索**（AI 训练/分析/奖励设计）分成两个独立 Claude Code 窗口并行推进。
> **新开会话时**：先读本文件定位自己在哪个窗口 → 游戏窗口再看 `DESIGN.md`，RL 窗口再看 `sim/rl/RL_RECORD.md`，即可无缝续接。

---

## 一、窗口分工（划清边界，互不越界）

| 窗口 | 负责 | 默认不碰 |
|---|---|---|
| **游戏窗口** | `src/` 玩法/手感/功能/玩家反馈、`DESIGN.md` 迭代日志、本地手动测试 | `sim/rl/` 训练配置、`sim/env.ts` reward（除非明确讨论） |
| **RL 窗口** | `sim/env.ts` reward、`sim/rl/` 训练/分析/记录、`sim/ai-*.ts` | 玩家功能（除非明确讨论） |

> **v0.48+ 双窗口分物理目录（git worktree）**：
> - `game/` = **main 分支**（游戏窗口）
> - `game-rl/` = **rl/dev 分支**（RL 窗口，worktree，位于 `../game-rl`）
> - **src/ 单一事实源 = main**：RL 对 src/ 的必要 bug 修复（判定/obs）尽快 merge 回 main；sim/ 差异留在 rl/dev
> - RL 侧每次训练前跑 `bash sync-main.sh`（merge main，保证 src/ 最新）
> - merge 冲突仅 src/player.ts 可能（游戏手感 vs RL 判定），手动解决保留两边意图

---

## 二、公共纪律（两边都遵守）

1. **先看回放再归因**：分析 AI 失败用 `npx tsx sim/ai-replay.ts <模型> <场景> <seed>` 逐帧看，汇总统计会骗人。
2. **训练≠测试**：训练只用 `random` 课程，`waves`/`boss` 固定为测试集。
3. **每次代码更新后 `npm run build`** 编译验证。
4. **完成独立任务后立即 git commit**（带 Co-Authored-By），别攒着。
5. **改动/下载/安装前先沟通说明**，不得自作主张。
6. RL 训练必须用 `conda run -n project1 python`（base 没有 gymnasium）。

---

## 三、游戏窗口上下文

- **当前版本**：v0.46（玩家反馈 6 项已落地）——行进挥刀保留动量、吸血 buff 红光特效、钩使射程 200+拉回当前位置、人物头顶迷你血气条、飞镖锁定按下瞬间朝向、弓箭手击退后急停。详见 `DESIGN.md` 迭代记录。
- **关键文件**：`src/*`（player / archer / hooksoldier / combat / projectile / input / ui / main…）、`DESIGN.md`。
- **验证**：`npm run build` 通过 + 浏览器本地打开试玩。
- **下一步**：`DESIGN.md` 第 10 节 TODO（钟馗钩/金刚/蛊术、终极 Boss 定稿）、玩家新反馈。

---

## 四、RL 窗口上下文

- **当前 reward 配置（v0.45c）**：
  | 项 | 系数 |
  |---|---|
  | 刀伤 | +1.0/点 |
  | 技能/镖伤 | +0.5/点 |
  | 击杀 | +15 |
  | 承伤 | -0.15/点（无残血放大）|
  | 时间 | -0.1/帧（-0.4/步）|
  | 推进（advance） | 右移 +0.15/px |
  | 活跃 | -0.03/步 |
  | 死亡 | -50 |
  | 通关 | +50 + 血×0.02 |
  - random 课程：15% 易版推进分支（wave1→推进260px→wave1）+ 20% 单房间 wave + 15% 弓+钩 + 10% 对空 + 40% 混合；maxTicks 3000
  - **完整演化史 + 平衡理由**：`sim/rl/RL_RECORD.md`（必读）
- **已达成**：承伤 0.03→0.15 后基础战斗毕业——足轻×3 同侧 100%（639帧满血）、弓+钩 100%、对空 ~100%、真局 wave2 70%。
- **关键文件**：`sim/env.ts`（reward+课程）、`sim/rl/train.py`、`sim/rl/export_onnx.py`、`sim/ai-analyze.ts`、`sim/ai-replay.ts`、`sim/advance-unit.ts`（advance 机制回归测试）。
- **验证链路**：改 `sim/env.ts` 后**必须杀 8787 重启 `npm run env`** → `conda run -n project1 python sim/rl/train.py random 300000 waves` → `conda run -n project1 python sim/rl/export_onnx.py ppo_random sim/rl/ppo_random.onnx` → **先 ai-replay 看回放，再 ai-analyze**。eval 文件落在 game/ 根目录。
- **待决（悬而未决）**：advance 教法——v0.45 系列三次实验都崩基础战斗（推进分支掺杂扭曲策略），方向三选一：
  - **A** 降幅度：advance 奖励 0.15→0.05/px、分支 15%→10%（最小扰动试一轮）
  - **B** 两阶段（推荐）：Phase1 纯战斗复训 v0.44b（顺带验证可复现）→ Phase2 `init=` 续训 advance
  - **C** 多 seed 取最优（最贵）
- **待攻**：Boss 战 0%（200 血复杂招式），等基础战斗 + advance 解决后单独立项（现有 `boss`/`bossSquad` 场景可训）。
- **已知技术债**：obs 敌人槽位 8/7 维不一致导致布局漂移（训练/分析两侧一致所以模型能学，但 advance 特征位置会随敌数漂移）。

---

## 五、跨窗口通信与迁移

- **git 提交信息**注明所属域：`game: ...` / `rl: ...` / `公共: ...`，方便另一窗口看 log 知道对方动了什么。
- **切换/新开窗口**：先读本文件，再读对应域 MD（游戏→DESIGN.md，RL→RL_RECORD.md）。
- **交接前**：把当前进度、待决问题、下一步写进对应 MD（DESIGN.md / RL_RECORD.md），这是两个窗口的"共享大脑"。
- 涉及另一窗口领域的改动，先在提交信息或对话里说明，避免两边打架。
