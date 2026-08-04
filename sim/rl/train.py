"""PPO 训练 v2：16 并行局（random 随机课程）+ EvalCallback 在 waves 测试集上评估。
课程纪律：训练只用 random（随机敌人组合），waves/boss 等固定 stage 是测试集。
用法：npm run env 启动后——
  python sim/rl/train.py                       # random 训练 100 万步，waves 评估（默认）
  python sim/rl/train.py random 500000 waves   # random 训练 50 万步，waves 评估
  python sim/rl/train.py waves 500000          # 直接训 waves（调试用，非正式课程）
  python sim/rl/train.py random 1000000 waves resume   # 断点续训
  python sim/rl/train.py random 1000000 waves init=ppo_random  # 迁移初始化
"""
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from edo_env import EdoEnv, BatchVecEnv
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback

from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv

TRAIN_SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "random"  # 训练课程：随机敌人组合
TOTAL_STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 1_000_000
EVAL_SCENARIO = sys.argv[3] if len(sys.argv) > 3 else "waves"     # 测试集：固定 waves
RESUME = "resume" in sys.argv
INIT = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("init=")), None)
N_ENVS = 16
N_STEPS = 2048   # 覆盖完整 episode（waves 最长 1350 步）
BATCH_SIZE = 512
GAMMA = 0.995
GAE_LAMBDA = 0.95
LEARNING_RATE = 1e-4
ENT_COEF = 0.05  # 提高熵，打破 spam 局部最优
POLICY_KWARGS = dict(net_arch=[512, 512])


def main():
    env = VecNormalize(
        BatchVecEnv(scenario=TRAIN_SCENARIO, n_envs=N_ENVS),
        norm_obs=False,
        norm_reward=True,
    )
    eval_env = VecNormalize(
        DummyVecEnv([lambda: EdoEnv(scenario=EVAL_SCENARIO, session="evalcb")]),
        norm_obs=False,
        norm_reward=True,
        training=False,
    )

    eval_cb = EvalCallback(
        eval_env,
        best_model_save_path=".",
        log_path=".",
        eval_freq=max(40_000 // N_ENVS, 1),  # n_calls 每 16 步一次 → 2500 才等价于每 4 万步评估
        n_eval_episodes=10,
        deterministic=True,
        verbose=1,
    )

    model_path = Path(f"ppo_{TRAIN_SCENARIO}.zip")
    vec_path = Path(f"ppo_{TRAIN_SCENARIO}_vecnormalize.pkl")
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
    model.save(f"ppo_{TRAIN_SCENARIO}")
    env.save(f"ppo_{TRAIN_SCENARIO}_vecnormalize.pkl")
    print(f"完成 {model.num_timesteps} 步（{TRAIN_SCENARIO} 课程 / {EVAL_SCENARIO} 评估），用时 {time.time()-t0:.0f}s，最佳 best_model.zip / 最终 ppo_{TRAIN_SCENARIO}.zip")


if __name__ == "__main__":
    main()
