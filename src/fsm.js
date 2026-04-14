// Pure FSM data model — no Three.js dependency

let _uid = 0;
function uid(prefix) { return `${prefix}${Date.now()}_${_uid++}`; }

export class FSM {
  constructor() {
    this.states = new Map();
    this.transitions = new Map();
    this.currentStateId = null;
    this.initialStateId = null;
    this._listeners = {};
  }

  // ---------- Event emitter ----------

  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
    return () => this.off(event, cb);
  }

  off(event, cb) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== cb);
    }
  }

  emit(event, data) {
    (this._listeners[event] || []).forEach(f => f(data));
  }

  // ---------- States ----------

  addState(name, position = { x: 0, y: 0, z: 0 }) {
    const id = uid('s');
    const state = { id, name, actions: [], position: { ...position } };
    this.states.set(id, state);
    if (!this.initialStateId) this.initialStateId = id;
    this.emit('stateAdded', state);
    return id;
  }

  removeState(id) {
    if (!this.states.has(id)) return;
    this.states.delete(id);
    if (this.initialStateId === id) {
      this.initialStateId = this.states.size > 0 ? this.states.keys().next().value : null;
    }
    if (this.currentStateId === id) this.currentStateId = null;
    // remove connected transitions
    const toRemove = [];
    for (const t of this.transitions.values()) {
      if (t.fromId === id || t.toId === id) toRemove.push(t.id);
    }
    toRemove.forEach(tid => this.removeTransition(tid));
    this.emit('stateRemoved', { id });
  }

  renameState(id, name) {
    const s = this.states.get(id);
    if (!s) return;
    s.name = name;
    this.emit('stateRenamed', { id, name });
  }

  moveState(id, position) {
    const s = this.states.get(id);
    if (!s) return;
    s.position = { ...position };
    this.emit('statePositionChanged', { id, position: s.position });
  }

  setStateActions(id, actions) {
    const s = this.states.get(id);
    if (!s) return;
    s.actions = [...actions];
    this.emit('stateActionChanged', { id, actions: s.actions });
  }

  setInitialState(id) {
    if (!this.states.has(id)) return;
    this.initialStateId = id;
    this.emit('initialStateChanged', { id });
  }

  // ---------- Transitions ----------

  addTransition(fromId, toId, trigger) {
    if (!this.states.has(fromId) || !this.states.has(toId)) return null;
    const id = uid('t');
    const transition = { id, fromId, toId, trigger };
    this.transitions.set(id, transition);
    this.emit('transitionAdded', transition);
    return id;
  }

  removeTransition(id) {
    if (!this.transitions.has(id)) return;
    this.transitions.delete(id);
    this.emit('transitionRemoved', { id });
  }

  renameTrigger(id, trigger) {
    const t = this.transitions.get(id);
    if (!t) return;
    t.trigger = trigger;
    this.emit('triggerRenamed', { id, trigger });
  }

  // ---------- Execution ----------

  start() {
    const prev = this.currentStateId;
    this.currentStateId = this.initialStateId;
    this.emit('currentStateChanged', { prevId: prev, nextId: this.currentStateId });
  }

  fire(trigger) {
    if (!this.currentStateId) return false;
    for (const t of this.transitions.values()) {
      if (t.fromId === this.currentStateId && t.trigger === trigger) {
        const prev = this.currentStateId;
        this.currentStateId = t.toId;
        this.emit('currentStateChanged', { prevId: prev, nextId: this.currentStateId });
        return true;
      }
    }
    return false;
  }

  getAvailableTransitions() {
    if (!this.currentStateId) return [];
    return [...this.transitions.values()].filter(t => t.fromId === this.currentStateId);
  }

  reset() {
    const prev = this.currentStateId;
    this.currentStateId = null;
    this.emit('currentStateChanged', { prevId: prev, nextId: null });
  }

  // ---------- Persistence ----------

  toJSON() {
    return JSON.stringify({
      states: [...this.states.values()],
      transitions: [...this.transitions.values()],
      initialStateId: this.initialStateId,
    });
  }

  fromJSON(json) {
    try {
      const data = JSON.parse(json);
      if (!Array.isArray(data.states) || !Array.isArray(data.transitions)) return false;
      const normalizedStates = data.states.map(s => ({
        ...s,
        actions: Array.isArray(s.actions)
          ? s.actions
          : (typeof s.action === 'string' && s.action.trim()
            ? [{ type: 'message', text: s.action.trim() }]
            : []),
      }));
      this.states = new Map(normalizedStates.map(s => [s.id, s]));
      this.transitions = new Map(data.transitions.map(t => [t.id, t]));
      this.initialStateId = data.initialStateId || null;
      this.currentStateId = null;
      this.emit('fsmReplaced', {
        states: [...this.states.values()],
        transitions: [...this.transitions.values()],
        initialStateId: this.initialStateId,
      });
      return true;
    } catch (e) {
      console.error('FSM.fromJSON failed:', e);
      return false;
    }
  }
}

// ---------- Default state from state.md ----------
export function loadDefaultFSM(fsm) {
  const positions = [
    { x: 0,   y: 0, z: 0   },  // 未着手
    { x: 2.5, y: 0, z: -1  },  // 設計中
    { x: 2.5, y: 0, z: 1.5 },  // 実装中
    { x: 5,   y: 0, z: 0   },  // テスト中
    { x: 7.5, y: 0, z: 0   },  // 完了
  ];

  const s0 = fsm.addState('未着手',  positions[0]);
  const s1 = fsm.addState('設計中',  positions[1]);
  const s2 = fsm.addState('実装中',  positions[2]);
  const s3 = fsm.addState('テスト中', positions[3]);
  const s4 = fsm.addState('完了',    positions[4]);

  fsm.setStateActions(s0, [
    { type: 'message', text: '要件を確認し、最初の着手ポイントを決める' },
  ]);
  fsm.setStateActions(s1, [
    { type: 'message', text: '仕様を詰め、必要な画面やデータ構造を整理する' },
    { type: 'wait', durationMs: 800 },
  ]);
  fsm.setStateActions(s2, [
    { type: 'message', text: '実装を進め、途中で気づいた論点をメモする' },
  ]);
  fsm.setStateActions(s3, [
    { type: 'message', text: '動作確認を行い、問題があれば原因を切り分ける' },
  ]);
  fsm.setStateActions(s4, [
    { type: 'message', text: '成果を確認し、次の改善や追加要件を整理する' },
  ]);

  fsm.addTransition(s0, s1, '開始');
  fsm.addTransition(s1, s2, '設計確定');
  fsm.addTransition(s1, s1, '仕様変更');  // 自己ループ
  fsm.addTransition(s2, s3, 'ビルド成功');
  fsm.addTransition(s2, s1, '設計見直し');
  fsm.addTransition(s3, s4, '全テスト通過');
  fsm.addTransition(s3, s2, 'バグ発見');
  fsm.addTransition(s3, s1, '仕様崩壊');
  fsm.addTransition(s4, s1, '機能追加');

  fsm.setInitialState(s0);
}
