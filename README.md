# 江戸影（EDO NO KAGE）

**在线试玩：https://haibara2471-del.github.io/edo-kage/**

江户时代题材的 2D 横版动作游戏：忍者 + 短刀三段连 + 手里剑 + 造梦式技能连招。
纯 Canvas + TypeScript，零游戏引擎，零美术素材（全部程序化绘制）。

## 操作

| 键 | 动作 |
|---|---|
| A / D | 移动 |
| W / 空格 | 跳跃 / 二段跳 |
| J | 短刀三段连（第三段挑空） |
| K | 手里剑·扇形三连（耗气，刀命中回气） |
| L | 瞬身（无敌帧） |
| U | 昇月斬（挑空） |
| H | 朧乱舞（空中九段连斩） |
| O | 水月の術（水弹，再按引爆） |
| B | 图鉴（技能/敌人） |
| R | 重开 |

调试：`?debug=1`（1/2/3 传送战区、N 清波、G 无敌）

## 开发

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # 产物在 dist/，纯静态可部署到 GitHub Pages
npm run test:sim  # 无头玩法测试（Node 加载真实源码自动游玩并断言）
```

设计文档与迭代记录见 [DESIGN.md](./DESIGN.md)。
