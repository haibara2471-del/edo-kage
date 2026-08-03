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

from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "ashigaru"
TOTAL_STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 500_000
RESUME = "resume" in sys.argv
INIT = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("init=")), None)
LR_OVERRIDE = next((float(a.split("=", 1)[1]) for a in sys.argv if a.startswith("lr=")), None)
N_ENVS = 16
N_STEPS = 2048   # 覆盖完整 episode（waves 最长 1350 步）
BATCH_SIZE = 512
GAMMA = 0.995
GAE_LAMBDA = 0.95
LEARNING_RATE = LR_OVERRIDE if LR_OVERRIDE is not None else 1e-4
ENT_COEF = 0.05  # 提高熵，打破 spam 局部最优
POLICY_KWARGS = dict(net_arch=[512, 512])


def main():
    env = VecNormalize(
        BatchVecEnv(scenario=SCENARIO, n_envs=N_ENVS),
        norm_obs=False,
        norm_reward=True,
    )
    eval_env = VecNormalize(
        DummyVecEnv([lambda: EdoEnv(scenario=SCENARIO, session="evalcb")]),
        norm_obs=False,
        norm_reward=True,
        training=False,
    )

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
    vec_path = Path(f"ppo_{SCENARIO}_vecnormalize.pkl")
    init_vec_path = Path(f"{INIT}_vecnormalize.pkl") if INIT else None

    if INIT and Path(f"{INIT}.zip").exists():
        if init_vec_path and init_vec_path.exists():
            env = VecNormalize.load(str(init_vec_path), env)
        model = PPO.load(f"{INIT}.zip", env=env, device="cpu")
        print(f"迁移初始化 {INIT}.zip")
    elif RESUME and model_path.exists():
        if vec_path.exists():
            env = VecNormalize.load(str(vec_path), env)
        model = PPO.load(str(model_path), env=env, device="cpu")
        print(f"续训 {model_path}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            device="cpu",
            n_steps=N_STEPS,
            batch_size=BATCH_SIZE,
            gamma=GAMMA,
            gae_lambda=GAE_LAMBDA,
            learning_rate=LEARNING_RATE,
            ent_coef=ENT_COEF,
            policy_kwargs=POLICY_KWARGS,
            verbose=1,
        )

    t0 = time.time()
    model.learn(total_timesteps=TOTAL_STEPS, callback=eval_cb)
    model.save(f"ppo_{SCENARIO}")
    env.save(f"ppo_{SCENARIO}_vecnormalize.pkl")
    print(f"完成 {model.num_timesteps} 步，用时 {time.time()-t0:.0f}s，最佳模型 best_model.zip / 最终 ppo_{SCENARIO}.zip")


if __name__ == "__main__":
    main()
