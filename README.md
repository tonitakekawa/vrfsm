# VRFSM

Three.js + WebXR でFSMをVR空間で可視化・操作するプロジェクト。

VR上でFSMを構築・実行できるWebアプリ。Cloudflare Pages + KV でホスティング。

## ファイル構成

- `src/fsm.js` — 純粋なFSMデータモデル（イベントエミッター付き）
- `src/world.js` — Three.js 3D可視化（NodeMesh/EdgeMesh）
- `src/input.js` — マウス/タッチ/VRコントローラー統合入力
- `src/ui.js` — HTML UIオーバーレイ
- `src/main.js` — エントリポイント、全モジュール統合
- `src/label.js` — Canvas texture ベースのテキストラベル
- `functions/api/fsm.js` — Cloudflare Pages Function（KV読み書き）

## 起動・デプロイ

```bash
npm run dev          # Vite dev server (localhost:5173)
npm run pages:dev    # Cloudflare Pages ローカル (localhost:8788)
npm run pages:deploy # Cloudflare Pages にデプロイ
```

## 操作

- **編集モード**: 空白クリック=ノード追加、右クリック=コンテキストメニュー、ドラッグ=ノード移動
- **実行モード**: 下部のトリガーボタンで遷移発火
- **VR**: VRButtonでQuest接続、コントローラーでraycasting操作
- **URLシェア**: `?id=<uuid>` でFSMを共有可能

### AI協力: Claude (Anthropic)

