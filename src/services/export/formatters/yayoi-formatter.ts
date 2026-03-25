import { TAX_MODE_LABELS } from '../../../lib/constants'
import type { Session } from '../../../types/domain'
import type { CsvFormatter } from './types'

export const yayoiFormatter: CsvFormatter = {
  buildHeaders() {
    return ['日付', '支払先', '金額', '税区分', '勘定科目', 'メモ']
  },
  buildRows(session: Session) {
    return session.records.map((record) => [
      record.final.date,
      record.final.vendor,
      String(record.final.amount ?? ''),
      TAX_MODE_LABELS[record.final.taxMode],
      record.final.accountCategoryFinal,
      record.final.memo,
    ])
  },
}
