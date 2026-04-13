import * as THREE from 'three';

const DRAG_THRESHOLD = 5; // px

export class InputManager {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-99, -99);

    this._listeners = {};
    this._interactable = [];

    this._mouseDown = false;
    this._mouseDownPos = { x: 0, y: 0 };
    this._dragging = false;
    this._dragTarget = null;

    this._xrControllers = [];
    this._xrDragState = null;
    this._xrButtonStates = new Map();

    this._bindMouse();
    this._bindTouch();
    this._bindKeyboard();
  }

  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
  }

  emit(event, data) {
    (this._listeners[event] || []).forEach(f => f(data));
  }

  setInteractable(objects) {
    this._interactable = objects;
  }

  addXRController(ctrl) {
    this._xrControllers.push(ctrl);
    ctrl.addEventListener('selectstart', () => {
      const hit = this._raycastFromController(ctrl);
      this.emit('select', { hit, source: 'xr' });
    });
    ctrl.addEventListener('selectend', () => {
      this.emit('selectEnd', { source: 'xr' });
    });
    ctrl.addEventListener('squeezestart', () => {
      const hit = this._raycastFromController(ctrl);
      const target = hit?.object?.userData?.stateId || null;
      this._xrDragState = target ? {
        controller: ctrl,
        target,
        startControllerPos: new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld),
      } : null;
      this.emit('gripStart', { hit, source: 'xr' });
    });
    ctrl.addEventListener('squeezeend', () => {
      if (this._xrDragState?.controller === ctrl) {
        this._xrDragState = null;
        this.emit('dragEnd', { source: 'xr' });
      }
      this.emit('gripEnd', { source: 'xr' });
    });
  }

  update(frame) {
    // Per-frame XR hover
    if (this.renderer.xr.isPresenting) {
      for (const ctrl of this._xrControllers) {
        const hit = this._raycastFromController(ctrl);
        this.emit('hover', { hit, source: 'xr' });
        if (this._xrDragState?.controller === ctrl) {
          const ground = this._raycastGroundFromController(ctrl);
          const controllerPos = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
          const controllerDelta = controllerPos.clone().sub(this._xrDragState.startControllerPos);
          this.emit('drag', {
            hit: ground,
            target: this._xrDragState.target,
            source: 'xr',
            controllerDelta,
          });
        }
      }

      const session = this.renderer.xr.getSession();
      if (session) {
        for (const source of session.inputSources) {
          if (!source.gamepad) continue;
          this._updateXRButtons(source);
        }
      }
    }
  }

  // ---------- Mouse ----------

  _bindMouse() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousemove', e => {
      this._updatePointer(e.clientX, e.clientY);
      if (this._mouseDown && this._dragTarget) {
        const dx = e.clientX - this._mouseDownPos.x;
        const dy = e.clientY - this._mouseDownPos.y;
        if (!this._dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
          this._dragging = true;
        }
        if (this._dragging) {
          const hit = this._raycastGround();
          this.emit('drag', {
            hit,
            target: this._dragTarget,
            source: 'mouse',
            shiftKey: e.shiftKey,
            deltaX: dx,
            deltaY: dy,
          });
        }
      } else {
        const hit = this._raycast();
        this.emit('hover', { hit, source: 'mouse' });
      }
    });

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      this._updatePointer(e.clientX, e.clientY);
      this._mouseDown = true;
      this._mouseDownPos = { x: e.clientX, y: e.clientY };
      this._dragging = false;
      const hit = this._raycast();
      this._dragTarget = hit?.object?.userData?.stateId || null;
    });

    canvas.addEventListener('mouseup', e => {
      if (e.button !== 0) return;
      if (!this._dragging) {
        const hit = this._raycast();
        if (hit) {
          this.emit('select', { hit, source: 'mouse' });
        } else {
          const ground = this._raycastGround();
          this.emit('miss', { hit: ground, source: 'mouse' });
        }
      } else {
        this.emit('dragEnd', { source: 'mouse' });
      }
      this._mouseDown = false;
      this._dragging = false;
      this._dragTarget = null;
    });

    canvas.addEventListener('contextmenu', e => {
      e.preventDefault();
      this._updatePointer(e.clientX, e.clientY);
      const hit = this._raycast();
      this.emit('contextmenu', { hit, x: e.clientX, y: e.clientY, source: 'mouse' });
    });
  }

  // ---------- Touch ----------

  _bindTouch() {
    const canvas = this.renderer.domElement;
    let _touchStart = null;

    canvas.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      _touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
      this._updatePointer(t.clientX, t.clientY);
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
      e.preventDefault();
      if (!_touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - _touchStart.x;
      const dy = t.clientY - _touchStart.y;
      const dt = Date.now() - _touchStart.time;
      if (Math.hypot(dx, dy) < 10 && dt < 400) {
        this._updatePointer(t.clientX, t.clientY);
        const hit = this._raycast();
        if (hit) {
          this.emit('select', { hit, source: 'touch' });
        } else {
          const ground = this._raycastGround();
          this.emit('miss', { hit: ground, source: 'touch' });
        }
      }
      _touchStart = null;
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._updatePointer(t.clientX, t.clientY);
      }
    }, { passive: true });
  }

  // ---------- Keyboard ----------

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      this.emit('keydown', { key: e.key, code: e.code });
    });
  }

  // ---------- Raycasting ----------

  _updatePointer(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x =  (clientX - rect.left) / rect.width  * 2 - 1;
    this.pointer.y = -((clientY - rect.top)  / rect.height) * 2 + 1;
  }

  _raycast() {
    if (!this._interactable.length) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this._interactable, false);
    return hits.length ? hits[0] : null;
  }

  // Ground plane (y=0)
  _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  _groundTarget = new THREE.Vector3();

  _raycastGround() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ok = this.raycaster.ray.intersectPlane(this._groundPlane, this._groundTarget);
    return ok ? { point: this._groundTarget.clone() } : null;
  }

  _raycastFromController(ctrl) {
    if (!this._interactable.length) return null;
    const mat = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(mat);
    const hits = this.raycaster.intersectObjects(this._interactable, false);
    return hits.length ? hits[0] : null;
  }

  _raycastGroundFromController(ctrl) {
    const mat = new THREE.Matrix4().extractRotation(ctrl.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(mat);
    const ok = this.raycaster.ray.intersectPlane(this._groundPlane, this._groundTarget);
    return ok ? { point: this._groundTarget.clone() } : null;
  }

  _updateXRButtons(source) {
    const handedness = source.handedness || 'unknown';
    const prev = this._xrButtonStates.get(handedness) || [];
    const next = source.gamepad.buttons.map(btn => btn.pressed);

    next.forEach((pressed, index) => {
      if (pressed && !prev[index]) {
        this.emit('xrButtonDown', { handedness, index, source: 'xr' });
      }
    });

    this._xrButtonStates.set(handedness, next);
  }
}
