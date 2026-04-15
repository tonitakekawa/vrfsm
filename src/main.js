import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

import { FSM, loadDefaultFSM } from './fsm.js';
import { World } from './world.js';
import { InputManager } from './input.js';
import { UIManager } from './ui.js';
import { createLabel, updateLabel } from './label.js';
import { P2PSync } from './p2p.js';

// ============================================================
// Three.js setup
// ============================================================

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(4, 3.5, 6);
camera.lookAt(4, 0, 0);

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a14);
scene.fog = new THREE.Fog(0x0a0a14, 15, 35);

// VR Button
document.getElementById('vr-btn-container').appendChild(VRButton.createButton(renderer));

// Orbit controls
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;
orbit.target.set(4, 0, 0);
orbit.update();

// Player rig — VR移動のためにカメラとコントローラーをまとめるグループ
const playerRig = new THREE.Group();
scene.add(playerRig);
playerRig.add(camera);

// VR Controllers
const ctrlFactory = new XRControllerModelFactory();

function makeController(i) {
  const ctrl = renderer.xr.getController(i);
  // Ray line
  const lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -6),
  ]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x88aaff }));
  ctrl.add(line);
  playerRig.add(ctrl);

  const grip = renderer.xr.getControllerGrip(i);
  grip.add(ctrlFactory.createControllerModel(grip));
  playerRig.add(grip);
  return ctrl;
}

const ctrl0 = makeController(0);
const ctrl1 = makeController(1);

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
// App state
// ============================================================

const fsm  = new FSM();
const ui   = new UIManager();
const input = new InputManager(renderer, camera);
const world = new World(scene, fsm);
let _isApplyingRemoteSnapshot = false;
let _clock = 0;
let _lastSnapshotSource = '';

input.addXRController(ctrl0);
input.addXRController(ctrl1);

let mode = 'edit';          // 'edit' | 'run'
let edgeFromId = null;      // stateId when drawing an edge
let createStateArmed = false;
let _autoNodeCount = 1;
const MOUSE_VERTICAL_SCALE = 0.01;
let _actionRunSerial = 0;
const _stateActionTokens = new Map();
const _busyActionStates = new Set();

const vrHud = new THREE.Group();
camera.add(vrHud);
vrHud.position.set(0, -0.48, -1.35);

const vrModeLabel = createLabel('', {
  fontSize: 26,
  scaleX: 1.55,
  scaleY: 0.22,
  bg: 'rgba(10,16,30,0.88)',
});
vrModeLabel.position.set(0, 0.12, 0);
vrHud.add(vrModeLabel);

const vrHintLabel = createLabel('', {
  fontSize: 24,
  scaleX: 1.85,
  scaleY: 0.24,
  bg: 'rgba(6,10,22,0.82)',
});
vrHintLabel.position.set(0, -0.08, 0);
vrHud.add(vrHintLabel);

const p2p = new P2PSync({
  getSnapshot: () => ({
    clock: _clock,
    sourceId: p2p.peerId,
    fsm: JSON.parse(fsm.toJSON()),
  }),
  applySnapshot: async snapshot => {
    const incomingClock = Number(snapshot.clock) || 0;
    const incomingSource = String(snapshot.sourceId || '');
    if (
      incomingClock < _clock ||
      (incomingClock === _clock && incomingSource <= _lastSnapshotSource)
    ) return;

    cancelActionRun();
    _isApplyingRemoteSnapshot = true;
    _clock = incomingClock;
    _lastSnapshotSource = incomingSource;
    try {
      const ok = fsm.fromJSON(JSON.stringify(snapshot.fsm));
      if (!ok) return;
      updateAutoNodeCounter();
      if (mode === 'run') {
        ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
        for (const stateId of fsm.getActiveStateIds()) runStateActions(stateId);
      } else {
        ui.hideTriggerButtons();
        refreshActionPanel();
      }
      refreshVrHud();
      ui.showToast('P2P更新を反映しました', 1200);
    } finally {
      _isApplyingRemoteSnapshot = false;
    }
  },
  onStatus: status => ui.setP2PStatus(status),
});

