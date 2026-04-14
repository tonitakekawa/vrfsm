import * as THREE from 'three';
import { createLabel, updateLabel } from './label.js';

const NODE_RADIUS = 0.28;
const EDGE_RADIUS = 0.018;
const NODE_LABEL_Y = 0.02;
const NODE_LABEL_Z = NODE_RADIUS + 0.16;
const NODE_COLOR       = 0x4a90d9;
const NODE_ACTIVE      = 0x00ff88;
const NODE_SELECTED    = 0xffd700;
const NODE_INITIAL_RING = 0xff9933;
const EDGE_COLOR       = 0x8888aa;
const EDGE_AVAILABLE   = 0x00ff88;

export class World {
  constructor(scene, fsm) {
    this.scene = scene;
    this.fsm = fsm;

    this.nodeMeshes = new Map();   // stateId -> NodeMesh
    this.edgeMeshes = new Map();   // transitionId -> EdgeMesh

    this.interactableNodes = [];   // flat list of THREE.Mesh for raycasting
    this.interactableEdges = [];

    this._mode = 'edit';
    this._selectedId = null;
    this._time = 0;

    this._setupScene();
    this._bindFSM();
  }

  // ---------- Scene setup ----------

  _setupScene() {
    const grid = new THREE.GridHelper(20, 20, 0x222233, 0x111122);
    grid.position.y = -0.3;
    this.scene.add(grid);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    this.scene.add(dir);

    const hemi = new THREE.HemisphereLight(0x2244aa, 0x111133, 0.4);
    this.scene.add(hemi);
  }

  // ---------- FSM bindings ----------

  _bindFSM() {
    this.fsm.on('fsmReplaced', () => {
      this._clearAllMeshes();
      this.sync();
    });
    this.fsm.on('stateAdded', s => this._addNodeMesh(s));
    this.fsm.on('stateRemoved', ({ id }) => this._removeNodeMesh(id));
    this.fsm.on('stateRenamed', ({ id, name }) => {
      const nm = this.nodeMeshes.get(id);
      if (nm) {
        updateLabel(nm.label, name);
        nm.label.position.set(0, NODE_LABEL_Y, NODE_LABEL_Z);
      }
    });
    this.fsm.on('statePositionChanged', ({ id, position }) => {
      const nm = this.nodeMeshes.get(id);
      if (nm) {
        nm.group.position.set(position.x, position.y, position.z);
        this._refreshEdgesForState(id);
      }
    });
    this.fsm.on('initialStatesChanged', ({ ids }) => {
      const initialIds = new Set(ids || []);
      for (const [sid, nm] of this.nodeMeshes) nm.setInitial(initialIds.has(sid));
    });
    this.fsm.on('transitionAdded', t => this._addEdgeMesh(t));
    this.fsm.on('transitionRemoved', ({ id }) => this._removeEdgeMesh(id));
    this.fsm.on('triggerRenamed', ({ id, trigger }) => {
      const em = this.edgeMeshes.get(id);
      if (em) updateLabel(em.label, trigger);
    });
    this.fsm.on('activeStatesChanged', ({ nextIds }) => {
      const activeIds = new Set(nextIds || []);
      for (const [sid, nm] of this.nodeMeshes) nm.setActive(activeIds.has(sid));
      this._refreshEdgeColors();
    });
  }

  // ---------- Sync ----------

  sync() {
    for (const s of this.fsm.states.values()) this._addNodeMesh(s);
    for (const t of this.fsm.transitions.values()) this._addEdgeMesh(t);
    const initialIds = new Set(this.fsm.getInitialStateIds());
    const activeIds = new Set(this.fsm.getActiveStateIds());
    for (const [sid, nm] of this.nodeMeshes) {
      nm.setInitial(initialIds.has(sid));
      nm.setActive(activeIds.has(sid));
    }
  }

  // ---------- Mode ----------

  setMode(mode) {
    this._mode = mode;
    this.clearSelection();
    this._refreshEdgeColors();
  }

