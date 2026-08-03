"""把 sb3 PPO 策略导出为 ONNX（供浏览器 onnxruntime-web 推理）。"""
import sys

sys.stdout.reconfigure(encoding="utf-8")

import torch
from stable_baselines3 import PPO

SRC = sys.argv[1] if len(sys.argv) > 1 else "ppo_waves_best"
DST = sys.argv[2] if len(sys.argv) > 2 else "ppo_waves.onnx"
OBS_SIZE = 42


class OnnxPolicy(torch.nn.Module):
    def __init__(self, policy):
        super().__init__()
        self.policy = policy

    def forward(self, obs):
        return self.policy(obs, deterministic=True)


def main():
    model = PPO.load(SRC, device="cpu")
    model.policy.set_training_mode(False)
    dummy = torch.zeros(1, OBS_SIZE)
    torch.onnx.export(
        OnnxPolicy(model.policy),
        dummy,
        DST,
        input_names=["obs"],
        output_names=["action"],
        dynamic_axes={"obs": {0: "batch"}, "action": {0: "batch"}},
        opset_version=17,
    )
    print(f"已导出 {DST}")


if __name__ == "__main__":
    main()
