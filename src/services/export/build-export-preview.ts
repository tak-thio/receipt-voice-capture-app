import { TAX_MODE_LABELS } from '../../lib/constants'
import type { CsvPreviewDocument, ExportTarget } from '../../types/export'
import type { Session } from '../../types/domain'

function escapeCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function buildHeaders(target: ExportTarget): string[] {
  if (target === 'freee') {
    return ['発生日', '取引先', '金額', '税区分', '勘定科目', '摘要']
  }

  if (target === 'yayoi') {
    return ['日付', '支払先', '金額', '税区分', '勘定科目', 'メモ']
  }

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
}

function buildRows(session: Session, target: ExportTarget): string[][] {
  return session.records.map((record) => {
    const taxModeLabel = TAX_MODE_LABELS[record.final.taxMode]

    if (target === 'freee') {
      return [
        record.final.date,
        record.final.vendor,
        String(record.final.amount ?? ''),
        taxModeLabel,
        record.final.accountCategoryFinal,
        record.final.summary || record.final.descriptionRaw,
      ]
    }

    if (target === 'yayoi') {
      return [
        record.final.date,
        record.final.vendor,
        String(record.final.amount ?? ''),
        taxModeLabel,
        record.final.accountCategoryFinal,
        record.final.memo,
      ]
    }

    return [
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
    ]
  })
}

export function buildExportPreview(session: Session, target: ExportTarget): CsvPreviewDocument {
  const headers = buildHeaders(target)
  const rows = buildRows(session, target)
  const csvLines = [headers, ...rows].map((row) => row.map((cell) => escapeCell(cell)).join(','))
  const today = new Date().toISOString().slice(0, 10)

  return {
    target,
    fileName: `${target}_${today}.csv`,
    headers,
    rows,
    csvContent: `${csvLines.join('\n')}\n`,
  }
}
