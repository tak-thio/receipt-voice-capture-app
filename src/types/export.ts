export type ExportTarget = 'freee' | 'yayoi' | 'generic'

export interface ExportRow {
  date: string
  vendor: string
  taxModeLabel: string
  amount: string
  paymentMethod: string
  descriptionRaw: string
  accountCategoryCandidate: string
  accountCategoryFinal: string
  summary: string
  invoiceNumber: string
  memo: string
  status: string
}

export interface CsvPreviewDocument {
  target: ExportTarget
  fileName: string
  headers: string[]
  rows: string[][]
  csvContent: string
  savedTo?: string
}
