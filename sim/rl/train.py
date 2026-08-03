"""PPO 训练：waves（三波连战）/ boss（斩龙）/ ashigaru / wave1。
用法：npm run env 启动后——
  python sim/rl/train.py waves 200000        # CPU（推荐，MLP 小网络）
  python sim/rl/train.py boss 200000 big     # 大网络 [256,256] + CUDA
"""
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from edo_env import EdoEnv, BatchVecEnv
from stable_baselines3 import PPO

SCENARIO = sys.argv[1] if len(sys.argv) > 1 else "ashigaru"
TOTAL_STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 200_000
BIG = len(sys.argv) > 3 and sys.argv[3] == "big"
N_ENVS = 8


def evaluate(model, env, n=20):
    wins = 0
    waves_reached = []
    kills_list = []
    hp_left = []
    for _ in range(n):
        obs, _ = env.reset()
        done = False
        while not done:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, terminated, truncated, info = env.step(action)
            done = terminated or truncated
        if info.get("enemiesAlive", 1) == 0:
            wins += 1
        waves_reached.append(info.get("wave", 1))
        kills_list.append(info.get("kills", 0))
        hp_left.append(info.get("playerHp", 0))
    return (
        wins / n,
        sum(waves_reached) / len(waves_reached),
        sum(kills_list) / len(kills_list),
        sum(hp_left) / len(hp_left),
    )


def main():
    env = BatchVecEnv(scenario=SCENARIO, n_envs=N_ENVS)
    eval_env = EdoEnv(scenario=SCENARIO, session="eval")

    kwargs = dict(device="cpu")
    if BIG:
        # 大网络才值得上 GPU；默认 MLP 在 CPU 上更快
        kwargs = dict(device="cuda", policy_kwargs=dict(net_arch=[256, 256]))

    model_path = Path(f"ppo_{SCENARIO}.zip")
    if model_path.exists():
        # 断点续训
        model = PPO.load(str(model_path), env=env, device=kwargs.get("device", "cpu"))
        print(f"续训 {model_path}")
    else:
        model = PPO(
            "MlpPolicy",
            env,
            n_steps=512,
            batch_size=512,
            learning_rate=3e-4,
            ent_coef=0.02,
            verbose=1,
            **kwargs,
        )

    t0 = time.time()
    best_win = -1.0
    for ckpt in range(1, 6):
        model.learn(total_timesteps=TOTAL_STEPS // 5, reset_num_timesteps=False)
        win, avg_wave, avg_kills, avg_hp = evaluate(model, eval_env)
        print(f"[ckpt {ckpt}] steps≈{model.num_timesteps}  胜率={win:.0%}  平均波次={avg_wave:.1f}  平均击杀={avg_kills:.1f}  平均剩血={avg_hp:.0f}  用时={time.time()-t0:.0f}s")
        if win >= best_win:
            best_win = win
            model.save(f"ppo_{SCENARIO}_best")  # 保存最佳而非最终（PPO 迭代间会振荡）
            if win > 0:
                print(f"  ↑ 新最佳 {win:.0%}，已保存 ppo_{SCENARIO}_best.zip")

    model.save(f"ppo_{SCENARIO}")
    print(f"完成，最佳胜率 {best_win:.0%}（已存 ppo_{SCENARIO}_best.zip / ppo_{SCENARIO}.zip）")


if __name__ == "__main__":
    main()