// ============================================================
// Load initial data — Cloudflare KV via /api/fsm
// ============================================================

const SLOT_LOCAL_KEY = 'vrfsm_slot';
let _slotId = null;

function getLocalDataKey(id = getSlotId()) {
  return `vrfsm_data:${id}`;
}

function isValidFSMData(data) {
  return !!data
    && Array.isArray(data.states)
    && Array.isArray(data.transitions);
}

function parseWaitDuration(text) {
  const value = text.trim().toLowerCase();
  if (!value) throw new Error('wait は時間を指定してください');
  if (value.endsWith('ms')) {
    const ms = Number(value.slice(0, -2));
    if (!Number.isFinite(ms) || ms < 0) throw new Error('wait の ms が不正です');
    return Math.round(ms);
  }
  if (value.endsWith('s')) {
    const sec = Number(value.slice(0, -1));
    if (!Number.isFinite(sec) || sec < 0) throw new Error('wait の秒数が不正です');
    return Math.round(sec * 1000);
  }
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) throw new Error('wait の時間が不正です');
  return Math.round(ms);
}

function parseActionScript(script) {
  const lines = script.split(/\r?\n/).map(line => line.trim());
  const actions = [];
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    actions.push(parseActionLine(line));
  }
  return actions;
}

function parseActionLine(line) {
  const idx = line.indexOf(':');
  if (idx === -1) throw new Error(`書式エラー: ${line}`);
  const type = line.slice(0, idx).trim().toLowerCase();
  const value = line.slice(idx + 1).trim();
  if (type === 'message') {
    if (!value) throw new Error('message は本文を指定してください');
    return { type: 'message', text: value };
  }
  if (type === 'wait') {
    return { type: 'wait', durationMs: parseWaitDuration(value) };
  }
  if (type === 'event') {
    if (!value) throw new Error('event はエッジ名を指定してください');
    return { type: 'event', trigger: value };
  }
  if (type === 'parallel') {
    const parts = value.split('|').map(part => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error('parallel は中身を指定してください');
    const actions = parts.map(parseActionLine);
    if (actions.some(action => action.type === 'event')) {
      throw new Error('parallel 内では event は使えません');
    }
    return { type: 'parallel', actions };
  }
  throw new Error(`未対応アクション: ${type}`);
}

function actionToScriptLine(action) {
  if (action.type === 'message') return `message: ${action.text || ''}`;
  if (action.type === 'wait') return `wait: ${action.durationMs}ms`;
  if (action.type === 'event') return `event: ${action.trigger || action.target || ''}`;
  if (action.type === 'parallel') {
    return `parallel: ${(action.actions || []).map(actionToScriptLine).join(' | ')}`;
  }
  return '';
}

function actionsToScript(actions = []) {
  return actions.map(actionToScriptLine).filter(Boolean).join('\n');
}

function formatWait(ms) {
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function describeAction(action, active = false) {
  const prefix = active ? '▶ ' : '• ';
  if (action.type === 'message') return `${prefix}message: ${action.text}`;
  if (action.type === 'wait') return `${prefix}wait: ${formatWait(action.durationMs)}`;
  if (action.type === 'event') return `${prefix}event: ${action.trigger || action.target}`;
  if (action.type === 'parallel') {
    const inner = (action.actions || []).map(describeAction).map(text => text.replace(/^• /, '')).join(' | ');
    return `${prefix}parallel: ${inner}`;
  }
  return `${prefix}${action.type}`;
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cancelActionRun() {
  _actionRunSerial += 1;
  _stateActionTokens.clear();
  _busyActionStates.clear();
  ui.setTriggerButtonsDisabled(false);
}

function areActionsBusy() {
  return _busyActionStates.size > 0;
}

function getTriggerButtonTransitions() {
  const seen = new Set();
  return fsm.getAvailableTransitions().filter(t => {
    if (seen.has(t.trigger)) return false;
    seen.add(t.trigger);
    return true;
  });
}

function tryLoadFSMJson(json) {
  try {
    const data = JSON.parse(json);
    if (!isValidFSMData(data)) return false;
  } catch (_) {
    return false;
  }
  return fsm.fromJSON(json);
}

function exportFSM() {
  const blob = new Blob([fsm.toJSON()], { type: 'application/json' });
  const link = document.createElement('a');
  const id = getSlotId();
  link.href = URL.createObjectURL(blob);
  link.download = `vrfsm-${id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  ui.showToast('JSONを書き出しました');
}

async function importFSMFile(file) {
  cancelActionRun();
  const text = await file.text();
  if (!tryLoadFSMJson(text)) {
    ui.showToast('JSONを読み込めませんでした');
    return;
  }
  updateAutoNodeCounter();
  cancelEdge();
  if (mode === 'run') {
    fsm.start();
    ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
  } else {
    ui.hideTriggerButtons();
    refreshActionPanel();
  }
  scheduleSave();
  ui.showToast('JSONを読み込みました');
}

function getSlotId() {
  if (_slotId) return _slotId;
  const params = new URLSearchParams(location.search);
  let id = params.get('id') || localStorage.getItem(SLOT_LOCAL_KEY);
  if (!id) id = crypto.randomUUID();
  localStorage.setItem(SLOT_LOCAL_KEY, id);
  _slotId = id;
  // URLに反映（リロードなし）
  if (!params.get('id')) {
    const url = new URL(location.href);
    url.searchParams.set('id', id);
    history.replaceState(null, '', url);
  }
  return id;
}

async function loadData() {
  const id = getSlotId();
  try {
    const res = await fetch(`/api/fsm?id=${id}`);
    if (res.ok) {
      const text = await res.text();
      if (tryLoadFSMJson(text)) return;
      throw new Error('Invalid FSM payload');
    }
    if (res.status !== 404) throw new Error(res.status);
  } catch (_) {}

  try {
    const saved = localStorage.getItem(getLocalDataKey(id));
    if (saved && tryLoadFSMJson(saved)) return;
  } catch (__) {}

  try {
    const legacy = localStorage.getItem('vrfsm_data');
    if (legacy) {
      localStorage.setItem(getLocalDataKey(id), legacy);
      localStorage.removeItem('vrfsm_data');
      if (tryLoadFSMJson(legacy)) {
        scheduleSave();
        return;
      }
    }
  } catch (__) {}

  loadDefaultFSM(fsm);
  world.sync();
  scheduleSave();
}

let _saveTimer = null;
function scheduleSave() {
  ui.markSaving();
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const json = fsm.toJSON();
    try {
      const res = await fetch(`/api/fsm?id=${getSlotId()}`, {
        method: 'PUT',
        body: json,
      });
      if (!res.ok) throw new Error(res.status);
    } catch (_) {
      // フォールバック: idごとに localStorage に保存
      try { localStorage.setItem(getLocalDataKey(), json); } catch (__) {}
    }
    ui.markSaved();
  }, 600);
}

let _syncTimer = null;
function scheduleP2PSync() {
  if (_isApplyingRemoteSnapshot) return;
  _clock += 1;
  _lastSnapshotSource = p2p.peerId;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    p2p.broadcastSnapshot();
  }, 120);
}

['stateAdded','stateRemoved','stateRenamed','statePositionChanged',
 'transitionAdded','transitionRemoved','triggerRenamed','initialStatesChanged','stateActionChanged','activeStatesChanged'
].forEach(ev => fsm.on(ev, scheduleSave));

['stateAdded','stateRemoved','stateRenamed','statePositionChanged',
 'transitionAdded','transitionRemoved','triggerRenamed','initialStatesChanged','stateActionChanged','activeStatesChanged'
].forEach(ev => fsm.on(ev, scheduleP2PSync));

// ============================================================
// Mode management
// ============================================================

function setMode(m) {
  cancelActionRun();
  mode = m;
  world.setMode(m);
  ui.setMode(m);
  setCreateStateArmed(false);
  cancelEdge();

  if (m === 'run') {
    fsm.start();
    ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
  } else {
    fsm.reset();
    ui.hideTriggerButtons();
    refreshActionPanel();
  }
  refreshVrHud();
}

// ============================================================
// Edit mode helpers
// ============================================================

function cancelEdge() {
  edgeFromId = null;
  ui.hideEdgeHint();
  world.clearSelection();
  refreshVrHud();
}

function setCreateStateArmed(armed) {
  createStateArmed = mode === 'edit' && armed;
  ui.setCreateStateArmed(createStateArmed);
  refreshVrHud();
}

async function createNode(pos) {
  const name = await ui.showTextInput('状態名を入力');
  setCreateStateArmed(false);
  if (!name) return;
  const id = fsm.addState(name, { x: pos.x, y: 0, z: pos.z });
  world.selectNode(id);
  refreshVrHud();
}

function createNodeQuick(pos) {
  const id = fsm.addState(nextAutoNodeName(), { x: pos.x, y: 0, z: pos.z });
  world.selectNode(id);
  ui.showToast('ノードを追加しました');
  refreshVrHud();
}

async function startEdge(fromId) {
  edgeFromId = fromId;
  const s = fsm.states.get(fromId);
  ui.showEdgeHint(s?.name || '?');
  world.selectNode(fromId);
  refreshVrHud();
}

async function completeEdge(toId) {
  const trigger = await ui.showTextInput('トリガー名を入力');
  if (!trigger) { cancelEdge(); return; }
  fsm.addTransition(edgeFromId, toId, trigger);
  cancelEdge();
}

function completeEdgeQuick(toId) {
  if (!edgeFromId) return;
  const fromId = edgeFromId;
  const from = fsm.states.get(fromId);
  const to = fsm.states.get(toId);
  const trigger = `${from?.name || 'State'}→${to?.name || 'State'}`;
  fsm.addTransition(fromId, toId, trigger);
  ui.showToast('エッジを追加しました');
  cancelEdge();
}

async function renameNode(id) {
  const s = fsm.states.get(id);
  if (!s) return;
  const name = await ui.showTextInput('新しい状態名', s.name);
  if (name) fsm.renameState(id, name);
}

async function editStateAction(id) {
  const s = fsm.states.get(id);
  if (!s) return;
  const script = await ui.showTextAreaInput(
    '状態アクションを入力 (message: / wait: / event: / parallel: a | b)',
    actionsToScript(s.actions || []),
  );
  if (script === null) return;
  try {
    const actions = parseActionScript(script);
    fsm.setStateActions(id, actions);
    ui.showToast(actions.length ? 'アクションを更新しました' : 'アクションをクリアしました');
  } catch (err) {
    ui.showToast(err.message || 'アクションを解釈できませんでした', 2800);
  }
  refreshActionPanel();
}

async function renameTrigger(tid) {
  const t = fsm.transitions.get(tid);
  if (!t) return;
  const trigger = await ui.showTextInput('新しいトリガー名', t.trigger);
  if (trigger) fsm.renameTrigger(tid, trigger);
}

function nextAutoNodeName() {
  let name = `State ${_autoNodeCount}`;
  const existing = new Set([...fsm.states.values()].map(s => s.name));
  while (existing.has(name)) {
    _autoNodeCount += 1;
    name = `State ${_autoNodeCount}`;
  }
  _autoNodeCount += 1;
  return name;
}

function updateAutoNodeCounter() {
  let max = 0;
  for (const state of fsm.states.values()) {
    const m = /^State (\d+)$/.exec(state.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  _autoNodeCount = max + 1;
}

function getGroundPointFromAnyController() {
  for (const ctrl of input._xrControllers) {
    const ground = input._raycastGroundFromController(ctrl);
    if (ground?.point) return ground;
  }
  return null;
}

function fireTransitionById(id) {
  if (areActionsBusy()) {
    ui.showToast('アクション実行中です');
    return false;
  }
  const transition = fsm.transitions.get(id);
  if (!transition) return false;
  const ok = fsm.fire(transition.trigger);
  if (ok) {
    const activeNames = fsm.getActiveStateIds()
      .map(stateId => fsm.states.get(stateId)?.name)
      .filter(Boolean);
    ui.showToast(`→ ${activeNames.join(', ') || '?'}`);
    ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
  } else {
    ui.showToast('遷移できません');
  }
  refreshVrHud();
  return ok;
}

function refreshVrHud() {
  const presenting = renderer.xr.isPresenting;
  vrHud.visible = presenting;
  if (!presenting) return;

  const selId = world.getSelectedId();
  const selected = selId ? fsm.states.get(selId) : null;
  const modeText = mode === 'edit' ? 'EDIT  Trigger: select  Grip: move' : 'RUN  Point green edge and pull trigger';

  let hintText = '';
  if (mode === 'edit' && edgeFromId) {
    const from = fsm.states.get(edgeFromId);
    hintText = `X edge from ${from?.name || '?'} / Trigger target / B cancel`;
  } else if (mode === 'edit' && createStateArmed) {
    hintText = 'Click floor to place new state / B cancel';
  } else if (mode === 'edit' && selected) {
    hintText = `Selected ${selected.name} / A add / X edge / Y initial / B clear`;
  } else if (mode === 'edit') {
    hintText = 'Use New State button or A / Trigger select / Grip drag node / Shift+drag height';
  } else {
    hintText = 'Use toolbar on Mac or edge trigger in VR to step';
  }

  updateLabel(vrModeLabel, modeText);
  updateLabel(vrHintLabel, hintText);
}

function refreshActionPanel(activeStateId = null, activeIndex = -1, headerText = '') {
  if (mode !== 'run') {
    ui.hideActionPanel();
    return;
  }
  const activeStateIds = fsm.getActiveStateIds();
  if (!activeStateIds.length) {
    ui.hideActionPanel();
    return;
  }
  const body = [];
  for (const stateId of activeStateIds) {
    const state = fsm.states.get(stateId);
    if (!state) continue;
    body.push(`[${state.name}]`);
    if (headerText && stateId === activeStateId) body.push(headerText);
    const actions = state.actions || [];
    if (!actions.length) {
      body.push('アクション未設定');
    } else {
      body.push(...actions.map((action, index) => describeAction(
        action,
        stateId === activeStateId && index === activeIndex,
      )));
    }
    body.push('');
  }
  if (body[body.length - 1] === '') body.pop();
  ui.showActionPanel(`Active States (${activeStateIds.length})`, body.join('\n'));
}

async function executeAction(action, stateId, runToken, indexForUI = -1) {
  if (runToken !== _stateActionTokens.get(stateId) || mode !== 'run' || !fsm.isStateActive(stateId)) return 'cancelled';

  if (action.type === 'message') {
    refreshActionPanel(stateId, indexForUI, 'アクション実行中');
    ui.showToast(action.text, 2400);
    await waitMs(250);
    return 'ok';
  }

  if (action.type === 'wait') {
    refreshActionPanel(stateId, indexForUI, `待機中 ${formatWait(action.durationMs)}`);
    await waitMs(action.durationMs);
    return 'ok';
  }

  if (action.type === 'event') {
    const trigger = action.trigger || action.target;
    refreshActionPanel(stateId, indexForUI, `遷移中 → ${trigger}`);
    const ok = fsm.fire(trigger);
    if (!ok) {
      ui.showToast(`event先のエッジが見つかりません: ${trigger}`, 2800);
      return 'ok';
    }
    return 'transitioned';
  }

  if (action.type === 'parallel') {
    refreshActionPanel(stateId, indexForUI, '並列アクション実行中');
    await Promise.all((action.actions || []).map(child => executeAction(child, stateId, runToken, indexForUI)));
    return 'ok';
  }

  return 'ok';
}

async function runStateActions(stateId) {
  const state = fsm.states.get(stateId);
  const runToken = ++_actionRunSerial;
  _stateActionTokens.set(stateId, runToken);
  const actions = state?.actions || [];

  if (!state || mode !== 'run') return;
  if (!actions.length) {
    _busyActionStates.delete(stateId);
    ui.setTriggerButtonsDisabled(areActionsBusy());
    refreshActionPanel();
    return;
  }

  _busyActionStates.add(stateId);
  ui.setTriggerButtonsDisabled(areActionsBusy());

  for (let i = 0; i < actions.length; i += 1) {
    const result = await executeAction(actions[i], stateId, runToken, i);
    if (result === 'cancelled') return;
    if (result === 'transitioned') {
      return;
    }
  }

  if (runToken !== _stateActionTokens.get(stateId) || mode !== 'run' || !fsm.isStateActive(stateId)) return;
  _busyActionStates.delete(stateId);
  ui.setTriggerButtonsDisabled(areActionsBusy());
  refreshActionPanel(stateId, -1, 'アクション完了');
}

// ============================================================
// Input handling
// ============================================================

input.setInteractable([...world.interactableNodes, ...world.interactableEdges]);

// Keep interactable list in sync (nodes/edges added/removed)
fsm.on('stateAdded',      () => input.setInteractable([...world.interactableNodes, ...world.interactableEdges]));
fsm.on('stateRemoved',    () => input.setInteractable([...world.interactableNodes, ...world.interactableEdges]));
fsm.on('transitionAdded', () => input.setInteractable([...world.interactableNodes, ...world.interactableEdges]));
fsm.on('transitionRemoved', () => input.setInteractable([...world.interactableNodes, ...world.interactableEdges]));

input.on('hover', ({ hit }) => {
  // Visual feedback could go here
  renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
});

input.on('select', ({ hit }) => {
  if (mode === 'edit') {
    const stateId = world.getNodeIdFromObject(hit?.object);
    if (stateId) {
      if (edgeFromId) {
        if (renderer.xr.isPresenting) {
          completeEdgeQuick(stateId);
        } else {
          completeEdge(stateId);
        }
      } else {
        world.selectNode(stateId);
        refreshVrHud();
      }
    }
  } else if (mode === 'run') {
    const transId = world.getTransitionIdFromObject(hit?.object);
    if (transId) fireTransitionById(transId);
  }
});

input.on('miss', ({ hit }) => {
  if (mode === 'edit') {
    if (edgeFromId) {
      cancelEdge();
      return;
    }
    world.clearSelection();
    refreshVrHud();
    if (createStateArmed && hit?.point) createNode(hit.point);
  }
});

// Drag
let _dragStateId = null;
let _dragStartPos = null;
input.on('drag', ({ hit, target, source, shiftKey, deltaY, controllerDelta }) => {
  if (mode !== 'edit') return;
  if (!_dragStateId) {
    _dragStateId = target;
    _dragStartPos = world.getNodePosition(target);
  }
  if (!_dragStateId || !_dragStartPos) return;

  if (source === 'mouse' && shiftKey) {
    orbit.enabled = false;
    const current = world.getNodePosition(_dragStateId) || _dragStartPos;
    const y = Math.max(-0.1, _dragStartPos.y - (deltaY * MOUSE_VERTICAL_SCALE));
    world.setNodePosition(_dragStateId, new THREE.Vector3(current.x, y, current.z));
    return;
  }

  if (source === 'xr' && hit?.point) {
    orbit.enabled = false;
    const y = Math.max(-0.1, _dragStartPos.y + (controllerDelta?.y || 0));
    world.setNodePosition(_dragStateId, new THREE.Vector3(hit.point.x, y, hit.point.z));
    return;
  }

  if (hit?.point) {
    orbit.enabled = false;
    world.setNodePosition(_dragStateId, new THREE.Vector3(hit.point.x, _dragStartPos.y, hit.point.z));
  }
});
input.on('dragEnd', () => {
  _dragStateId = null;
  _dragStartPos = null;
  orbit.enabled = true;
  refreshVrHud();
});

// Context menu
input.on('contextmenu', ({ hit, x, y }) => {
  if (mode !== 'edit') return;
  const stateId = world.getNodeIdFromObject(hit?.object);
  const transId = world.getTransitionIdFromObject(hit?.object);

  if (stateId) {
    const s = fsm.states.get(stateId);
    ui.showContextMenu(x, y, [
      { label: '名前変更', action: () => renameNode(stateId) },
      { label: 'アクション編集', action: () => editStateAction(stateId) },
      { label: 'ここからエッジを引く', action: () => startEdge(stateId) },
      { label: fsm.isInitialState(stateId) ? '初期状態から外す' : '初期状態に追加', action: () => fsm.toggleInitialState(stateId) },
      { sep: true },
      { label: `「${s?.name}」を削除`, danger: true, action: () => {
        if (confirm(`「${s?.name}」を削除しますか？`)) fsm.removeState(stateId);
      }},
    ]);
  } else if (transId) {
    const t = fsm.transitions.get(transId);
    ui.showContextMenu(x, y, [
      { label: 'トリガー名変更', action: () => renameTrigger(transId) },
      { sep: true },
      { label: `「${t?.trigger}」を削除`, danger: true, action: () => fsm.removeTransition(transId) },
    ]);
  } else {
    ui.showContextMenu(x, y, [
      { label: 'ここにノードを追加', action: () => {
        const ground = { point: new THREE.Vector3() };
        // approximate from context menu coordinates
        const rect = renderer.domElement.getBoundingClientRect();
        const px = (x - rect.left) / rect.width  * 2 - 1;
        const py = -((y - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(px, py), camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        raycaster.ray.intersectPlane(plane, ground.point);
        createNode(ground.point);
      }},
    ]);
  }
});

// Keyboard
input.on('keydown', ({ key }) => {
  if (key === 'Escape') cancelEdge();
  if (key === 'Delete' || key === 'Backspace') {
    if (mode === 'edit') {
      const sel = world.getSelectedId();
      if (sel) {
        const s = fsm.states.get(sel);
        if (confirm(`「${s?.name}」を削除しますか？`)) fsm.removeState(sel);
      }
    }
  }
});

input.on('xrButtonDown', ({ handedness, index }) => {
  if (mode !== 'edit') return;

  const selectedId = world.getSelectedId();

  if (handedness === 'right' && index === 4) {
    const ground = getGroundPointFromAnyController();
    if (ground?.point) createNodeQuick(ground.point);
    return;
  }

  if (handedness === 'right' && index === 5) {
    cancelEdge();
    setCreateStateArmed(false);
    ui.showToast('選択を解除しました');
    return;
  }

  if (handedness === 'left' && index === 4) {
    if (selectedId) startEdge(selectedId);
    return;
  }

  if (handedness === 'left' && index === 5) {
    if (selectedId) {
      fsm.toggleInitialState(selectedId);
      ui.showToast(fsm.isInitialState(selectedId) ? '初期状態に追加しました' : '初期状態から外しました');
      refreshVrHud();
    }
  }
});

// ============================================================
// UI events
// ============================================================

ui.on('modeChange', m => setMode(m));

ui.on('toggleCreateState', () => {
  if (mode !== 'edit') return;
  setCreateStateArmed(!createStateArmed);
});

ui.on('toggleP2P', async () => {
  if (p2p.enabled) {
    await p2p.disconnect();
    ui.showToast('P2P を切断しました');
    return;
  }
  try {
    await p2p.connect(getSlotId());
    ui.showToast('P2P を開始しました');
  } catch (_) {
    ui.showToast('P2P 接続に失敗しました', 2400);
  }
});

ui.on('fireTrigger', ({ trigger }) => {
  const transition = fsm.getAvailableTransitions().find(t => t.trigger === trigger);
  if (transition) fireTransitionById(transition.id);
});

ui.on('reset', () => {
  cancelActionRun();
  if (mode === 'run') {
    fsm.start();
    ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
  } else {
    fsm.reset();
    refreshActionPanel();
  }
});

ui.on('clear', () => {
  if (!confirm('すべての状態・遷移を削除しますか？')) return;
  cancelEdge();
  for (const id of [...fsm.states.keys()]) fsm.removeState(id);
  ui.showToast('クリアしました');
});

ui.on('export', () => {
  exportFSM();
});

ui.on('importFile', async ({ file }) => {
  await importFSMFile(file);
});

// FSM events → UI update in run mode
fsm.on('activeStatesChanged', ({ prevIds = [], nextIds = [] }) => {
  const prevSet = new Set(prevIds);
  const nextSet = new Set(nextIds);

  for (const stateId of prevIds) {
    if (!nextSet.has(stateId)) {
      _stateActionTokens.delete(stateId);
      _busyActionStates.delete(stateId);
    }
  }

  if (mode === 'run') {
    ui.showTriggerButtons(getTriggerButtonTransitions(), { disabled: areActionsBusy() });
    for (const stateId of nextIds) {
      if (!prevSet.has(stateId)) runStateActions(stateId);
    }
    refreshActionPanel();
  } else {
    refreshActionPanel();
  }
  refreshVrHud();
});

fsm.on('stateActionChanged', ({ id }) => {
  if (mode === 'run' && fsm.isStateActive(id)) {
    refreshActionPanel();
  }
});

// ============================================================
// VR Locomotion — 左スティックで移動
// ============================================================

const _moveDir = new THREE.Vector3();
const _rightDir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const LOCO_SPEED = 3;    // m/s
const TURN_SPEED = 1.5;  // rad/s
const LOCO_DEADZONE = 0.15;

function updateLocomotion(dt) {
  if (!renderer.xr.isPresenting) return;
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const source of session.inputSources) {
    if (!source.gamepad) continue;
    const axes = source.gamepad.axes;
    // Quest: axes[2]=thumbstick X, axes[3]=thumbstick Y
    const stickX = axes[2] ?? 0;
    const stickY = axes[3] ?? 0;
    if (Math.abs(stickX) < LOCO_DEADZONE && Math.abs(stickY) < LOCO_DEADZONE) continue;

    if (source.handedness === 'left') {
      // 左スティック: 前後左右移動
      renderer.xr.getCamera().getWorldDirection(_moveDir);
      _moveDir.y = 0;
      _moveDir.normalize();
      _rightDir.crossVectors(_moveDir, _upVec).normalize();
      playerRig.position.addScaledVector(_moveDir, -stickY * LOCO_SPEED * dt);
      playerRig.position.addScaledVector(_rightDir, stickX * LOCO_SPEED * dt);
    } else if (source.handedness === 'right') {
      // 右スティック左右: 水平回転 (yaw)
      playerRig.rotateY(-stickX * TURN_SPEED * dt);
    }
  }
}

// ============================================================
// Render loop
// ============================================================

let _lastTime = 0;

renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min((time - _lastTime) / 1000, 0.05);
  _lastTime = time;

  input.update(frame);
  updateLocomotion(dt);

  if (!renderer.xr.isPresenting) {
    orbit.update();
  }

  world.update(dt);
  refreshVrHud();
  renderer.render(scene, camera);
});

// ============================================================
// Init
// ============================================================

loadData().then(() => {
  updateAutoNodeCounter();
  refreshVrHud();
});

window.addEventListener('beforeunload', () => {
  p2p.disconnect();
});
