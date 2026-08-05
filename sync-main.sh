#!/bin/bash
# RL worktree 同步 main 最新改动（训练前跑一次）
# 用法：bash sync-main.sh
cd "$(dirname "$0")"
if [ "$(git rev-list --count HEAD..main)" -gt 0 ]; then
  echo "同步 main 最新改动…（落后 $(git rev-list --count HEAD..main) 个提交）"
  git merge main
else
  echo "已是最新（src/ 与 main 一致）"
fi
