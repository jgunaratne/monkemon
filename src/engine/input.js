// Unified Keyboard + Steam Deck Gamepad + Virtual Touch Input Engine for Monkemon.
// Supports seamless dual controls across Overworld, Turn-Based Battles, and the Tamer Menu Hub:
//   - Keyboard: WASD / Arrow Keys (move & menu cursor), Enter / Space (Confirm / Interact),
//     1–4 (quick menu slot), Esc / Backspace (Back / Cancel), Shift (Sprint),
//     Tab / I (Main Menu), B (MonkeDex), V (My Monkemon), M (World Map),
//     F (Throw Monkeball), E (Toss Berry), Q (Cycle Partner).
//   - Steam Deck / Gamepad: Left Stick / D-Pad (move & menu cursor), (A) Confirm / Interact,
//     (B) Cancel / Back (or hold to Sprint in Overworld), (Y) Throw Monkeball, (X) Toss Berry,
//     Menu / Start (Main Menu Hub), View / Select (World Map), LB / RB (Switch Menu Tabs).

const KEYMAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',

  // [A] Confirm / Interact / Enter House / Talk / Battle Select
  Space: 'btnA',
  Enter: 'btnA',
  NumpadEnter: 'btnA',

  // [B] Sprint in Overworld / Cancel in Menus
  ShiftLeft: 'btnB',
  ShiftRight: 'btnB',

  // [X] Toss Sweet Berry (Overworld)
  KeyE: 'btnX',

  // [Y] Aim & Throw Monkeball (Overworld)
  KeyF: 'btnY',
  KeyJ: 'btnY',

  // [RB] Engage Wild Battle (Overworld) / Next Tab in Menu
  KeyR: 'btnRB',
  BracketRight: 'tabNext',

  // [LB] Quick Monkeball Throw (Overworld) / Prev Tab in Menu
  KeyC: 'btnLB',
  BracketLeft: 'tabPrev',

  // [LT] Cycle Active Lead Partner
  KeyQ: 'btnLT',

  // Direct 1–4 Menu / Move / Party Slot Shortcuts on Keyboard
  Digit1: 'slot1',
  Numpad1: 'slot1',
  Digit2: 'slot2',
  Numpad2: 'slot2',
  Digit3: 'slot3',
  Numpad3: 'slot3',
  Digit4: 'slot4',
  Numpad4: 'slot4',

  // Tamer Menu Hub & Direct Tabs
  Tab: 'menu',
  KeyI: 'menu',
  KeyV: 'party',
  KeyB: 'dex',
  KeyM: 'map',
  KeyP: 'forge',
  KeyG: 'tilt',
  KeyN: 'mute',
  Escape: 'back',
  Backspace: 'back',
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
  'slot1',
  'slot2',
  'slot3',
  'slot4',
  'tabPrev',
  'tabNext',
  'menu',
  'party',
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
    this.menuNav = { left: false, right: false, up: false, down: false };
    this._navHold = { left: 0, right: 0, up: 0, down: 0 };
    this._lastUpdateTs = typeof performance !== 'undefined' ? performance.now() : 0;

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
          this.pulse('btnY');
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
      s.left = ax < -0.46 || b(14);
      s.right = ax > 0.46 || b(15);
      s.up = ay < -0.46 || b(12);
      s.down = ay > 0.46 || b(13);

      // Standard Xbox / Steam Deck ABXY layout:
      // 0 = A (Bottom Confirm), 1 = B (Right Cancel/Sprint), 2 = X (Left Berry), 3 = Y (Top Monkeball)
      s.btnA = b(0);
      s.btnB = b(1);
      s.btnX = b(2);
      s.btnY = b(3);
      s.btnLB = b(4);
      s.btnRB = b(5) || b(7);
      s.tabPrev = b(4);
      s.tabNext = b(5);
      s.btnLT = b(6);
      s.map = b(8);   // View / Select -> Archipelago World Map
      s.menu = b(9);  // Menu / Start -> Tamer Main Menu Hub (Squad, MonkeDex, Bag, Map)
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
    const nowTs = typeof performance !== 'undefined' ? performance.now() : this._lastUpdateTs + 16;
    const dt = Math.min(0.1, Math.max(0.004, (nowTs - this._lastUpdateTs) / 1000));
    this._lastUpdateTs = nowTs;

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

    // Crisp tactile edge + auto-repeat navigation pulses for 2D menus & lists (Keyboard + Steam Deck)
    for (const dir of ['left', 'right', 'up', 'down']) {
      const isDown = this.down[dir] || (dir === 'left' && this.touchStickX < -0.5) ||
        (dir === 'right' && this.touchStickX > 0.5) ||
        (dir === 'up' && this.touchStickZ < -0.5) ||
        (dir === 'down' && this.touchStickZ > 0.5);
      if (this.pressed[dir]) {
        this.menuNav[dir] = true;
        this._navHold[dir] = 0.34;
      } else if (isDown) {
        this._navHold[dir] -= dt;
        if (this._navHold[dir] <= 0) {
          this.menuNav[dir] = true;
          this._navHold[dir] = 0.16;
        } else {
          this.menuNav[dir] = false;
        }
      } else {
        this.menuNav[dir] = false;
        this._navHold[dir] = 0;
      }
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
