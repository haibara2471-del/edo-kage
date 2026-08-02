export type Action = 'left' | 'right' | 'jump' | 'attack' | 'shuriken' | 'dash' | 'codex' | 'skillU' | 'skillH' | 'skillO';

const KEYMAP: Record<string, Action> = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
  KeyJ: 'attack',
  KeyK: 'shuriken',
  KeyL: 'dash',
  KeyB: 'codex',
  KeyU: 'skillU',
  KeyH: 'skillH',
  KeyO: 'skillO',
};

const BUFFER_TICKS = 9; // 输入缓冲窗口：9 帧（=150ms@60Hz），用逻辑帧计时保证回放可复现

export class Input {
  private held = new Set<Action>();
  private buffer: { action: Action; frame: number }[] = [];
  private frame = 0;

  /** 输入日志：[帧, 动作, 按下1/松开0]，每局的回放原料 */
  readonly log: { f: number; a: string; d: number }[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(a);
      this.buffer.push({ action: a, frame: this.frame });
      this.log.push({ f: this.frame, a, d: 1 });
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.held.delete(a);
      this.log.push({ f: this.frame, a, d: 0 });
    });
    // 切窗时清空，防止按键卡住
    window.addEventListener('blur', () => this.held.clear());
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** 消费一次缓冲按键：在缓冲窗口内按过就返回 true 并移除 */
  consume(a: Action): boolean {
    const i = this.buffer.findIndex((p) => p.action === a && this.frame - p.frame <= BUFFER_TICKS);
    if (i >= 0) {
      this.buffer.splice(i, 1);
      return true;
    }
    return false;
  }

  /** 每个逻辑帧调用：推进内部帧钟并清掉过期缓冲 */
  tick(): void {
    this.frame++;
    this.buffer = this.buffer.filter((p) => this.frame - p.frame <= BUFFER_TICKS);
  }
}
