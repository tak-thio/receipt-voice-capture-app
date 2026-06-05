import type { Session, TaxMode } from '../../../types/domain'
import type { CsvFormatter } from './types'

const MAS_HEADERS = [
  '伝票日付',
  '内部月',
  '伝票ＮＯ',
  '証憑ＮＯ',
  'データ種別',
  '仕訳入力形式',
  '(借方)勘定科目コード',
  '(借方)科目別補助コード',
  '(借方)部門コード',
  '(借方)セグメント１コード',
  '(借方)消費税売上/仕入区分',
  '(借方)業種コード',
  '(借方)税込/税抜区分',
  '(借方)第１補助区分',
  '(借方)第１補助コード',
  '(借方)第２補助区分',
  '(借方)第２補助コード',
  '(貸方)勘定科目コード',
  '(貸方)科目別補助コード',
  '(貸方)部門コード',
  '(貸方)セグメント１コード',
  '(貸方)消費税売上/仕入区分',
  '(貸方)業種コード',
  '(貸方)税込/税抜区分',
  '(貸方)第１補助区分',
  '(貸方)第１補助コード',
  '(貸方)第２補助区分',
  '(貸方)第２補助コード',
  '金額(入力金額)',
  '消費税額',
  '消費税コード',
  '消費税率',
  '外税同時入力区分',
  '資金繰入力区分',
  '資金繰コード',
  '摘要',
  '固定摘要コード１',
  '固定摘要コード２',
  '固定摘要コード３',
  '固定摘要コード４',
  '固定摘要コード５',
  '期日',
  '付箋区分',
  '付箋コメント',
] as const

function taxModeToMasValue(taxMode: TaxMode): string {
  if (taxMode === 'inclusive') {
    return '1'
  }

  if (taxMode === 'exclusive') {
    return '0'
  }

  return ''
}

function buildDescription(record: Session['records'][number]): string {
  const detail = record.final.summary || record.final.descriptionRaw
  const shouldIncludeVendor = record.final.vendor && !detail.includes(record.final.vendor)

  return [
    shouldIncludeVendor ? record.final.vendor : '',
    detail,
    record.final.invoiceNumber,
    record.final.memo,
  ]
    .filter(Boolean)
    .join(' ')
}

export const masFormatter: CsvFormatter = {
  buildHeaders() {
    return [...MAS_HEADERS]
  },
  buildRows(session: Session) {
    return session.records.map((record) => {
      const row = Array.from<string>({ length: MAS_HEADERS.length }).fill('')
      const taxModeValue = taxModeToMasValue(record.final.taxMode)

      row[0] = record.final.date
      row[12] = taxModeValue
      row[23] = taxModeValue
      row[28] = String(record.final.amount ?? '')
      row[35] = buildDescription(record)

      return row
    })
  },
}
