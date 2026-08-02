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

const BUFFER_MS = 150; // 输入缓冲窗口：按键后 150ms 内可被消费

export class Input {
  private held = new Set<Action>();
  private buffer: { action: Action; time: number }[] = [];

  constructor() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(a);
      this.buffer.push({ action: a, time: performance.now() });
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    // 切窗时清空，防止按键卡住
    window.addEventListener('blur', () => this.held.clear());
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** 消费一次缓冲按键：在缓冲窗口内按过就返回 true 并移除 */
  consume(a: Action): boolean {
    const now = performance.now();
    const i = this.buffer.findIndex((p) => p.action === a && now - p.time <= BUFFER_MS);
    if (i >= 0) {
      this.buffer.splice(i, 1);
      return true;
    }
    return false;
  }

  /** 每个逻辑帧调用，清掉过期缓冲 */
  tick(): void {
    const now = performance.now();
    this.buffer = this.buffer.filter((p) => now - p.time <= BUFFER_MS);
  }
}
