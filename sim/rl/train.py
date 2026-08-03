"""PPO 训练 v2：16 并行局 + EvalCallback（自动存最佳）+ 单次连续 learn。
用法：npm run env 启动后——
  python sim/rl/train.py waves 500000         # 从零（默认）
  python sim/rl/train.py waves 500000 resume  # 断点续训
  python sim/rl/train.py boss 500000 init=ppo_waves  # 迁移初始化
"""
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from edo_env import EdoEnv, BatchVecEnv
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "ashigaru"
TOTAL_STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 500_000
RESUME = "resume" in sys.argv
INIT = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("init=")), None)
N_ENVS = 16      # 并行局数（同一批 rollout 收集自 16 局同时进行的游戏）
N_STEPS = 256    # 每局每轮收集步数 → 一批 rollout = 16×256 = 4096
BATCH_SIZE = 2048  # 梯度 minibatch（一批 rollout 切 2 块，学习更稳）


def main():
    env = BatchVecEnv(scenario=SCENARIO, n_envs=N_ENVS)
    eval_env = EdoEnv(scenario=SCENARIO, session="evalcb")

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=".",
        log_path=".",
        eval_freq=40_000,       # 每 4 万步评估一次（总步数计）
        n_eval_episodes=10,
        deterministic=True,
        verbose=1,
    )

    model_path = Path(f"ppo_{SCENARIO}.zip")
    if INIT and Path(f"{INIT}.zip").exists():
        model = PPO.load(f"{INIT}.zip", env=env, device="cpu")
        print(f"迁移初始化 {INIT}.zip")
    elif RESUME and model_path.exists():
        model = PPO.load(str(model_path), env=env, device="cpu")
        print(f"续训 {model_path}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            device="cpu",
            n_steps=N_STEPS,
            batch_size=BATCH_SIZE,
            learning_rate=3e-4,
            ent_coef=0.05,
            verbose=1,
        )

    t0 = time.time()
    model.learn(total_timesteps=TOTAL_STEPS, callback=eval_cb)
    model.save(f"ppo_{SCENARIO}")
    print(f"完成 {model.num_timesteps} 步，用时 {time.time()-t0:.0f}s，最佳模型 best_model.zip / 最终 ppo_{SCENARIO}.zip")


if __name__ == "__main__":
    main()
