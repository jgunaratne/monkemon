// Monkemon Audio Engine:
// - Crossfaded seamless Web Audio looper for all 11 Lyria 3 full-song MP3s (`assets/music/*.mp3`)
// - Daikon TTS character, House Leader, and Boss voice lines (`assets/voice/*.mp3`) routed through
//   a stereo room impulse response (`ConvolverNode`) with automatic 0.36x music ducking
// - Crisp synthesized procedural Web Audio SFX for Monkeball throws, wiggles, catches, and battle moves.

export const ASSET_VERSION = '20261108a';

function withVer(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.includes('?') || url.startsWith('blob:') || url.startsWith('data:')) return url;
  return `${url}?v=${ASSET_VERSION}`;
}

export const TRACKS = {
  title: 'assets/music/title.mp3',
  sunpalm: 'assets/music/sunpalm.mp3',
  canopy: 'assets/music/canopy.mp3',
  sparkstone: 'assets/music/sparkstone.mp3',
  frostpeak: 'assets/music/frostpeak.mp3',
  cinderpeak: 'assets/music/cinderpeak.mp3',
  battle: 'assets/music/battle.mp3',
  warden: 'assets/music/warden.mp3',
  monkezilla: 'assets/music/monkezilla.mp3',
  victory: 'assets/music/victory.mp3',
  ending: 'assets/music/ending.mp3',
};

export const VOICES = {
  prof_welcome: 'assets/voice/prof_welcome.mp3',
  alex_mom: 'assets/voice/alex_mom.mp3',
  house_pb: 'assets/voice/house_pb.mp3',
  house_fish: 'assets/voice/house_fish.mp3',
  house_pork: 'assets/voice/house_pork.mp3',
  house_beef: 'assets/voice/house_beef.mp3',
  scout_milo: 'assets/voice/scout_milo.mp3',
  scout_pippa: 'assets/voice/scout_pippa.mp3',
  tamer_bobby: 'assets/voice/tamer_bobby.mp3',
  tamer_daisy: 'assets/voice/tamer_daisy.mp3',
  tamer_rex: 'assets/voice/tamer_rex.mp3',
  boss19_titanape: 'assets/voice/boss19_titanape.mp3',
  boss20_monkezilla: 'assets/voice/boss20_monkezilla.mp3',
  narrator_ending: 'assets/voice/narrator_ending.mp3',
  warden_taro: 'assets/voice/warden_taro.mp3',
  warden_liana: 'assets/voice/warden_liana.mp3',
  warden_voltair: 'assets/voice/warden_voltair.mp3',
  champion_kongo: 'assets/voice/champion_kongo.mp3',
};

const FALLBACK_TRACK = 'sunpalm';
const MAX_DECODED = 5;
const VOICE_DUCK_RATIO = 0.36;

