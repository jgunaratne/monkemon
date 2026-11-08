// Unified Keyboard + Steam Deck Gamepad + Mobile Virtual Touch Input Engine for Monkemon.
// Maps cleanly to both Overworld Exploration and the Sticky-Note Real-Time Arena Moves:
//   [A] Monk Run  ·  [B] Fake Out  ·  [X] Eat  ·  [Y] Jump  ·  [RB] Type Special
//   [LB] Throw Monkeball  ·  [LT] Switch Monkemon  ·  [View] Map  ·  [Menu] 20-Board / Dex

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',

  // [A] Confirm / Interact / Battle Move A (Monk Run)
  Space: 'btnA',
  Digit1: 'btnA',
  Enter: 'btnA',

  // [B] Sprint / Cancel / Battle Move B (Fake Out)
  ShiftLeft: 'btnB',
  ShiftRight: 'btnB',
  Digit2: 'btnB',
  KeyK: 'btnB',

  // [X] Toss Berry / Battle Move X (Eat)
  KeyE: 'btnX',
  Digit3: 'btnX',

  // [Y] Aim & Throw Monkeball (Overworld) / Battle Move Y (Jump)
  KeyJ: 'btnY',
  KeyF: 'btnY',
  Digit4: 'btnY',

  // [RB] Engage Partner Battle (Overworld) / Type Special (Battle)
  KeyL: 'btnRB',
  Digit5: 'btnRB',

  // [LB] Quick Monkeball Throw (Overworld & Battle)
  KeyC: 'btnLB',

  // [LT] Cycle Active Party Monkemon
  KeyQ: 'btnLT',
  KeyR: 'btnLT',

  // Meta screens & toggles
  KeyB: 'dex',
  Tab: 'dex',
  KeyM: 'map',
  KeyP: 'forge',
  KeyG: 'tilt',
  KeyN: 'mute',
  Escape: 'back',
};

export const ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'btnA',
  'btnB',
  'btnX',
  'btnY',
  'btnRB',
  'btnLB',
  'btnLT',
  'dex',
  'map',
  'forge',
  'tilt',
  'mute',
  'back',
];

export class Input {
  constructor(targetEl) {
    this.down = Object.fromEntries(ACTIONS.map((a) => [a, false]));
    this.pressed = Object.fromEntries(ACTIONS.map((a) => [a, false]));
    this.released = Object.fromEntries(ACTIONS.map((a) => [a, false]));
    this.keyState = {};
    this.padState = {};
    this.touchState = {};
    this._latched = {};
    this.moveX = 0;
    this.moveZ = 0;
    this.touchStickX = 0;
    this.touchStickZ = 0;
    this.hasGamepad = false;
    this.mode = 'keyboard'; // 'keyboard' | 'gamepad' | 'touch'
    this.typing = false;
    this.onFirstGesture = null;
    this._gestured = false;

    const markGesture = () => {
      if (!this._gestured) {
        this._gestured = true;
        if (this.onFirstGesture) this.onFirstGesture();
      }
    };

    window.addEventListener('keydown', (e) => {
      markGesture();
      const tag = e.target && e.target.tagName;
      if (this.typing || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.code === 'Escape') {
          this._latched.back = true;
        }
        return;
      }
      this.mode = 'keyboard';
      const act = KEYMAP[e.code];
      if (act) {
        this.keyState[act] = true;
        if (!e.ctrlKey && !e.metaKey) e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      const act = KEYMAP[e.code];
      if (act) {
        this.keyState[act] = false;
      }
    });

    window.addEventListener('blur', () => {
      this.keyState = {};
      this.touchState = {};
      this.touchStickX = 0;
      this.touchStickZ = 0;
    });

    if (targetEl) {
      targetEl.addEventListener('pointerdown', (e) => {
        markGesture();
        if (e.button === 2) {
          this.pulse('btnLB');
        }
      });
      targetEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('touchstart', () => markGesture(), { passive: true });
  }

  pulse(action) {
    if (action in this.down) {
      this._latched[action] = true;
    }
  }

  setTouchAction(action, isDown) {
    if (!(action in this.down)) return;
    this.mode = 'touch';
    this.touchState[action] = Boolean(isDown);
    if (isDown) this._latched[action] = true;
  }

  setTouchStick(nx, nz) {
    this.touchStickX = Math.max(-1, Math.min(1, nx || 0));
    this.touchStickZ = Math.max(-1, Math.min(1, nz || 0));
    if (Math.hypot(this.touchStickX, this.touchStickZ) > 0.15) {
      this.mode = 'touch';
    }
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && Array.from(pads).find((p) => p && p.connected);
    this.hasGamepad = Boolean(gp);
    const s = {};
    this._padX = 0;
    this._padZ = 0;
    if (gp) {
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      const dead = 0.18;
      if (Math.hypot(ax, ay) > dead) {
        this._padX = ax;
        this._padZ = ay;
      }
      const b = (i) => Boolean(gp.buttons[i] && gp.buttons[i].pressed);
      s.left = ax < -0.45 || b(14);
      s.right = ax > 0.45 || b(15);
      s.up = ay < -0.45 || b(12);
      s.down = ay > 0.45 || b(13);

      // Standard Xbox / Steam Deck ABXY layout:
      // 0 = A (Bottom), 1 = B (Right), 2 = X (Left), 3 = Y (Top)
      s.btnA = b(0);
      s.btnB = b(1);
      s.btnX = b(2);
      s.btnY = b(3);
      s.btnLB = b(4);
      s.btnRB = b(5) || b(7);
      s.btnLT = b(6);
      s.map = b(8);  // View / Select -> Archipelago Map
      s.dex = b(9);  // Menu / Start -> 20-Monkemon Board & Party
      s.tilt = b(10); // L3 -> Toggle Tilt-Shift Miniature Lens
      s.mute = b(11); // R3 -> Toggle Audio Mute

      if (Object.values(s).some(Boolean) || Math.hypot(this._padX, this._padZ) > 0.2) {
        this.mode = 'gamepad';
        if (!this._gestured) {
          this._gestured = true;
          if (this.onFirstGesture) this.onFirstGesture();
        }
      }
    }
    this.padState = s;
  }

  update() {
    this.pollGamepad();
    for (const a of ACTIONS) {
      let now = Boolean(this.keyState[a] || this.padState[a] || this.touchState[a]);
      if (!now && this._latched[a]) {
        if (this.down[a]) {
          now = false;
        } else {
          now = true;
          this._latched[a] = false;
        }
      } else if (now) {
        this._latched[a] = false;
      }
      this.pressed[a] = now && !this.down[a];
      this.released[a] = !now && this.down[a];
      this.down[a] = now;
    }

    // Compute smooth 2D movement vector in XZ world plane
    let vx = (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0);
    let vz = (this.down.down ? 1 : 0) - (this.down.up ? 1 : 0);
    if (Math.hypot(this._padX || 0, this._padZ || 0) > 0.18) {
      vx = this._padX;
      vz = this._padZ;
    } else if (Math.hypot(this.touchStickX, this.touchStickZ) > 0.12) {
      vx = this.touchStickX;
      vz = this.touchStickZ;
    }
    const len = Math.hypot(vx, vz);
    if (len > 1.0) {
      vx /= len;
      vz /= len;
    }
    this.moveX = vx;
    this.moveZ = vz;
  }
}
