import { TAX_MODE_LABELS } from '../../../lib/constants'
import type { Session } from '../../../types/domain'
import type { CsvFormatter } from './types'

export const freeeFormatter: CsvFormatter = {
  buildHeaders() {
    return ['発生日', '取引先', '金額', '税区分', '勘定科目', '摘要']
  },
  buildRows(session: Session) {
    return session.records.map((record) => [
      record.final.date,
      record.final.vendor,
      String(record.final.amount ?? ''),
      TAX_MODE_LABELS[record.final.taxMode],
      record.final.accountCategoryFinal,
      record.final.summary || record.final.descriptionRaw,
    ])
  },
}