  // ---------- Selection ----------

  getSelectedId() { return this._selectedId; }

  selectNode(id) {
    this.clearSelection();
    this._selectedId = id;
    this.nodeMeshes.get(id)?.setSelected(true);
  }

  clearSelection() {
    if (this._selectedId) {
      this.nodeMeshes.get(this._selectedId)?.setSelected(false);
      this._selectedId = null;
    }
  }

  // ---------- Node meshes ----------

  _addNodeMesh(state) {
    if (this.nodeMeshes.has(state.id)) return;
    const nm = new NodeMesh(state, this.scene, NODE_RADIUS);
    this.nodeMeshes.set(state.id, nm);
    this.interactableNodes.push(nm.sphere);
    nm.sphere.userData.stateId = state.id;
    nm.setInitial(this.fsm.isInitialState(state.id));
    nm.setActive(this.fsm.isStateActive(state.id));
  }

  _removeNodeMesh(id) {
    const nm = this.nodeMeshes.get(id);
    if (!nm) return;
    nm.dispose();
    this.nodeMeshes.delete(id);
    const idx = this.interactableNodes.indexOf(nm.sphere);
    if (idx !== -1) this.interactableNodes.splice(idx, 1);
  }

  // ---------- Edge meshes ----------

  _addEdgeMesh(transition) {
    if (this.edgeMeshes.has(transition.id)) return;
    const fromNM = this.nodeMeshes.get(transition.fromId);
    const toNM   = this.nodeMeshes.get(transition.toId);
    if (!fromNM || !toNM) return;

    const em = new EdgeMesh(transition, fromNM.group.position, toNM.group.position, this.scene, NODE_RADIUS);
    this.edgeMeshes.set(transition.id, em);
    this.interactableEdges.push(em.hitPlane);
    em.hitPlane.userData.transitionId = transition.id;
  }

  _removeEdgeMesh(id) {
    const em = this.edgeMeshes.get(id);
    if (!em) return;
    em.dispose();
    this.edgeMeshes.delete(id);
    const idx = this.interactableEdges.indexOf(em.hitPlane);
    if (idx !== -1) this.interactableEdges.splice(idx, 1);
  }

  _refreshEdgesForState(stateId) {
    for (const [tid, em] of this.edgeMeshes) {
      const t = this.fsm.transitions.get(tid);
      if (!t) continue;
      if (t.fromId === stateId || t.toId === stateId) {
        const fromPos = this.nodeMeshes.get(t.fromId)?.group.position;
        const toPos   = this.nodeMeshes.get(t.toId)?.group.position;
        if (fromPos && toPos) em.update(fromPos, toPos);
      }
    }
  }

  _refreshEdgeColors() {
    const available = new Set(this.fsm.getAvailableTransitions().map(t => t.id));
    for (const [tid, em] of this.edgeMeshes) {
      em.setAvailable(this._mode === 'run' && available.has(tid));
    }
  }

  // ---------- Animate ----------

  update(dt) {
    this._time += dt;
    const t = this._time;
    for (const nm of this.nodeMeshes.values()) nm.update(t);
  }

  // ---------- Hit test helpers ----------

  getNodeIdFromObject(obj) {
    return obj?.userData?.stateId || null;
  }

  getTransitionIdFromObject(obj) {
    return obj?.userData?.transitionId || null;
  }

  getNodePosition(id) {
    const nm = this.nodeMeshes.get(id);
    return nm ? nm.group.position.clone() : null;
  }

  setNodePosition(id, pos) {
    this.fsm.moveState(id, { x: pos.x, y: pos.y, z: pos.z });
  }

  _clearAllMeshes() {
    for (const nm of this.nodeMeshes.values()) nm.dispose();
    for (const em of this.edgeMeshes.values()) em.dispose();
    this.nodeMeshes.clear();
    this.edgeMeshes.clear();
    this.interactableNodes.length = 0;
    this.interactableEdges.length = 0;
    this._selectedId = null;
  }
}

