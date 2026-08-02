"""PPO 烟测：目标——AI 学会击杀足轻。
用法：先启动 Node 环境服务器（npm run env），再 python sim/rl/train.py
"""
import sys
import time

from edo_env import EdoEnv
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "ashigaru"
TOTAL_STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 200_000
N_ENVS = 8


def make_env(i: int):
    def _f():
        return EdoEnv(scenario=SCENARIO, session=f"s{i}")

    return _f


def evaluate(model, env, n=20):
    wins = 0
    kills = 0
    for _ in range(n):
        obs, _ = env.reset()
        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, terminated, truncated, info = env.step(action)
            done = terminated or truncated
        if info.get("enemiesAlive", 1) == 0:
            wins += 1
            kills += 1
    return wins / n


def main():
    env = SubprocVecEnv([make_env(i) for i in range(N_ENVS)])
    eval_env = DummyVecEnv([lambda: EdoEnv(scenario=SCENARIO, session="eval")]) if False else EdoEnv(scenario=SCENARIO, session="eval")

    model = PPO(
        "MlpPolicy",
        env,
        device="cpu",  # MLP 策略在 CPU 上更快（GPU 对小型 MLP 无收益）
        n_steps=512,
        batch_size=512,
        learning_rate=3e-4,
        ent_coef=0.01,
        verbose=1,
    )

    t0 = time.time()
    for ckpt in range(1, 6):
        model.learn(total_timesteps=TOTAL_STEPS // 5, reset_num_timesteps=False)
        win = evaluate(model, eval_env)
        print(f"[ckpt {ckpt}] steps≈{model.num_timesteps}  胜率={win:.0%}  用时={time.time()-t0:.0f}s")

    model.save(f"ppo_{SCENARIO}")
    print(f"模型已保存 ppo_{SCENARIO}.zip")


if __name__ == "__main__":
    main()
