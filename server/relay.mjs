import { WebSocketServer } from 'ws';

/**
 * Dumb room relay. It holds no game state and makes no rulings — the first
 * client into a room is the host and owns the simulation; everyone else sends
 * input and receives snapshots. Keeping authority in one browser means the
 * server can never disagree with the game, and it stays a ~100 line process.
 */

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PLAYERS = 4;

/** room code -> { host, peers: Map<id, ws> } */
const rooms = new Map();
let nextId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`[relay] listening on ws://localhost:${PORT}`);

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function leave(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  room.peers.delete(ws.id);

  if (room.host === ws) {
    // Host left: the run cannot continue, so tear the room down and let the
    // clients decide what to do. Migrating authority mid-run would need full
    // state transfer for no real benefit at this scale.
    for (const peer of room.peers.values()) send(peer, { t: 'leave', id: ws.id });
    rooms.delete(ws.room);
    console.log(`[relay] room ${ws.room} closed (host left)`);
    return;
  }

  send(room.host, { t: 'leave', id: ws.id });
  console.log(`[relay] ${ws.name} left ${ws.room} (${room.peers.size + 1} remain)`);
}

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === 'hello') {
      const code = String(msg.room || '').toUpperCase().slice(0, 6);
      if (!code) return;
      ws.room = code;
      ws.name = String(msg.name || 'player').slice(0, 16);
      ws.cls = String(msg.cls || 'warrior').slice(0, 12);

      let room = rooms.get(code);
      if (!room) {
        room = { host: ws, peers: new Map() };
        rooms.set(code, room);
        send(ws, { t: 'role', role: 'host', id: ws.id, room: code });
        console.log(`[relay] room ${code} opened by ${ws.name}`);
        return;
      }

      if (room.peers.size + 1 >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }

      room.peers.set(ws.id, ws);
      send(ws, { t: 'role', role: 'guest', id: ws.id, room: code });
      send(room.host, { t: 'join', id: ws.id, name: ws.name, cls: ws.cls });
      console.log(`[relay] ${ws.name} joined ${code} (${room.peers.size + 1} players)`);
      return;
    }

    const room = rooms.get(ws.room);
    if (!room) return;

    if (msg.t === 'in') {
      // Guest input only ever goes to the host.
      if (ws !== room.host) send(room.host, { t: 'in', id: ws.id, f: msg.f });
      return;
    }

    if (msg.t === 'pick') {
      // A guest chose a boon; only the host applies it.
      if (ws !== room.host) send(room.host, { t: 'pick', id: ws.id, boonId: msg.boonId });
      return;
    }

    if (msg.t === 'sn') {
      // Snapshots only ever come from the host.
      if (ws !== room.host) return;
      const payload = JSON.stringify(msg);
      for (const peer of room.peers.values()) {
        if (peer.readyState === peer.OPEN) peer.send(payload);
      }
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// Drop sockets that stopped answering, so rooms don't fill with ghosts.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