// ============================================================
// NodeMesh
// ============================================================
class NodeMesh {
  constructor(state, scene, r) {
    this.scene = scene;
    this.r = r;
    this._active = false;
    this._selected = false;
    this._initial = false;
    this._baseMat = null;

    this.group = new THREE.Group();
    this.group.position.set(state.position.x, state.position.y, state.position.z);

    // Sphere
    const geo = new THREE.SphereGeometry(r, 32, 24);
    const mat = new THREE.MeshStandardMaterial({
      color: NODE_COLOR,
      metalness: 0.15,
      roughness: 0.65,
    });
    this._baseMat = mat;
    this.sphere = new THREE.Mesh(geo, mat);
    this.group.add(this.sphere);

    // Selection ring
    const ringGeo = new THREE.TorusGeometry(r + 0.06, 0.015, 8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: NODE_SELECTED, transparent: true, opacity: 0 });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.group.add(this.ring);

    // Initial state marker (small cone at bottom)
    const coneGeo = new THREE.ConeGeometry(0.07, 0.18, 8);
    const coneMat = new THREE.MeshStandardMaterial({ color: NODE_INITIAL_RING });
    this.initialMarker = new THREE.Mesh(coneGeo, coneMat);
    this.initialMarker.position.y = -(r + 0.12);
    this.initialMarker.rotation.z = Math.PI;
    this.initialMarker.visible = false;
    this.group.add(this.initialMarker);

    // Label
    this.label = createLabel(state.name, {
      color: '#f4f7ff',
      frame: false,
      shadow: true,
    });
    this.label.scale.set(1.45, 0.36, 1);
    this.label.position.set(0, NODE_LABEL_Y, NODE_LABEL_Z);
    this.group.add(this.label);

    scene.add(this.group);
  }

  setActive(v) {
    this._active = v;
    this._baseMat.emissive.setHex(v ? NODE_ACTIVE : 0x000000);
    this._baseMat.emissiveIntensity = v ? 0.5 : 0;
    if (!v) this.group.scale.setScalar(1);
  }

  setSelected(v) {
    this._selected = v;
    this.ring.material.opacity = v ? 1 : 0;
    this._baseMat.color.setHex(v ? NODE_SELECTED : NODE_COLOR);
  }

  setInitial(v) {
    this._initial = v;
    this.initialMarker.visible = v;
  }

  update(t) {
    if (this._active) {
      const s = 1 + 0.05 * Math.sin(t * 3);
      this.group.scale.setScalar(s);
    }
  }

  dispose() {
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}

// ============================================================
// EdgeMesh
// ============================================================
class EdgeMesh {
  constructor(transition, fromPos, toPos, scene, nodeR) {
    this.scene = scene;
    this.nodeR = nodeR;
    this.isSelfLoop = transition.fromId === transition.toId;
    this.group = new THREE.Group();
    scene.add(this.group);

    // Label
    this.label = createLabel(transition.trigger, {
      fontSize: 28,
      scaleX: 1.4,
      scaleY: 0.36,
      color: '#d9e7ff',
      frame: false,
      shadow: true,
    });
    this.label.material.depthTest = false;
    this.group.add(this.label);

    // invisible hit plane (small plane at midpoint)
    const hitGeo = new THREE.PlaneGeometry(0.6, 0.3);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
    this.hitPlane = new THREE.Mesh(hitGeo, hitMat);
    this.group.add(this.hitPlane);

    this._tube = null;
    this._arrow = null;
    this._available = false;
    this.update(fromPos, toPos);
  }

  update(fromPos, toPos) {
    // Remove old geometry
    if (this._tube) { this._tube.geometry.dispose(); this.group.remove(this._tube); }
    if (this._arrow) { this._arrow.geometry.dispose(); this.group.remove(this._arrow); }

    const mat = new THREE.MeshStandardMaterial({
      color: this._available ? EDGE_AVAILABLE : EDGE_COLOR,
      emissive: this._available ? EDGE_AVAILABLE : 0x000000,
      emissiveIntensity: this._available ? 0.4 : 0,
      roughness: 0.5,
      metalness: 0.1,
    });
    this._mat = mat;

    if (this.isSelfLoop) {
      this._buildSelfLoop(fromPos, mat);
    } else {
      this._buildArrow(fromPos, toPos, mat);
    }
  }

