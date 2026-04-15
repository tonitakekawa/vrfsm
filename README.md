# VRFSM
- FSMを編集して実行するアプリ。
- 例)３分待つ→ラーメンできたよ、等

## ホスティング
- Cloudflare Pages
- KV

## ライブラリ
- Three.js
- WebXR

## ファイル構成

| ファイル | 説明 |
|----------|------|
| `src/fsm.js` | 純粋なFSMデータモデル（イベントエミッター付き） |
| `src/world.js` | Three.js 3D可視化（NodeMesh/EdgeMesh） |
| `src/input.js` | マウス/タッチ/VRコントローラー統合入力 |
| `src/ui.js` | HTML UIオーバーレイ |
| `src/main.js` | エントリポイント、全モジュール統合 |
| `src/label.js` | Canvas texture ベースのテキストラベル |
| `functions/api/fsm.js` | Cloudflare Pages Function（KV読み書き） |

## 起動・デプロイ

```bash
# Vite dev server (localhost:5173)
npm run dev          

# Cloudflare Pages ローカル (localhost:8788)
npm run pages:dev

# Cloudflare Pages にデプロイ
npm run pages:deploy
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

## 協業AI
- Claude (Anthropic)
- GPT(OpenAI)
