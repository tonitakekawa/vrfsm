// HTML UI manager

export class UIManager {
  constructor() {
    this._listeners = {};
    this._mode = 'edit';

    this.btnEdit    = document.getElementById('btn-edit');
    this.btnRun     = document.getElementById('btn-run');
    this.btnAddState = document.getElementById('btn-add-state');
    this.btnP2P     = document.getElementById('btn-p2p');
    this.btnReset   = document.getElementById('btn-reset');
    this.btnClear   = document.getElementById('btn-clear');
    this.btnExport  = document.getElementById('btn-export');
    this.btnImport  = document.getElementById('btn-import');
    this.fileImport = document.getElementById('file-import');
    this.modeHint   = document.getElementById('mode-hint');
    this.triggerPanel = document.getElementById('trigger-panel');
    this.ctxMenu    = document.getElementById('context-menu');
    this.edgeHint   = document.getElementById('edge-preview-hint');
    this.toast      = document.getElementById('toast');
    this.saveInd    = document.getElementById('save-indicator');
    this.p2pInd     = document.getElementById('p2p-indicator');

    this._dialogOverlay = document.getElementById('dialog-overlay');
    this._dialogTitle   = document.getElementById('dialog-title');
    this._dialogInput   = document.getElementById('dialog-input');
    this._dialogTextarea = document.getElementById('dialog-textarea');
    this._dialogCancel  = document.getElementById('dialog-cancel');
    this._dialogOk      = document.getElementById('dialog-ok');
    this._dialogResolve = null;
    this._dialogMode    = 'text';
    this.actionPanel    = document.getElementById('action-panel');
    this.actionPanelName = document.getElementById('action-panel-name');
    this.actionPanelBody = document.getElementById('action-panel-body');
    this._triggerButtons = [];

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

  setCreateStateArmed(armed) {
    this.btnAddState.classList.toggle('active', armed);
    this.modeHint.textContent = armed
      ? '配置したい場所をクリックして新規状態を追加'
      : '新規状態ボタンで追加 / 右クリックでメニュー / ドラッグで移動 / Shift+ドラッグで高さ変更';
  }

  setP2PStatus(status) {
    this.btnP2P.classList.toggle('active', !!status.enabled);
    if (!status.enabled) {
      this.p2pInd.textContent = 'P2P オフ';
      return;
    }
    this.p2pInd.textContent = `P2P ${status.connectedPeers} 接続 / room ${status.roomId}`;
  }

  // ---------- Trigger buttons (run mode) ----------

  showTriggerButtons(transitions, opts = {}) {
    const { disabled = false } = opts;
    this.triggerPanel.innerHTML = '';
    this._triggerButtons = [];
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
      btn.disabled = disabled;
      btn.addEventListener('click', () => {
        this.emit('fireTrigger', { trigger: t.trigger });
      });
      this.triggerPanel.appendChild(btn);
      this._triggerButtons.push(btn);
    }
  }

  hideTriggerButtons() {
    this.triggerPanel.innerHTML = '';
    this._triggerButtons = [];
  }

  setTriggerButtonsDisabled(disabled) {
    this._triggerButtons.forEach(btn => {
      btn.disabled = disabled;
    });
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
      this._dialogMode = 'text';
      this._dialogTitle.textContent = title;
      this._dialogInput.value = defaultValue;
      this._dialogInput.style.display = '';
      this._dialogTextarea.style.display = 'none';
      this._dialogOverlay.style.display = 'flex';
      setTimeout(() => {
        this._dialogInput.focus();
        this._dialogInput.select();
      }, 50);
    });
  }

  showTextAreaInput(title, defaultValue = '') {
    return new Promise(resolve => {
      this._dialogResolve = resolve;
      this._dialogMode = 'textarea';
      this._dialogTitle.textContent = title;
      this._dialogTextarea.value = defaultValue;
      this._dialogInput.style.display = 'none';
      this._dialogTextarea.style.display = 'block';
      this._dialogOverlay.style.display = 'flex';
      setTimeout(() => {
        this._dialogTextarea.focus();
        this._dialogTextarea.select();
      }, 50);
    });
  }

  _resolveDialog(value) {
    this._dialogOverlay.style.display = 'none';
    this._dialogInput.style.display = '';
    this._dialogTextarea.style.display = 'none';
    if (this._dialogResolve) {
      this._dialogResolve(value);
      this._dialogResolve = null;
    }
  }

  showActionPanel(stateName, actionText) {
    this.actionPanelName.textContent = stateName || '';
    this.actionPanelBody.textContent = actionText || 'アクション未設定';
    this.actionPanel.style.display = 'block';
  }

  hideActionPanel() {
    this.actionPanel.style.display = 'none';
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
    this.btnAddState.addEventListener('click', () => this.emit('toggleCreateState'));
    this.btnP2P.addEventListener('click', () => this.emit('toggleP2P'));
    this.btnReset.addEventListener('click', () => this.emit('reset'));
    this.btnClear.addEventListener('click', () => this.emit('clear'));
    this.btnExport.addEventListener('click', () => this.emit('export'));
    this.btnImport.addEventListener('click', () => {
      this.fileImport.value = '';
      this.fileImport.click();
    });
    this.fileImport.addEventListener('change', e => {
      const file = e.target.files?.[0] || null;
      if (file) this.emit('importFile', { file });
    });

    this._dialogOk.addEventListener('click', () => {
      const value = this._dialogMode === 'textarea'
        ? this._dialogTextarea.value.trim()
        : this._dialogInput.value.trim();
      this._resolveDialog(value || null);
    });
    this._dialogCancel.addEventListener('click', () => this._resolveDialog(null));
    this._dialogInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._resolveDialog(this._dialogInput.value.trim() || null);
      if (e.key === 'Escape') this._resolveDialog(null);
    });
    this._dialogTextarea.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        this._resolveDialog(this._dialogTextarea.value.trim() || null);
      }
      if (e.key === 'Escape') this._resolveDialog(null);
    });

    // Close context menu on outside click
    document.addEventListener('mousedown', e => {
      if (!this.ctxMenu.contains(e.target)) this.hideContextMenu();
    });
  }
}
