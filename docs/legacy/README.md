# legacy ドキュメント(旧版・歴史参照用)

ここは **SaaS化前 / 端末ローカルAI前提のデスクトップMVP** 時代のドキュメントです。
現行の設計とは合致しません。現行は次を参照:

- 全体: [`../architecture.md`](../architecture.md)
- 詳細設計: [`../saas-design.md`](../saas-design.md)
- モバイル: [`../mobile-checklist.md`](../mobile-checklist.md) / [`../handoff-mac-mobile.md`](../handoff-mac-mobile.md)

> 重要な相違点:
> - 現行は **AIをすべて外部APIで実行**(サーバ機上でモデルは動かさない。Ollama/whisper も
>   別サーバのエンドポイントをAPI呼び出し)。端末で Tesseract / faster-whisper サイドカーを
>   直接動かす旧方式は **廃止**。
> - **Windows デスクトップ版という製品ターゲットは廃止**。現行は web(SaaS)+ mobile(iOS/Android)。
>   ※ Android を Windows 上で「ビルド」することは可能(ビルドホストの話で、製品ターゲットではない)。

| ファイル | 旧内容 |
|---|---|
| `local-stt-setup.md` | 端末ローカルの faster-whisper sidecar 構築手順(廃止) |
| `open-questions.md` | Tesseract / sidecar 等の初期未決事項(解決済) |
| `tasks.md` | デスクトップMVP期のタスク一覧 |
| `requirements.md` | 単体デスクトップツール時代の要件(SaaS設計が後継) |
| `windows-checklist.md` | Windowsデスクトップ版の動作確認手順(製品ターゲット廃止) |
