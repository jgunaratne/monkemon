// Real-Time Archipelago Multiplayer Client (`/ws`)
// Synchronizes online Tamers and their following Partner Monkemon across all 5 zones.

import { getSpecies } from '../data/species.js';
import { makeLabelSprite } from './model_loader.js';

export class NetClient {
  constructor(modelBank, sceneRoot) {
    this.modelBank = modelBank;
    this.sceneRoot = sceneRoot;
    this.ws = null;
    this.myId = null;
    this.peers = new Map(); // id -> { data, heroActor, partnerActor, label }
    this.onlineCount = 1;
    this._sendAccum = 0;
    this._closed = false;
  }

  connect(playerName = 'ALEX', room = 'archipelago') {
    if (typeof WebSocket === 'undefined') return;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws?room=${encodeURIComponent(room)}&name=${encodeURIComponent(playerName)}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.t === 'welcome') {
            this.myId = msg.id;
            this._applySnapshot(msg.peers || []);
          } else if (msg.t === 'snapshot') {
            this._applySnapshot(msg.peers || []);
          } else if (msg.t === 'leave') {
            this._removePeer(msg.id);
          }
        } catch {
          // ignore
        }
      });

      ws.addEventListener('close', () => {
        this.ws = null;
        if (!this._closed) {
          setTimeout(() => this.connect(playerName, room), 4500);
        }
      });
    } catch {
      // offline mode is supported seamlessly
    }
  }

  sendName(name) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ t: 'name', name }));
    }
  }

  _applySnapshot(peersList) {
    this.onlineCount = Math.max(1, peersList.length);
    const seen = new Set();
    for (const p of peersList) {
      if (!p || p.id === this.myId) continue;
      seen.add(p.id);
      let entry = this.peers.get(p.id);
      if (!entry) {
        const heroActor = this.modelBank.spawnActor({
          glbUrl: 'assets/models/hero_tamer.glb',
          scale: 1.55,
          primaryColor: '#38bdf8',
          secondaryColor: '#fef08a',
        });
        const sp = getSpecies((p.s && p.s.partnerId) || 'mugchimp');
        const partnerActor = this.modelBank.spawnActor({
          glbUrl: sp.glb,
          scale: sp.scale || 1.05,
          primaryColor: sp.palette.primary,
          secondaryColor: sp.palette.secondary,
        });
        const label = makeLabelSprite({
          title: p.name || 'TAMER',
          badgeText: 'ONLINE',
          badgeColor: '#38bdf8',
          widthWorld: 2.6,
        });
        label.position.set(0, 2.15, 0);
        heroActor.root.add(label);
        this.sceneRoot.add(heroActor.root, partnerActor.root);
        entry = {
          id: p.id,
          name: p.name,
          partnerId: sp.id,
          state: p.s || {},
          heroActor,
          partnerActor,
        };
        this.peers.set(p.id, entry);
      } else {
        entry.state = p.s || entry.state;
      }
    }
    for (const id of Array.from(this.peers.keys())) {
      if (!seen.has(id)) this._removePeer(id);
    }
  }

  _removePeer(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.sceneRoot.remove(entry.heroActor.root, entry.partnerActor.root);
    this.peers.delete(id);
  }

  update(dt, localSnapshot, currentZoneId) {
    this._sendAccum += dt;
    if (this._sendAccum >= 0.08 && this.ws && this.ws.readyState === 1) {
      this._sendAccum = 0;
      this.ws.send(JSON.stringify({ t: 'state', s: localSnapshot }));
    }

    const k = 1 - Math.exp(-10 * dt);
    for (const entry of this.peers.values()) {
      const s = entry.state || {};
      const visible = s.zoneId === currentZoneId;
      entry.heroActor.root.visible = visible;
      entry.partnerActor.root.visible = visible;
      if (!visible) continue;

      entry.heroActor.root.position.x += ((s.x || 0) - entry.heroActor.root.position.x) * k;
      entry.heroActor.root.position.z += ((s.z || 0) - entry.heroActor.root.position.z) * k;
      entry.heroActor.animRoot.rotation.y = s.yaw || 0;

      const px = (s.x || 0) - Math.sin(s.yaw || 0) * 1.45;
      const pz = (s.z || 0) - Math.cos(s.yaw || 0) * 1.45;
      entry.partnerActor.root.position.x += (px - entry.partnerActor.root.position.x) * (k * 0.75);
      entry.partnerActor.root.position.z += (pz - entry.partnerActor.root.position.z) * (k * 0.75);
    }
  }
}
