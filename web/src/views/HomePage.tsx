import { Icon } from '../ui'
import type { IconComponent } from '../ui/icons'

const stats = [
  { value: '3', label: '取り込み経路', detail: 'スマホ・メール・手動アップロード' },
  { value: '6', label: '役割別権限', detail: '事務所から一般社員まで制御' },
  { value: 'CSV', label: '会計ソフト出力', detail: 'freee・弥生・汎用形式に対応' },
]

const intake = [
  {
    title: 'スマホで撮影',
    text: '領収書をかざして撮影し、用途は音声メモで補足。外出先の経費登録をその場で終えられます。',
    icon: Icon.Phone,
  },
  {
    title: 'Gmailから自動取り込み',
    text: '顧問先のメールに届く領収書や請求書を、添付・本文から取り込みます。',
    icon: Icon.Mail,
  },
  {
    title: 'PCからアップロード',
    text: '画像やPDFをドラッグ&ドロップで投入。紙、メール、既存ファイルを同じ受信箱で扱えます。',
    icon: Icon.Upload,
  },
]

const features = [
  {
    title: 'AI読み取りと仕訳提案',
    text: '日付、支払先、金額、消費税内訳、インボイス番号、摘要を抽出し、勘定科目や取引先を提案します。',
  },
  {
    title: '修正を学習するマスタ',
    text: '取引先・勘定科目・摘要の修正履歴を顧問先ごとに反映し、次回以降の候補精度を高めます。',
  },
  {
    title: 'カード明細との突き合わせ',
    text: 'クレジットカード明細と領収書を日付・金額で照合し、二重計上の確認を支援します。',
  },
  {
    title: '確認から出力まで一気通貫',
    text: '受信箱、仕訳、元帳、エクスポートをPCで確認。freee、弥生、汎用CSVへ出力できます。',
  },
]

const roles = [
  'システム管理者',
  '会計事務所管理者',
  '会計事務所担当者',
  '顧問先管理者',
  '顧問先経理担当者',
  '顧問先一般社員',
]

export function HomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-slate-950/78 text-white backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2 font-bold" aria-label="領収ボックス ホーム">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-500 text-xl text-white shadow-sm">
              <Icon.Receipt />
            </span>
            <span>領収ボックス</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm text-slate-200 md:flex">
            <a className="hover:text-white" href="#workflow">流れ</a>
            <a className="hover:text-white" href="#features">機能</a>
            <a className="hover:text-white" href="#security">運用</a>
          </nav>
          <a
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-white/30 px-3.5 text-sm font-medium text-white transition hover:bg-white hover:text-slate-950"
          >
            ログイン
          </a>
        </div>
      </header>

      <main>
        <section className="relative flex min-h-[88svh] items-start overflow-hidden bg-slate-950 pt-16 text-white sm:items-center">
          <img
            src="/landing-hero.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-[58%_center] opacity-80 sm:object-center sm:opacity-72"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.68),rgba(15,23,42,0.88)_36%,rgba(15,23,42,0.72)_72%,rgba(15,23,42,0.22))] sm:bg-[linear-gradient(90deg,rgba(2,6,23,0.92),rgba(15,23,42,0.74)_42%,rgba(15,23,42,0.2)_78%)]" />
          <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white to-transparent" />

          <div className="relative mx-auto w-full max-w-7xl px-4 py-20 sm:px-6 sm:py-16 lg:px-8">
            <div className="max-w-3xl">
              <p className="mb-5 inline-flex items-center rounded-full border border-emerald-300/40 bg-emerald-400/12 px-3 py-1 text-sm font-medium text-emerald-100">
                税理士事務所と顧問先をつなぐ領収書クラウド
              </p>
              <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-normal sm:text-5xl lg:text-6xl">
                領収ボックス
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-100 [overflow-wrap:anywhere] sm:text-xl">
                スマホ・メール・アップロードから領収書を集め、AIが読み取り、仕訳候補から会計ソフト出力までを整理する会計事務所向けシステムです。
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#workflow"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-emerald-500 px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-400"
                >
                  できることを見る
                </a>
                <a
                  href="/login"
                  className="inline-flex h-11 items-center justify-center rounded-lg border border-white/35 bg-white/8 px-5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white hover:text-slate-950"
                >
                  管理画面へ
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="-mt-6 bg-white pb-12">
          <div className="relative mx-auto grid max-w-7xl gap-3 px-4 sm:grid-cols-3 sm:px-6 lg:px-8">
            {stats.map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
                <div className="text-3xl font-bold text-slate-950">{item.value}</div>
                <div className="mt-1 font-semibold text-slate-800">{item.label}</div>
                <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="workflow" className="bg-slate-50 py-16 sm:py-20">
          <SectionHeading
            eyebrow="Workflow"
            title="取り込みから確認まで、入口をひとつに"
            text="顧問先が登録しやすい方法で集め、事務所はPCでまとめて確認できます。"
          />
          <div className="mx-auto mt-10 grid max-w-7xl gap-4 px-4 sm:px-6 md:grid-cols-3 lg:px-8">
            {intake.map((item, index) => (
              <FeatureCard key={item.title} icon={item.icon} title={item.title} text={item.text} index={index + 1} />
            ))}
          </div>
        </section>

        <section id="features" className="bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700">AI & Accounting</p>
              <h2 className="mt-3 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">
                読み取り、仕訳、突き合わせを日々の業務に合わせる
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                AIの抽出結果をそのまま確定するのではなく、事務所や顧問先のマスタ、修正履歴、承認フローを通して確認できます。
              </p>
              <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-pop">
                <div className="border-b border-white/10 px-5 py-4 text-sm font-semibold">処理レーン</div>
                <div className="divide-y divide-white/10">
                  {['受信', 'AI抽出', '仕訳確認', '突き合わせ', 'CSV出力'].map((step, index) => (
                    <div key={step} className="flex items-center gap-3 px-5 py-3">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-400/18 text-xs font-bold text-emerald-200">
                        {index + 1}
                      </span>
                      <span className="text-sm text-slate-100">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {features.map((item) => (
                <article key={item.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
                  <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg bg-amber-100 text-amber-700">
                    <Icon.Check />
                  </div>
                  <h3 className="font-bold text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="security" className="bg-slate-950 py-16 text-white sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1fr] lg:px-8">
            <div>
              <p className="text-sm font-semibold uppercase tracking-normal text-emerald-300">Operations</p>
              <h2 className="mt-3 text-3xl font-bold tracking-normal sm:text-4xl">
                事務所単位で管理し、データは階層ごとに分離
              </h2>
              <p className="mt-4 text-base leading-7 text-slate-300">
                税理士事務所、顧問先、担当者、一般社員の境界を前提にした権限設計。データベースの行単位アクセス制御でテナント分離を強制します。
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {roles.map((role) => (
                <div key={role} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/6 px-4 py-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-400/14 text-emerald-200">
                    <Icon.User />
                  </span>
                  <span className="text-sm font-medium text-slate-100">{role}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
      <p className="text-sm font-semibold uppercase tracking-normal text-emerald-700">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold tracking-normal text-slate-950 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-600">{text}</p>
    </div>
  )
}

function FeatureCard({
  icon: CardIcon,
  title,
  text,
  index,
}: {
  icon: IconComponent
  title: string
  text: string
  index: number
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-100 text-2xl text-emerald-700">
          <CardIcon />
        </div>
        <span className="text-sm font-bold text-slate-300">{String(index).padStart(2, '0')}</span>
      </div>
      <h3 className="mt-5 font-bold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </article>
  )
}
