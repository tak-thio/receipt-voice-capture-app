import type { Session } from '../../../types/domain'
import type { CsvFormatter } from './types'

export const genericFormatter: CsvFormatter = {
  buildHeaders() {
    return [
      'date',
      'vendor',
      'tax_mode',
      'amount',
      'payment_method',
      'description_raw',
      'account_category_candidate',
      'account_category_final',
      'summary',
      'invoice_number',
      'memo',
      'status',
    ]
  },
  buildRows(session: Session) {
    return session.records.map((record) => [
      record.final.date,
      record.final.vendor,
      record.final.taxMode,
      String(record.final.amount ?? ''),
      record.final.paymentMethod,
      record.final.descriptionRaw,
      record.final.accountCategoryCandidate,
      record.final.accountCategoryFinal,
      record.final.summary,
      record.final.invoiceNumber,
      record.final.memo,
      record.review.matchStatus,
    ])
  },
}
