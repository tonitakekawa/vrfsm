export class P2PSync {
  constructor({ getSnapshot, applySnapshot, onStatus }) {
    this.getSnapshot = getSnapshot;
    this.applySnapshot = applySnapshot;
    this.onStatus = onStatus || (() => {});

    this.peerId = crypto.randomUUID();
    this.roomId = null;
    this.enabled = false;
    this.connections = new Map();
    this._pollTimer = null;
    this._heartbeatTimer = null;
  }

  async connect(roomId) {
    if (this.enabled && this.roomId === roomId) return;
    await this.disconnect();
    this.enabled = true;
    this.roomId = roomId;
    await this._post({ kind: 'register' });
    await this._poll();
    this._pollTimer = setInterval(() => this._poll(), 1500);
    this._heartbeatTimer = setInterval(() => this._post({ kind: 'register' }), 10_000);
    this._updateStatus();
  }

  async disconnect() {
    if (this.enabled && this.roomId) {
      try { await this._post({ kind: 'leave' }); } catch (_) {}
    }
    this.enabled = false;
    clearInterval(this._pollTimer);
    clearInterval(this._heartbeatTimer);
    this._pollTimer = null;
    this._heartbeatTimer = null;
    for (const conn of this.connections.values()) {
      conn.pc.close();
    }
    this.connections.clear();
    this.roomId = null;
    this._updateStatus();
  }

  broadcastSnapshot() {
    if (!this.enabled) return;
    const snapshot = this.getSnapshot();
    for (const conn of this.connections.values()) {
      if (conn.channel?.readyState === 'open') {
        conn.channel.send(JSON.stringify({ type: 'snapshot', snapshot }));
      }
    }
    this._updateStatus();
  }

  async _poll() {
    if (!this.enabled || !this.roomId) return;
    const res = await fetch(`/api/signal?room=${encodeURIComponent(this.roomId)}&peer=${encodeURIComponent(this.peerId)}`);
    const data = await res.json();
    for (const peerId of data.peers || []) {
      if (peerId === this.peerId || this.connections.has(peerId)) continue;
      if (this.peerId < peerId) this._createConnection(peerId, true);
    }
    for (const msg of data.messages || []) {
      await this._handleSignal(msg.from, msg.signal);
    }
    this._updateStatus();
  }

  async _post(payload) {
    if (!this.roomId && payload.kind !== 'register') return;
    await fetch('/api/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: this.roomId,
        peerId: this.peerId,
        ...payload,
      }),
    });
  }

  _createConnection(remoteId, initiator) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const conn = { pc, channel: null, initiator };
    this.connections.set(remoteId, conn);

    pc.onicecandidate = event => {
      if (event.candidate) {
        this._post({ kind: 'signal', targetId: remoteId, signal: { type: 'candidate', candidate: event.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.connections.delete(remoteId);
        this._updateStatus();
      }
    };

    pc.ondatachannel = event => {
      conn.channel = event.channel;
      this._setupChannel(remoteId, conn.channel);
    };

    if (initiator) {
      conn.channel = pc.createDataChannel('vrfsm');
      this._setupChannel(remoteId, conn.channel);
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => this._post({ kind: 'signal', targetId: remoteId, signal: { type: 'offer', sdp: pc.localDescription } }))
        .catch(() => {});
    }

    this._updateStatus();
    return conn;
  }

  _setupChannel(remoteId, channel) {
    channel.onopen = () => {
      const snapshot = this.getSnapshot();
      channel.send(JSON.stringify({ type: 'snapshot', snapshot }));
      this._updateStatus();
    };
    channel.onclose = () => this._updateStatus();
    channel.onmessage = async event => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'snapshot' && msg.snapshot) {
          await this.applySnapshot(msg.snapshot, remoteId);
        }
      } catch (_) {}
    };
  }

  async _handleSignal(from, signal) {
    let conn = this.connections.get(from);
    if (!conn) conn = this._createConnection(from, false);
    const { pc } = conn;

    if (signal.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this._post({ kind: 'signal', targetId: from, signal: { type: 'answer', sdp: pc.localDescription } });
      return;
    }

    if (signal.type === 'answer') {
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      }
      return;
    }

    if (signal.type === 'candidate') {
      try {
        await pc.addIceCandidate(signal.candidate);
      } catch (_) {}
    }
  }

  _updateStatus() {
    const connectedPeers = [...this.connections.values()].filter(
      conn => conn.channel?.readyState === 'open',
    ).length;
    this.onStatus({
      enabled: this.enabled,
      roomId: this.roomId,
      peerId: this.peerId,
      connectedPeers,
    });
  }
}
