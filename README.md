# 江戸影（EDO NO KAGE）

江户时代题材的 2D 横版动作游戏：忍者 + 短刀三段连 + 手里剑 + 蜘蛛侠式飞索摆荡。
纯 Canvas + TypeScript，零游戏引擎，零美术素材（全部程序化绘制）。

## 操作

| 键 | 动作 |
|---|---|
| A / D | 移动 |
| W / 空格 | 跳跃 / 二段跳 |
| J | 短刀三段连 |
| K | 手里剑（耗气，刀命中回气） |
| L | 瞬身（无敌帧） |
| I | 飞索（45° 抛出，钩住横梁/平台摆荡，1 秒时限） |
| B | 敌人图鉴 |
| R | 重开 |

## 开发

```bash
npm install
npm run dev    # http://localhost:5173
npm run build  # 产物在 dist/，纯静态可部署到 GitHub Pages
```

设计文档与迭代记录见 [DESIGN.md](./DESIGN.md)。
