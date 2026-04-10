[未着手]
  → 設計中 (trigger: 開始)

[設計中]
  → 実装中 (trigger: 設計確定)
  → 設計中 (trigger: 仕様変更) ← 自己ループ

[実装中]
  → テスト中 (trigger: ビルド成功)
  → 設計中  (trigger: 設計見直し)

[テスト中]
  → 完了     (trigger: 全テスト通過)
  → 実装中   (trigger: バグ発見)
  → 設計中   (trigger: 仕様崩壊)

[完了]
  → 設計中   (trigger: 機能追加)
  