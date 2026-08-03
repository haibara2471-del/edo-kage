"""江戸影 RL 环境的 gymnasium 客户端：通过 localhost HTTP 读取 Node 侧真实游戏状态。"""
import os

import requests
import numpy as np
import gymnasium as gym
from gymnasium import spaces
from stable_baselines3.common.vec_env import VecEnv

SERVER = "http://127.0.0.1:8787"


class EdoEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, scenario="ashigaru", session="default"):
        super().__init__()
        meta = requests.get(f"{SERVER}/meta", timeout=5).json()
        self.scenario = scenario
        self.session = session
        # 连接复用（keep-alive）：每帧一次请求，不重复建连，避免 Windows 端口耗尽
        self.http = requests.Session()
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(meta["obsSize"],), dtype=np.float32
        )
        self.action_space = spaces.Discrete(meta["actionCount"])
        self._seed = 1

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            self._seed = seed
        r = self.http.post(
            f"{SERVER}/reset",
            json={"session": self.session, "scenario": self.scenario, "seed": self._seed},
            timeout=10,
        ).json()
        return np.array(r["obs"], dtype=np.float32), {}

    def step(self, action):
        r = self.http.post(
            f"{SERVER}/step",
            json={"session": self.session, "action": int(action)},
            timeout=10,
        ).json()
        obs = np.array(r["obs"], dtype=np.float32)
        return obs, float(r["reward"]), bool(r["done"]), False, r.get("info", {})


class BatchVecEnv(VecEnv):
    """批量向量环境：N 个游戏环境每步只发 1 个 HTTP 请求（吞吐 ~×N），
    单进程无 subprocess 开销，done 后自动重置。"""

    def __init__(self, scenario="waves", n_envs=8):
        meta = requests.get(f"{SERVER}/meta", timeout=5).json()
        self.scenario = scenario
        self.sids = [f"v{i}_{os.getpid()}" for i in range(n_envs)]
        self.http = requests.Session()
        obs_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(meta["obsSize"],), dtype=np.float32
        )
        act_space = spaces.Discrete(meta["actionCount"])
        super().__init__(n_envs, obs_space, act_space)
        self._pending = {}

    def reset(self):
        data = self.http.post(
            f"{SERVER}/vreset",
            json={"sessions": self.sids, "scenario": self.scenario, "seed": 1},
            timeout=15,
        ).json()["obs"]
        return np.stack([data[s] for s in self.sids]).astype(np.float32)

    def step_async(self, actions):
        self._pending = {s: int(a) for s, a in zip(self.sids, actions)}

    def step_wait(self):
        data = self.http.post(
            f"{SERVER}/vstep", json={"actions": self._pending}, timeout=15
        ).json()
        obs, rews, dones, infos, redo = [], [], [], [], []
        for s in self.sids:
            r = data[s]
            done = bool(r["done"])
            info = dict(r.get("info", {}))
            if done:
                info["terminal_observation"] = np.array(r["obs"], dtype=np.float32)
                redo.append(s)
            obs.append(r["obs"])
            rews.append(r["reward"])
            dones.append(done)
            infos.append(info)
        if redo:
            fresh = self.http.post(
                f"{SERVER}/vreset",
                json={"sessions": redo, "scenario": self.scenario, "seed": 1},
                timeout=15,
            ).json()["obs"]
            for i, s in enumerate(self.sids):
                if s in fresh:
                    obs[i] = fresh[s]
        return (
            np.array(obs, dtype=np.float32),
            np.array(rews, dtype=np.float32),
            np.array(dones),
            infos,
        )

    def close(self):
        self.http.close()

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs

    def get_attr(self, name, indices=None):
        return [None] * self.num_envs

    def set_attr(self, name, value, indices=None):
        pass

    def env_method(self, name, *args, indices=None, **kwargs):
        return [None] * self.num_envs

    def get_images(self):
        return [None] * self.num_envs

    def seed(self, seed=None):
        return [seed] * self.num_envs

    def render(self, mode="human"):
        pass