function findTrimPoints(buf) {
  const ch = buf.getChannelData(0);
  const len = ch.length;
  const sr = buf.sampleRate || 44100;
  const thresh = 0.0025;
  let s = 0;
  while (s < len - sr && Math.abs(ch[s]) < thresh) s++;
  let e = len - 1;
  while (e > s + sr && Math.abs(ch[e]) < thresh) e--;
  return { start: Math.max(0, s / sr - 0.02), end: Math.min(buf.duration, e / sr + 0.04) };
}

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.voiceBus = null;
    this.buffers = new Map();
    this.loading = new Map();
    this.musicRaw = new Map();
    this.voiceRaw = new Map();
    this.voiceBuffers = new Map();
    this.current = null;
    this.pendingTrack = null;
    this.pendingVoice = null;
    this.activeVoice = null;
    this.voiceDucking = false;
    this.duckTimer = null;
    this._voiceSeq = 0;
    this.muted = false;
    this.musicVolume = 0.52;
    this.sfxVolume = 0.65;
    this.onVoiceEvent = null; // ({ active, speaker, line, key, duration }) => void
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }
    this._kickSilent();

    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.voiceDucking ? this.musicVolume * VOICE_DUCK_RATIO : this.musicVolume;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.voiceBus = this.ctx.createGain();
    this.voiceBus.gain.value = 1.0;
    this._initVoiceAcoustics();

    if (typeof document !== 'undefined' && !this._visBound) {
      this._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.ctx && this.ctx.state !== 'running') {
          this.ctx.resume().catch(() => {});
        }
      });
    }

    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.playMusic(t.name, t.loop);
    }
    if (this.pendingVoice) {
      const v = this.pendingVoice;
      this.pendingVoice = null;
      this.playVoice(v.key, v.meta);
    }
  }

  _kickSilent() {
    if (!this.ctx) return;
    try {
      const b = this.ctx.createBuffer(1, 1, 22050);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
    } catch {
      // ignore
    }
  }

  _initVoiceAcoustics() {
    if (!this.ctx || !this.voiceBus || !this.master) return;
    try {
      const sr = this.ctx.sampleRate || 44100;
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 95;
      this.voiceBus.connect(hpf);

      const dry = this.ctx.createGain();
      dry.gain.value = 0.98;
      hpf.connect(dry);
      dry.connect(this.master);

      // Warm cozy amphitheater stereo impulse response (0.85s tail)
      const irLen = Math.floor(sr * 0.85);
      const irBuf = this.ctx.createBuffer(2, irLen, sr);
      const pre = Math.floor(sr * 0.014);
      for (let ch = 0; ch < 2; ch++) {
        const d = irBuf.getChannelData(ch);
        let lp = 0;
        let seed = ch === 0 ? 0x517cc1b7 : 0x9e3779b9;
        for (let i = pre; i < irLen; i++) {
          const t = (i - pre) / (irLen - pre);
          seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x165667b1) >>> 0;
          const white = (seed / 0xffffffff) * 2 - 1;
          lp = lp * (0.32 + 0.45 * t) + white * (0.68 - 0.45 * t);
          d[i] = lp * Math.pow(1 - t, 3.1) * 0.35;
        }
      }
      const conv = this.ctx.createConvolver();
      conv.buffer = irBuf;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.18;
      hpf.connect(conv);
      conv.connect(wet);
      wet.connect(this.master);
    } catch {
      this.voiceBus.connect(this.master);
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  prefetch(name) {
    const url = TRACKS[name];
    if (!url || this.buffers.has(name)) return;
    if (this.ctx) {
      this.ensureBuffer(name);
      return;
    }
    if (!this.musicRaw.has(name) && typeof fetch !== 'undefined') {
      this.musicRaw.set(
        name,
        fetch(withVer(url))
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      );
    }
  }

  prefetchVoice(key) {
    const url = VOICES[key];
    if (!url || this.voiceBuffers.has(key) || this.voiceRaw.has(key) || typeof fetch === 'undefined') return;
    this.voiceRaw.set(
      key,
      fetch(withVer(url))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null),
    );
  }

  ensureBuffer(name) {
    if (this.buffers.has(name)) {
      const b = this.buffers.get(name);
      this.buffers.delete(name);
      this.buffers.set(name, b);
      return Promise.resolve(b);
    }
    if (this.loading.has(name)) return this.loading.get(name);
    const url = TRACKS[name];
    if (!url || !this.ctx) return Promise.resolve(null);
    const p = (async () => {
      try {
        let raw = this.musicRaw.has(name) ? await this.musicRaw.get(name) : null;
        if (!raw) {
          const res = await fetch(withVer(url));
          if (!res.ok) return null;
          raw = await res.arrayBuffer();
        } else {
          this.musicRaw.delete(name);
        }
        const buf = await this.ctx.decodeAudioData(raw.slice(0));
        this.buffers.set(name, buf);
        while (this.buffers.size > MAX_DECODED) {
          const oldest = this.buffers.keys().next().value;
          if (this.current && this.current.name === oldest) break;
          this.buffers.delete(oldest);
        }
        return buf;
      } catch (err) {
        console.warn('music decode failed', name, err);
        return null;
      } finally {
        this.loading.delete(name);
      }
    })();
    this.loading.set(name, p);
    return p;
  }

  stopMusic(fadeSec = 0.45) {
    const cur = this.current;
    this.current = null;
    if (!cur) return;
    cur.stopped = true;
    if (cur.timer) clearTimeout(cur.timer);
    if (cur.gain && this.ctx) {
      const t = this.ctx.currentTime;
      try {
        cur.gain.gain.cancelScheduledValues(t);
        cur.gain.gain.setValueAtTime(cur.gain.gain.value, t);
        cur.gain.gain.linearRampToValueAtTime(0.0001, t + fadeSec);
      } catch {
        // ignore
      }
      setTimeout(() => {
        for (const s of cur.sources) {
          try { s.stop(); } catch {}
        }
        try { cur.gain.disconnect(); } catch {}
      }, Math.ceil(fadeSec * 1000) + 40);
    }
  }

  playMusic(name, loop = true) {
    if (!TRACKS[name]) name = FALLBACK_TRACK;
    if (!this.ctx) {
      this.pendingTrack = { name, loop };
      return;
    }
    if (this.current && this.current.name === name && !this.current.stopped) return;
    this.stopMusic(0.45);
    const entry = { name, loop, sources: [], gain: null, stopped: false, timer: null };
    this.current = entry;

    (async () => {
      const buf = await this.ensureBuffer(name);
      if (entry.stopped || !buf || !this.ctx) return;
      const trim = findTrimPoints(buf);
      const fullDur = Math.max(0.2, trim.end - trim.start);
      const xfade = Math.min(0.4, fullDur * 0.25);

      entry.gain = this.ctx.createGain();
      entry.gain.gain.value = 1.0;
      entry.gain.connect(this.musicBus);

      const schedule = (when) => {
        if (entry.stopped || !entry.gain || !this.ctx) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(1.0, when + xfade);
        g.gain.setValueAtTime(1.0, Math.max(when + xfade, when + fullDur - xfade));
        g.gain.linearRampToValueAtTime(0.0001, when + fullDur);
        src.connect(g).connect(entry.gain);
        src.start(when, trim.start, fullDur);
        entry.sources.push(src);
        src.onended = () => {
          entry.sources = entry.sources.filter((x) => x !== src);
        };
        if (loop) {
          const nextWhen = when + fullDur - xfade;
          const waitMs = Math.max(60, (nextWhen - this.ctx.currentTime - 0.85) * 1000);
          entry.timer = setTimeout(() => schedule(nextWhen), waitMs);
        }
      };
      schedule(this.ctx.currentTime + 0.04);
    })();
  }

  async ensureVoiceBuffer(key) {
    if (this.voiceBuffers.has(key)) return this.voiceBuffers.get(key);
    const url = VOICES[key];
    if (!url || !this.ctx) return null;
    try {
      let raw = this.voiceRaw.has(key) ? await this.voiceRaw.get(key) : null;
      if (!raw) {
        const res = await fetch(withVer(url));
        if (!res.ok) return null;
        raw = await res.arrayBuffer();
      }
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.voiceBuffers.set(key, buf);
      this.voiceRaw.delete(key);
      return buf;
    } catch (err) {
      console.warn('voice decode failed', key, err);
      return null;
    }
  }

  playVoice(key, meta = {}) {
    const speaker = meta.speaker || 'TAMER';
    const line = meta.line || '';
    if (this.onVoiceEvent && line) {
      this.onVoiceEvent({ active: true, speaker, line, key, duration: 4.5 });
    }
    if (!VOICES[key]) return;
    if (!this.ctx) {
      this.pendingVoice = { key, meta };
      return;
    }
    if (this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => {});
    }

    this._voiceSeq += 1;
    const seq = this._voiceSeq;
    if (this.activeVoice) {
      try { this.activeVoice.stop(); } catch {}
      this.activeVoice = null;
    }
    if (this.duckTimer) {
      clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }

    this.voiceDucking = true;
    if (this.musicBus) {
      const now0 = this.ctx.currentTime;
      this.musicBus.gain.cancelScheduledValues(now0);
      this.musicBus.gain.setTargetAtTime(this.musicVolume * VOICE_DUCK_RATIO, now0, 0.06);
    }

    (async () => {
      const buf = await this.ensureVoiceBuffer(key);
      if (seq !== this._voiceSeq) return;
      if (!buf || !this.ctx) {
        this.stopVoice();
        return;
      }
      if (this.onVoiceEvent && line) {
        this.onVoiceEvent({ active: true, speaker, line, key, duration: buf.duration });
      }
      const now = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 1.35;
      src.connect(g).connect(this.voiceBus || this.master);
      this.activeVoice = src;

      const restore = () => {
        if (seq !== this._voiceSeq) return;
        this.activeVoice = null;
        this.voiceDucking = false;
        if (this.musicBus && this.ctx) {
          this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.32);
        }
        if (this.onVoiceEvent) {
          this.onVoiceEvent({ active: false, speaker: '', line: '', key: '' });
        }
      };

      src.onended = () => {
        if (seq !== this._voiceSeq) return;
        if (this.duckTimer) clearTimeout(this.duckTimer);
        this.duckTimer = setTimeout(restore, 350);
      };
      this.duckTimer = setTimeout(restore, Math.ceil(buf.duration * 1000) + 650);
      src.start(now + 0.02);
    })();
  }

  stopVoice() {
    this._voiceSeq += 1;
    this.pendingVoice = null;
    if (this.activeVoice) {
      try { this.activeVoice.stop(); } catch {}
      this.activeVoice = null;
    }
    if (this.duckTimer) {
      clearTimeout(this.duckTimer);
      this.duckTimer = null;
    }
    this.voiceDucking = false;
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.2);
    }
    if (this.onVoiceEvent) {
      this.onVoiceEvent({ active: false, speaker: '', line: '', key: '' });
    }
  }

  // Synthesized toy-diorama & real-time combat SFX (zero network latency)
  playSfx(kind) {
    if (this.muted || !this.ctx || !this.sfxBus) return;
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    const t = this.ctx.currentTime;
    const tone = (freq0, freq1, dur, type = 'sine', vol = 0.24, delay = 0) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq0, t + delay);
      if (freq1 !== freq0) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(24, freq1), t + delay + dur);
      }
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.linearRampToValueAtTime(vol, t + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t + delay + dur);
      osc.connect(g).connect(this.sfxBus);
      osc.start(t + delay);
      osc.stop(t + delay + dur + 0.02);
    };

    switch (kind) {
      case 'menu':
        tone(540, 720, 0.07, 'triangle', 0.16);
        break;
      case 'confirm':
        tone(523.25, 659.25, 0.09, 'triangle', 0.22, 0);
        tone(659.25, 1046.5, 0.14, 'triangle', 0.22, 0.07);
        break;
      case 'throw_ball':
        tone(310, 920, 0.22, 'sine', 0.26);
        break;
      case 'ball_bounce':
        tone(420, 260, 0.1, 'triangle', 0.22);
        break;
      case 'ball_wiggle':
        tone(480, 620, 0.11, 'sine', 0.2, 0);
        tone(620, 520, 0.11, 'sine', 0.16, 0.09);
        break;
      case 'catch_fanfare':
        tone(523.25, 523.25, 0.12, 'triangle', 0.25, 0.0);
        tone(659.25, 659.25, 0.12, 'triangle', 0.25, 0.11);
        tone(783.99, 783.99, 0.12, 'triangle', 0.25, 0.22);
        tone(1046.5, 1046.5, 0.36, 'triangle', 0.3, 0.34);
        break;
      case 'break_free':
        tone(420, 165, 0.26, 'sawtooth', 0.2);
        break;
      case 'berry':
        tone(587.3, 880, 0.15, 'sine', 0.22);
        break;
      case 'heal':
        tone(440, 554.37, 0.14, 'sine', 0.22, 0);
        tone(554.37, 659.25, 0.14, 'sine', 0.22, 0.13);
        tone(659.25, 880, 0.28, 'sine', 0.26, 0.26);
        break;
      case 'trainer_spot':
        tone(740, 987.77, 0.11, 'square', 0.2, 0);
        tone(987.77, 1174.66, 0.22, 'square', 0.22, 0.1);
        break;
      case 'monk_run':
        tone(220, 540, 0.16, 'sawtooth', 0.22);
        break;
      case 'fake_out':
        tone(880, 320, 0.14, 'square', 0.22, 0);
        tone(660, 990, 0.12, 'triangle', 0.18, 0.06);
        break;
      case 'eat_snack':
        tone(340, 480, 0.11, 'triangle', 0.24, 0);
        tone(380, 560, 0.11, 'triangle', 0.24, 0.12);
        tone(523, 784, 0.2, 'sine', 0.22, 0.24);
        break;
      case 'sky_jump':
        tone(260, 780, 0.22, 'sine', 0.24, 0);
        tone(180, 72, 0.25, 'sawtooth', 0.28, 0.24);
        break;
      case 'special':
        tone(330, 880, 0.25, 'sawtooth', 0.24, 0);
        tone(660, 1320, 0.22, 'triangle', 0.2, 0.12);
        break;
      case 'super_hit':
        tone(210, 68, 0.24, 'sawtooth', 0.3, 0);
        tone(784, 1174, 0.18, 'triangle', 0.24, 0.04);
        break;
      case 'hit':
        tone(180, 82, 0.16, 'triangle', 0.26);
        break;
      case 'faint':
        tone(360, 110, 0.42, 'sawtooth', 0.24);
        break;
      default:
        tone(440, 520, 0.08, 'sine', 0.15);
    }
  }
}
