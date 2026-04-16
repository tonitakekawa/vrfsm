// Pure FSM data model — no Three.js dependency

let _uid = 0;
function uid(prefix) { return `${prefix}${Date.now()}_${_uid++}`; }

export class FSM {
  constructor() {
    this.states = new Map();
    this.transitions = new Map();
    this.currentStateIds = new Set();
    this.initialStateIds = [];
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
    if (!this.initialStateIds.length) this.initialStateIds = [id];
    this.emit('stateAdded', state);
    return id;
  }

  removeState(id) {
    if (!this.states.has(id)) return;
    this.states.delete(id);
    this.initialStateIds = this.initialStateIds.filter(sid => sid !== id);
    if (!this.initialStateIds.length && this.states.size > 0) {
      this.initialStateIds = [this.states.keys().next().value];
    }
    const prevActive = [...this.currentStateIds];
    this.currentStateIds.delete(id);
    // remove connected transitions
    const toRemove = [];
    for (const t of this.transitions.values()) {
      if (t.fromId === id || t.toId === id) toRemove.push(t.id);
    }
    toRemove.forEach(tid => this.removeTransition(tid));
    this.emit('stateRemoved', { id });
    this.emit('initialStatesChanged', { ids: [...this.initialStateIds] });
    if (prevActive.length !== this.currentStateIds.size) {
      this.emit('activeStatesChanged', { prevIds: prevActive, nextIds: [...this.currentStateIds] });
    }
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
    if (!this.initialStateIds.includes(id)) this.initialStateIds.push(id);
    this.emit('initialStatesChanged', { ids: [...this.initialStateIds] });
  }

  toggleInitialState(id) {
    if (!this.states.has(id)) return;
    if (this.initialStateIds.includes(id)) {
      this.initialStateIds = this.initialStateIds.filter(sid => sid !== id);
    } else {
      this.initialStateIds.push(id);
    }
    this.emit('initialStatesChanged', { ids: [...this.initialStateIds] });
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
    const prevIds = [...this.currentStateIds];
    this.currentStateIds = new Set(this.initialStateIds.filter(id => this.states.has(id)));
    this.emit('activeStatesChanged', { prevIds, nextIds: [...this.currentStateIds] });
  }

  transitionToState(id) {
    if (!this.states.has(id)) return false;
    const prevIds = [...this.currentStateIds];
    this.currentStateIds = new Set([id]);
    this.emit('activeStatesChanged', { prevIds, nextIds: [...this.currentStateIds] });
    return true;
  }

  fire(trigger) {
    if (!this.currentStateIds.size) return false;
    let changed = false;
    const nextIds = new Set();
    for (const stateId of this.currentStateIds) {
      let transitioned = false;
      for (const t of this.transitions.values()) {
        if (t.fromId === stateId && t.trigger === trigger) {
          nextIds.add(t.toId);
          transitioned = true;
          changed = true;
        }
      }
      if (!transitioned) nextIds.add(stateId);
    }
    if (changed) {
      const prevIds = [...this.currentStateIds];
      this.currentStateIds = nextIds;
      this.emit('activeStatesChanged', { prevIds, nextIds: [...this.currentStateIds] });
      return true;
    }
    return false;
  }

  getActiveStateIds() {
    return [...this.currentStateIds];
  }

  getInitialStateIds() {
    return [...this.initialStateIds];
  }

  isStateActive(id) {
    return this.currentStateIds.has(id);
  }

  isInitialState(id) {
    return this.initialStateIds.includes(id);
  }

  getStateTransitions(stateId) {
    return [...this.transitions.values()].filter(t => t.fromId === stateId);
  }

  getAvailableTransitions() {
    if (!this.currentStateIds.size) return [];
    return [...this.transitions.values()].filter(t => this.currentStateIds.has(t.fromId));
  }

  reset() {
    const prevIds = [...this.currentStateIds];
    this.currentStateIds = new Set();
    this.emit('activeStatesChanged', { prevIds, nextIds: [] });
  }

  // ---------- Persistence ----------

  toJSON() {
    return JSON.stringify({
      states: [...this.states.values()],
      transitions: [...this.transitions.values()],
      initialStateIds: this.initialStateIds,
      initialStateId: this.initialStateIds[0] || null,
      activeStateIds: [...this.currentStateIds],
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
      this.initialStateIds = Array.isArray(data.initialStateIds)
        ? data.initialStateIds.filter(id => this.states.has(id))
        : (data.initialStateId && this.states.has(data.initialStateId) ? [data.initialStateId] : []);
      if (!this.initialStateIds.length && this.states.size > 0) {
        this.initialStateIds = [this.states.keys().next().value];
      }
      this.currentStateIds = new Set(
        Array.isArray(data.activeStateIds)
          ? data.activeStateIds.filter(id => this.states.has(id))
          : [],
      );
      this.emit('fsmReplaced', {
        states: [...this.states.values()],
        transitions: [...this.transitions.values()],
        initialStateIds: [...this.initialStateIds],
        activeStateIds: [...this.currentStateIds],
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
