import type { Frame } from '../core/input';
import {
  decodeFrame,
  encodeFrame,
  type ServerMessage,
  type Snapshot,
  type WireFrame,
} from './protocol';

export type Role = 'offline' | 'host' | 'guest';

export interface NetHandlers {
  onRole?: (role: Role, id: number, room: string) => void;
  onJoin?: (id: number, name: string, cls: string) => void;
  onLeave?: (id: number) => void;
  /** Host side: a guest answered their boon offer. */
  onPick?: (id: number, boonId: string) => void;
  onSnapshot?: (snap: Snapshot) => void;
  onFull?: () => void;
  onClose?: (reason: string) => void;
}

/**
 * Thin transport. It knows nothing about the game — it moves input one way and
 * snapshots the other, and reports who is in the room. All authority lives in
 * the host's World.
 */
export class Net {
  role: Role = 'offline';
  id = 0;
  room = '';
  connected = false;

  /** Latest input received from each guest, consumed by the host each tick. */
  readonly remoteFrames = new Map<number, Frame>();
  /** Guests present, in join order — drives seat assignment on the host. */
  readonly peers: { id: number; name: string; cls: string }[] = [];

  /** Assigned after construction, once the boon round has somewhere to deliver to. */
  onPickHandler: ((netId: number, boonId: string) => void) | null = null;

  private ws: WebSocket | null = null;
  private lastSent = 0;

  constructor(private handlers: NetHandlers = {}) {}

  connect(url: string, room: string, name: string, cls: string) {
    this.disconnect();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      ws.send(JSON.stringify({ t: 'hello', room, name, cls }));
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.handle(msg);
    };

    ws.onerror = () => this.handlers.onClose?.('connection error');
    ws.onclose = () => {
      this.connected = false;
      this.role = 'offline';
      this.handlers.onClose?.('disconnected');
    };
  }

  private handle(msg: ServerMessage) {
    switch (msg.t) {
      case 'role':
        this.role = msg.role;
        this.id = msg.id;
        this.room = msg.room;
        this.handlers.onRole?.(msg.role, msg.id, msg.room);
        break;
      case 'join':
        this.peers.push({ id: msg.id, name: msg.name, cls: msg.cls });
        this.handlers.onJoin?.(msg.id, msg.name, msg.cls);
        break;
      case 'pick':
        this.onPickHandler?.(msg.id, msg.boonId);
        this.handlers.onPick?.(msg.id, msg.boonId);
        break;
      case 'leave': {
        const i = this.peers.findIndex((p) => p.id === msg.id);
        if (i >= 0) this.peers.splice(i, 1);
        this.remoteFrames.delete(msg.id);
        this.handlers.onLeave?.(msg.id);
        break;
      }
      case 'in':
        this.remoteFrames.set(msg.id, decodeFrame(msg.f));
        break;
      case 'sn':
        this.handlers.onSnapshot?.(msg);
        break;
      case 'full':
        this.handlers.onFull?.();
        break;
    }
  }

  /** Guest → host, every tick. */
  sendInput(f: Frame) {
    if (this.role !== 'guest' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const w: WireFrame = encodeFrame(f);
    this.ws.send(JSON.stringify({ t: 'in', f: w }));
  }

  /** Guest → host, once, when the player picks from their boon offer. */
  sendPick(boonId: string) {
    if (this.role !== 'guest' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ t: 'pick', boonId }));
  }

  /** Host → guests. Rate-limited to 30Hz; the render loop runs faster than the wire needs to. */
  sendSnapshot(snap: Snapshot, now: number) {
    if (this.role !== 'host' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (now - this.lastSent < 33) return;
    this.lastSent = now;
    this.ws.send(JSON.stringify(snap));
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.role = 'offline';
    this.peers.length = 0;
    this.remoteFrames.clear();
  }
}
