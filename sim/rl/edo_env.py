"""江戸影 RL 环境的 gymnasium 客户端：通过 localhost HTTP 读取 Node 侧真实游戏状态。"""
import requests
import numpy as np
import gymnasium as gym
from gymnasium import spaces

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
