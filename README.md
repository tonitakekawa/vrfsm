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
- **VR / Quest**:
  - Trigger = 選択
  - Grip = ノード移動
  - A = ノード追加
  - B = キャンセル / 選択解除
  - X = 選択ノードからエッジ開始
  - Y = 選択ノードを初期状態に設定
  - Runモードでは緑のエッジをTriggerで実行
  - 左スティック = 移動、右スティック左右 = 旋回
- **URLシェア**: `?id=<uuid>` でFSMを共有可能

###　AI協業:
- Claude (Anthropic)
- GPT(OpenAI)
