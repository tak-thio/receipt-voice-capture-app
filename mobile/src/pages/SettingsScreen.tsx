import { useState } from 'react'
import { deleteIndividualAccount } from '../api/server-api'
import { useAppStore } from '../store/app-store'

const PLAN_LABEL: Record<string, string> = {
  free: '無料プラン（月30枚）',
  pro: 'サブスク（月500枚）',
  business: '会社プラン',
}

/** 設定: 接続情報の表示・ログアウト/連携解除・(個人は)退会。 */
export function SettingsScreen() {
  const connection = useAppStore((state) => state.connection)!
  const disconnect = useAppStore((state) => state.disconnect)
  const showToast = useAppStore((state) => state.showToast)
  const individual = !!connection.individual
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!window.confirm('アカウントとデータを完全に削除します。元に戻せません。よろしいですか?')) return
    setBusy(true)
    try {
      await deleteIndividualAccount(connection.serverUrl, connection.deviceToken)
      showToast('アカウントを削除しました')
      disconnect()
    } catch (e) {
      showToast(e instanceof Error ? e.message : '退会に失敗しました')
      setBusy(false)
    }
  }

  return (
    <div className="settings-screen">
      <h1>設定</h1>
      <div className="info-card">
        {individual ? (
          <>
            <div className="info-row"><span>プラン</span><strong>{PLAN_LABEL[connection.plan ?? 'free'] ?? connection.plan}</strong></div>
            <div className="info-row"><span>アカウント</span><strong>{connection.userName || '—'}</strong></div>
          </>
        ) : (
          <>
            <div className="info-row"><span>事務所</span><strong>{connection.firmName || '—'}</strong></div>
            <div className="info-row"><span>顧問先</span><strong>{connection.clientName || '—'}</strong></div>
            <div className="info-row">
              <span>利用者</span>
              <strong>{[connection.userName, connection.jobTitle].filter(Boolean).join('・') || '—'}</strong>
            </div>
          </>
        )}
        <div className="info-row"><span>サーバ</span><strong className="mono">{connection.serverUrl}</strong></div>
      </div>

      <button
        className="danger-button big"
        disabled={busy}
        onClick={() => {
          if (window.confirm(individual ? 'ログアウトしますか?' : '連携を解除しますか?')) disconnect()
        }}
      >
        {individual ? 'ログアウト' : '連携を解除'}
      </button>
      <p className="muted small">
        {individual
          ? 'ログアウトしても、同じメール/パスワードで再ログインできます。データはサーバに保存されています。'
          : '解除すると再度QRで連携が必要です。撮影済みのデータはサーバに保存されています。'}
      </p>

      {individual && (
        <>
          <button className="detail-delete-link" disabled={busy} onClick={() => void remove()}>
            {busy ? '退会処理中…' : '退会（アカウントとデータを削除）'}
          </button>
          <p className="muted small">退会するとアカウントと取り込んだデータがすべて削除され、元に戻せません。</p>
        </>
      )}
    </div>
  )
}