  _buildArrow(fromPos, toPos, mat) {
    const from = new THREE.Vector3(fromPos.x, fromPos.y, fromPos.z);
    const to   = new THREE.Vector3(toPos.x, toPos.y, toPos.z);
    const dir  = to.clone().sub(from).normalize();

    // offset so edges don't pierce nodes
    const start = from.clone().addScaledVector(dir, this.nodeR + 0.05);
    const end   = to.clone().addScaledVector(dir, -(this.nodeR + 0.22));

    // Midpoint with slight curve offset
    const mid = start.clone().lerp(end, 0.5);
    const perp = new THREE.Vector3(-dir.z, 0.3, dir.x).normalize().multiplyScalar(0.4);
    const ctrl = mid.clone().add(perp);

    const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
    const points = curve.getPoints(40);

    const tubeGeo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points), 40, EDGE_RADIUS, 6, false
    );
    this._tube = new THREE.Mesh(tubeGeo, mat);
    this.group.add(this._tube);

    // Arrowhead
    const arrowDir = end.clone().sub(points[points.length - 2]).normalize();
    const coneGeo = new THREE.ConeGeometry(0.055, 0.18, 8);
    this._arrow = new THREE.Mesh(coneGeo, mat);
    this._arrow.position.copy(end);
    this._arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir);
    this.group.add(this._arrow);

    // Label + hitPlane at midpoint
    const labelPos = curve.getPointAt(0.5).add(new THREE.Vector3(0, 0.18, 0));
    this.label.position.copy(labelPos);
    this.hitPlane.position.copy(labelPos);
    this.hitPlane.lookAt(labelPos.clone().add(new THREE.Vector3(0, 0, 1)));
  }

  _buildSelfLoop(pos, mat) {
    const center = new THREE.Vector3(pos.x, pos.y, pos.z);
    const r = this.nodeR;
    const liftY = 0.5;
    const extX  = 0.7;

    const p0 = center.clone().add(new THREE.Vector3(r + 0.05, 0, 0));
    const p1 = center.clone().add(new THREE.Vector3(extX, liftY * 1.2, 0));
    const p2 = center.clone().add(new THREE.Vector3(0, liftY * 1.8, 0));
    const p3 = center.clone().add(new THREE.Vector3(-extX, liftY * 1.2, 0));
    const p4 = center.clone().add(new THREE.Vector3(-(r + 0.18), 0.05, 0));

    const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3, p4]);
    const points = curve.getPoints(60);

    const tubeGeo = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points), 60, EDGE_RADIUS, 6, false
    );
    this._tube = new THREE.Mesh(tubeGeo, mat);
    this.group.add(this._tube);

    // Arrowhead
    const last = points[points.length - 1];
    const prev = points[points.length - 3];
    const arrowDir = last.clone().sub(prev).normalize();
    const coneGeo = new THREE.ConeGeometry(0.055, 0.18, 8);
    this._arrow = new THREE.Mesh(coneGeo, mat);
    this._arrow.position.copy(last);
    this._arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowDir);
    this.group.add(this._arrow);

    // Label at loop top
    const labelPos = p2.clone().add(new THREE.Vector3(0, 0.22, 0));
    this.label.position.copy(labelPos);
    this.hitPlane.position.copy(labelPos);
  }

  setAvailable(v) {
    if (this._available === v) return;
    this._available = v;
    if (this._mat) {
      this._mat.color.setHex(v ? EDGE_AVAILABLE : EDGE_COLOR);
      this._mat.emissive.setHex(v ? EDGE_AVAILABLE : 0x000000);
      this._mat.emissiveIntensity = v ? 0.4 : 0;
    }
  }

  dispose() {
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }
}
