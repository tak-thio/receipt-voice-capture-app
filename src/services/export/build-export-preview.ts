import type { CsvPreviewDocument, ExportTarget } from '../../types/export'
import type { Session } from '../../types/domain'
import { freeeFormatter } from './formatters/freee-formatter'
import { genericFormatter } from './formatters/generic-formatter'
import type { CsvFormatter } from './formatters/types'
import { yayoiFormatter } from './formatters/yayoi-formatter'

function escapeCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replaceAll('"', '""')}"`
  }

  return value
}

function resolveFormatter(target: ExportTarget): CsvFormatter {
  if (target === 'freee') {
    return freeeFormatter
  }

  if (target === 'yayoi') {
    return yayoiFormatter
  }

  return genericFormatter
}

export function buildExportPreview(session: Session, target: ExportTarget): CsvPreviewDocument {
  const formatter = resolveFormatter(target)
  const headers = formatter.buildHeaders()
  const rows = formatter.buildRows(session)
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
