import { useEffect, useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ApiError, deleteIndividualAccount, driveConnectUrl, driveExport, driveStatus, individualClaim,
  updateIndividualName,
} from '../api/server-api'
import { toUserMessage } from '../lib/errors'
import { isBillingAvailable, upgradeToPro } from '../services/billing/native-billing'
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
  const setConnection = useAppStore((state) => state.setConnection)
  const setAuthPrompt = useAppStore((state) => state.setAuthPrompt)
  const showToast = useAppStore((state) => state.showToast)
  const individual = !!connection.individual
  const plan = connection.plan ?? 'free'
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [driveConnected, setDriveConnected] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  // 連携済みか確認(個人のみ。Drive エクスポートの出し分け用)。
  useEffect(() => {
    if (!individual) return
    driveStatus(connection.serverUrl, connection.deviceToken)
      .then((s) => setDriveConnected(s.connected))
      .catch((e) => console.error('[drive.status]', e)) // 非致命: 未連携扱いで続行(ログだけ残す)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 匿名アカウントにメール/パスワードを登録(遅延サインアップ)。device token はそのまま使い続ける。
  async function register() {
    if (!email || password.length < 8) {
      showToast('メールアドレスと8文字以上のパスワードを入力してください')
      return
    }
    setBusy(true)
    try {
      const r = await individualClaim(connection.serverUrl, connection.deviceToken, { email, password })
      setConnection({ ...connection, email: r.email, userName: r.user_name || connection.userName })
      showToast('メールアドレスを登録しました。別の端末でもログインできます。')
    } catch (e) {
      showToast(toUserMessage(e, '登録に失敗しました', 'individual.claim'))
    } finally {
      setBusy(false)
    }
  }

  // 購入 → サーバ検証 → pro 付与。成功すれば接続情報の plan を更新(メーターも 500 枚に)。
  async function upgrade() {
    if (!connection.email) {
      showToast('サブスクのご登録情報を保持するため、先にメールアドレスの登録（無料）をお願いします🙏 機種変更・再インストールでも引き継げます。')
      return
    }
    setBusy(true)
    try {
      const r = await upgradeToPro(connection.serverUrl, connection.deviceToken)
      if (r.active) {
        setConnection({ ...connection, plan: r.plan })
        showToast('サブスクを開始しました。今月から月500枚まで解析できます。')
      } else {
        showToast('購入を確認しています。反映まで少しお待ちください。')
      }
    } catch (e) {
      showToast(toUserMessage(e, 'アップグレードに失敗しました', 'billing.verify'))
    } finally {
      setBusy(false)
    }
  }

  // 表示名を変更する(匿名/登録済みどちらでも可)。
  async function saveName() {
    const name = nameInput.trim()
    if (!name) { showToast('名前を入力してください'); return }
    setBusy(true)
    try {
      const r = await updateIndividualName(connection.serverUrl, connection.deviceToken, name)
      setConnection({ ...connection, userName: r.user_name })
      setEditingName(false)
      showToast('名前を変更しました')
    } catch (e) {
      showToast(toUserMessage(e, '名前の変更に失敗しました', 'individual.profile'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('退会すると、取り込んだ領収書データはすべて削除され、Pro サブスクをご契約中の場合は自動的に解約されます。元に戻せません。退会しますか？')) return
    setBusy(true)
    try {
      await deleteIndividualAccount(connection.serverUrl, connection.deviceToken)
      showToast('アカウントを削除しました')
      disconnect()
    } catch (e) {
      showToast(toUserMessage(e, '退会に失敗しました', 'account.delete'))
      setBusy(false)
    }
  }

  // Drive 連携(ブラウザで同意 → サーバがトークン保存)。
  async function connectDrive() {
    try {
      const { auth_url } = await driveConnectUrl(connection.serverUrl, connection.deviceToken)
      await openUrl(auth_url)
      showToast('ブラウザで連携を許可したら、アプリに戻って「Google ドライブにエクスポート」を押してください。')
    } catch (e) {
      showToast(toUserMessage(e, '連携の開始に失敗しました', 'drive.connect'))
    }
  }

  // 全領収書(CSV)を本人の Drive へ書き出す。
  async function exportDrive() {
    setBusy(true)
    try {
      const r = await driveExport(connection.serverUrl, connection.deviceToken)
      setDriveConnected(true)
      showToast(`${r.count}件の領収書を Google ドライブに書き出しました。`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // 未連携(トークン失効/未接続)。連携ボタンに戻して案内する。
        setDriveConnected(false)
        showToast('Google ドライブと未連携です。先に「Google ドライブと連携」を行ってください。')
      } else {
        showToast(toUserMessage(e, 'エクスポートに失敗しました', 'drive.export'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-screen">
      <h1>設定</h1>
      <div className="info-card">
        {individual ? (
          <>
            {plan === 'free' && isBillingAvailable() ? (
              <button type="button" className="info-row plan-upgrade" disabled={busy} onClick={() => void upgrade()}>
                <span>プラン</span>
                <strong>{PLAN_LABEL.free}<span className="plan-cta">アップグレード ›</span></strong>
              </button>
            ) : (
              <div className="info-row"><span>プラン</span><strong>{PLAN_LABEL[connection.plan ?? 'free'] ?? connection.plan}</strong></div>
            )}
            <button type="button" className="info-row plan-upgrade" disabled={busy}
              onClick={() => { setNameInput(connection.userName || ''); setEditingName(true) }}>
              <span>名前</span>
              <strong>{connection.userName || '—'}<span className="plan-cta">編集 ›</span></strong>
            </button>
            <div className="info-row"><span>メール</span><strong>{connection.email || '未登録'}</strong></div>
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
        <div className="info-row"><span>バージョン</span><strong>v{__APP_VERSION__}</strong></div>
      </div>

      {individual && editingName && (
        <div className="info-card">
          <label className="field"><span>名前</span>
            <input value={nameInput} maxLength={50} autoFocus
              onChange={(e) => setNameInput(e.target.value)} placeholder="お名前" /></label>
          <button className="accent-button big" disabled={busy} onClick={() => void saveName()}>
            {busy ? '保存中…' : '保存'}
          </button>
          <button className="ghost-button" disabled={busy} onClick={() => setEditingName(false)}>キャンセル</button>
        </div>
      )}

      {individual && !connection.email && (
        <div className="info-card">
          <div className="info-row"><strong>メールアドレスを登録</strong></div>
          <p className="muted small">
            登録すると、機種変更・再インストールでもデータを引き継げます。サブスクのご利用にも必要です。
          </p>
          <label className="field"><span>メールアドレス</span>
            <input type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></label>
          <label className="field"><span>パスワード(8文字以上)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <button className="accent-button big" disabled={busy} onClick={() => void register()}>
            {busy ? '登録中…' : 'メールアドレスを登録'}
          </button>
        </div>
      )}

      {individual && plan === 'free' && isBillingAvailable() && (
        <p className="muted small">
          無料プランは月30枚まで。上の「プラン」からアップグレードすると月500枚まで解析できます（¥3,000/月・税込）。お支払い・解約は Google Play で管理されます。
        </p>
      )}

      {individual && (
        <>
          <button
            className="primary-button big"
            disabled={busy}
            onClick={() => void (driveConnected ? exportDrive() : connectDrive())}
          >
            {driveConnected ? 'Google ドライブにエクスポート' : 'Google ドライブと連携'}
          </button>
          <p className="muted small">
            領収書データ(CSV)を自分の Google ドライブに書き出します。
            {!driveConnected && ' 初回はブラウザで連携を許可してください。'}
          </p>
        </>
      )}

      {individual && !connection.email && (
        <button className="ghost-button" disabled={busy} onClick={() => setAuthPrompt('login')}>
          別のアカウントでログイン（機種変更・復元）
        </button>
      )}

      {(!individual || connection.email) && (
        <>
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
        </>
      )}

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
