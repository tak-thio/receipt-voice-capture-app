import { useAppStore } from '../store/app-store'

/** 設定: 接続先の表示と連携解除のみ(サーバ連携専用)。 */
export function SettingsScreen() {
  const connection = useAppStore((state) => state.connection)!
  const disconnect = useAppStore((state) => state.disconnect)

  return (
    <div className="settings-screen">
      <h1>設定</h1>
      <div className="info-card">
        <div className="info-row"><span>事務所</span><strong>{connection.firmName || '—'}</strong></div>
        <div className="info-row"><span>顧問先</span><strong>{connection.clientName || '—'}</strong></div>
        <div className="info-row">
          <span>利用者</span>
          <strong>{[connection.userName, connection.jobTitle].filter(Boolean).join('・') || '—'}</strong>
        </div>
        <div className="info-row"><span>サーバ</span><strong className="mono">{connection.serverUrl}</strong></div>
      </div>
      <button
        className="danger-button big"
        onClick={() => {
          if (window.confirm('連携を解除しますか?')) disconnect()
        }}
      >
        連携を解除
      </button>
      <p className="muted small">
        解除すると再度QRで連携が必要です。撮影済みのデータはサーバに保存されています。
      </p>
    </div>
  )
}
