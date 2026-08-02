import { Input, type Action } from './input';

/**
 * 回放输入：不监听真实键盘，把记录的输入日志逐帧喂回游戏。
 * 同种子 + 同日志 = 逐帧复现（事件帧 ≤ 当前帧即生效，与实时按键在同一逻辑帧生效一致）。
 */
export class ReplayInput extends Input {
  private events: { f: number; a: string; d: number }[];
  private ptr = 0;

  constructor(log: { f: number; a: string; d: number }[]) {
    super(false); // 不接真实键盘
    this.events = log;
  }

  override tick(): void {
    const f = this.frame;
    while (this.ptr < this.events.length && this.events[this.ptr].f <= f) {
      const ev = this.events[this.ptr++];
      const a = ev.a as Action;
      if (ev.d === 1) {
        this.held.add(a);
        this.buffer.push({ action: a, frame: f });
      } else {
        this.held.delete(a);
      }
    }
    super.tick();
  }
}
