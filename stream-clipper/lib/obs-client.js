import { createHash } from 'node:crypto';

export class ObsClient {
  constructor({ host = '127.0.0.1', port = 4455, password = '' } = {}) {
    this.host = host;
    this.port = Number(port);
    this.password = password;
    this.socket = null;
    this.pending = new Map();
    this.nextId = 1;
    this.events = new Set();
    this.state = 'disconnected';
    this.lastError = null;
  }

  async connect() {
    if (this.socket && this.state === 'connected') return this.request('GetReplayBufferStatus');
    this.state = 'connecting';
    this.lastError = null;
    const socket = new WebSocket(`ws://${this.host}:${this.port}`);
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to OBS WebSocket.')), 8000);
      socket.addEventListener('open', () => clearTimeout(timer), { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Could not reach OBS WebSocket. Check OBS and its port.')); }, { once: true });
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.state = 'disconnected';
      });
    });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('OBS authentication timed out.')), 8000);
      const onMessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.op === 0) {
          try {
            const auth = msg.d.authentication ? createHash('sha256').update(
              createHash('sha256').update(this.password + msg.d.authentication.salt).digest('base64') + msg.d.authentication.challenge
            ).digest('base64') : undefined;
            // General (1), Inputs (8), Outputs (64), and high-volume InputVolumeMeters (65536).
            socket.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 1 | 8 | 64 | 65536, ...(auth ? { authentication: auth } : {}) } }));
          } catch (error) { clearTimeout(timeout); reject(error); }
        } else if (msg.op === 2) {
          clearTimeout(timeout);
          this.state = 'connected';
          resolve();
        } else if (msg.op === 7) {
          const waiter = this.pending.get(msg.d.requestId);
          if (waiter) {
            this.pending.delete(msg.d.requestId);
            if (msg.d.requestStatus.result) waiter.resolve(msg.d.responseData || {});
            else waiter.reject(new Error(msg.d.requestStatus.comment || 'OBS request failed.'));
          }
        } else if (msg.op === 5) {
          for (const listener of this.events) listener(msg.d.eventType, msg.d.eventData || {});
        } else if (msg.op === 9) {
          clearTimeout(timeout);
          reject(new Error(msg.d.authentication ? 'OBS rejected the password. Check the WebSocket password.' : 'OBS rejected the connection.'));
        }
      };
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', () => {
        clearTimeout(timeout);
        for (const waiter of this.pending.values()) waiter.reject(new Error('OBS connection closed.'));
        this.pending.clear();
        if (this.socket === socket) this.state = 'disconnected';
      });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('OBS WebSocket connection failed.'));
      });
    }).then(() => this.request('GetReplayBufferStatus'));
  }

  request(requestType, requestData = {}) {
    if (!this.socket || this.state !== 'connected') return Promise.reject(new Error('Connect to OBS first.'));
    const requestId = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS request ${requestType} timed out.`)); }, 10000);
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  onEvent(listener) { this.events.add(listener); return () => this.events.delete(listener); }
  close() { this.socket?.close(); this.socket = null; this.state = 'disconnected'; }
}
