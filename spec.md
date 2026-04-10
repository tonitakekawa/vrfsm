---
name: VRFSM Project
description: Three.js + WebXR でFSMをVR空間で可視化・操作するプロジェクト
type: project
---

VR上でFSMを構築・実行できるWebアプリ。

**Why:** ユーザーがVR空間でノードとエッジを操作してFSMを定義・実行したいという要件。

**How to apply:** Vite + Three.js (素のJS) + WebXR。Vercel でホスティング。

## ファイル構成
- `src/fsm.js` — 純粋なFSMデータモデル（イベントエミッター付き）
- `src/world.js` — Three.js 3D可視化（NodeMesh/EdgeMesh）
- `src/input.js` — マウス/タッチ/VRコントローラー統合入力
- `src/ui.js` — HTML UIオーバーレイ
- `src/main.js` — エントリポイント、全モジュール統合
- `src/label.js` — Canvas texture ベースのテキストラベル

## 起動・デプロイ
- `npm run dev` → localhost:5173
- `npm run build` → dist/ に出力
- Vercel に push すると自動デプロイ

## 操作
- 編集モード: 空白クリック=ノード追加、右クリック=コンテキストメニュー、ドラッグ=ノード移動
- 実行モード: 下部のトリガーボタンで遷移発火
- VR: VRButtonでQuest接続、コントローラーでraycasting操作
