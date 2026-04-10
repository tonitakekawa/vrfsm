// HTML UI manager

export class UIManager {
  constructor() {
    this._listeners = {};
    this._mode = 'edit';

    this.btnEdit    = document.getElementById('btn-edit');
    this.btnRun     = document.getElementById('btn-run');
    this.btnReset   = document.getElementById('btn-reset');
    this.btnClear   = document.getElementById('btn-clear');
    this.modeHint   = document.getElementById('mode-hint');
    this.triggerPanel = document.getElementById('trigger-panel');
    this.ctxMenu    = document.getElementById('context-menu');
    this.edgeHint   = document.getElementById('edge-preview-hint');
    this.toast      = document.getElementById('toast');
    this.saveInd    = document.getElementById('save-indicator');

    this._dialogOverlay = document.getElementById('dialog-overlay');
    this._dialogTitle   = document.getElementById('dialog-title');
    this._dialogInput   = document.getElementById('dialog-input');
    this._dialogCancel  = document.getElementById('dialog-cancel');
    this._dialogOk      = document.getElementById('dialog-ok');
    this._dialogResolve = null;

    this._bind();
  }

  on(event, cb) {
    (this._listeners[event] = this._listeners[event] || []).push(cb);
  }

  emit(event, data) {
    (this._listeners[event] || []).forEach(f => f(data));
  }

  // ---------- Mode ----------

  setMode(mode) {
    this._mode = mode;
    this.btnEdit.classList.toggle('active', mode === 'edit');
    this.btnRun.classList.toggle('active', mode === 'run');
    this.modeHint.style.display = mode === 'edit' ? '' : 'none';
    if (mode === 'edit') this.hideTriggerButtons();
    this.hideContextMenu();
  }

  getMode() { return this._mode; }

  // ---------- Trigger buttons (run mode) ----------

  showTriggerButtons(transitions) {
    this.triggerPanel.innerHTML = '';
    if (!transitions.length) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:rgba(255,255,255,0.4);font-size:13px;padding:10px';
      msg.textContent = '(遷移なし)';
      this.triggerPanel.appendChild(msg);
      return;
    }
    for (const t of transitions) {
      const btn = document.createElement('button');
      btn.className = 'trigger-btn';
      btn.textContent = t.trigger;
      btn.addEventListener('click', () => {
        this.emit('fireTrigger', { trigger: t.trigger });
      });
      this.triggerPanel.appendChild(btn);
    }
  }

  hideTriggerButtons() {
    this.triggerPanel.innerHTML = '';
  }

  // ---------- Context menu ----------

  showContextMenu(x, y, items) {
    this.ctxMenu.innerHTML = '';
    for (const item of items) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        this.ctxMenu.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'ctx-item' + (item.danger ? ' danger' : '');
      el.textContent = item.label;
      el.addEventListener('click', () => {
        this.hideContextMenu();
        item.action();
      });
      this.ctxMenu.appendChild(el);
    }
    this.ctxMenu.style.display = 'block';
    // Position, keep within viewport
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = 180, h = items.length * 38;
    this.ctxMenu.style.left = Math.min(x, vw - w - 10) + 'px';
    this.ctxMenu.style.top  = Math.min(y, vh - h - 10) + 'px';
  }

  hideContextMenu() {
    this.ctxMenu.style.display = 'none';
  }

  // ---------- Edge drawing hint ----------

  showEdgeHint(fromName) {
    this.edgeHint.textContent = `「${fromName}」からエッジを引いています — 接続先ノードをクリック（Esc でキャンセル）`;
    this.edgeHint.style.display = 'block';
  }

  hideEdgeHint() {
    this.edgeHint.style.display = 'none';
  }

  // ---------- Text input dialog ----------

  showTextInput(title, defaultValue = '') {
    return new Promise(resolve => {
      this._dialogResolve = resolve;
      this._dialogTitle.textContent = title;
      this._dialogInput.value = defaultValue;
      this._dialogOverlay.style.display = 'flex';
      setTimeout(() => {
        this._dialogInput.focus();
        this._dialogInput.select();
      }, 50);
    });
  }

  _resolveDialog(value) {
    this._dialogOverlay.style.display = 'none';
    if (this._dialogResolve) {
      this._dialogResolve(value);
      this._dialogResolve = null;
    }
  }

  // ---------- Toast ----------

  showToast(msg, duration = 1800) {
    this.toast.textContent = msg;
    this.toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { this.toast.style.opacity = '0'; }, duration);
  }

  // ---------- Save indicator ----------

  markSaving() { this.saveInd.textContent = '保存中…'; }
  markSaved()  { this.saveInd.textContent = '保存済み'; }

  // ---------- Bindings ----------

  _bind() {
    this.btnEdit.addEventListener('click', () => this.emit('modeChange', 'edit'));
    this.btnRun.addEventListener('click',  () => this.emit('modeChange', 'run'));
    this.btnReset.addEventListener('click', () => this.emit('reset'));
    this.btnClear.addEventListener('click', () => this.emit('clear'));

    this._dialogOk.addEventListener('click', () => {
      this._resolveDialog(this._dialogInput.value.trim() || null);
    });
    this._dialogCancel.addEventListener('click', () => this._resolveDialog(null));
    this._dialogInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._resolveDialog(this._dialogInput.value.trim() || null);
      if (e.key === 'Escape') this._resolveDialog(null);
    });

    // Close context menu on outside click
    document.addEventListener('mousedown', e => {
      if (!this.ctxMenu.contains(e.target)) this.hideContextMenu();
    });
  }
}
