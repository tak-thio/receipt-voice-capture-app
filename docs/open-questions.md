# Open Questions

このファイルは、実装中に判定が必要になった論点を記録し、暫定仕様と本決定を追跡するために使う。

## 1. OCRエンジン候補
- 未確定事項:
  - MVPで採用するOCRエンジンを何にするか
- 候補:
  - Tesseract
  - PaddleOCR
  - クラウドAPIはMVPでは基本使わない
- 暫定方針:
  - 抽象インターフェースだけ先に作る
  - MVP Phase 0/1 は `MockOcrAdapter` で end-to-end を成立させる
  - 本接続候補は Tesseract / PaddleOCR を比較対象として残し、backend adapter 差し替えで接続可能にする

## 2. STT実行方法
- 未確定事項:
  - faster-whisper を Python sidecar として動かすか、CLI経由にするか
- 暫定方針:
  - local STT の第一候補は Python sidecar とし、Tauri backend から起動・呼び出しできる構成を前提にする
  - 実行境界は backend 側 adapter に寄せ、frontend は API client 経由でのみ扱う
  - MVP初期は browser 録音 + `MockSttAdapter` + `SegmentManager` で、単発文字列ではなくセグメント列または逐次入力を模した形で実装を進める

## 3. 税区分の拡張
- 未確定事項:
  - MVP時点で税込 / 税抜以外をUI候補に出すか
- 暫定方針:
  - 内部値は `inclusive / exclusive / unknown` に固定する
  - UI表示は `税込 / 税抜 / 未指定` にマップする
  - 税区分が音声中で未指定の場合は `unknown` として保持し、warning 判定対象にする

## 4. 摘要の入力位置と推定
- 未確定事項:
  - 音声中の後半トークンをどこまで摘要に割り当てるか
- 暫定方針:
  - MVPは固定順を優先し、余剰トークンは摘要へ寄せる
  - 不確実な場合は warning を付与する

## 5. インボイス番号の音声表現
- 未確定事項:
  - 「T123...」の読み上げ揺れをどう扱うか
- 暫定方針:
  - MVPでは生テキスト保持と簡易正規化に留める
  - OCR候補との照合を重視する

## 6. 会計ソフト別CSV仕様の最終確認
- 未確定事項:
  - freee / 弥生のCSV列構成の最終対応範囲
- 暫定方針:
  - まずは内部共通モデルを作り、formatterで分離する
  - MVPではインポートしやすい最小列構成から着手する
  - Phase 0/1 は出力先ごとの最終列を確定しきらず、共通内部モデルとプレビューを優先する
  - freee / 弥生 / 汎用CSV の差分は formatter 層に閉じ込める

## 7. 画像トリミング
- 未確定事項:
  - MVPで自動切り抜きを入れるか
- 暫定方針:
  - MVPは元フレーム1枚保存のみ
  - 切り抜きはPost-MVP扱い
