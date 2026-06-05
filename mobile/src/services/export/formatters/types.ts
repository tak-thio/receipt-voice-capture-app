import type { Session } from '../../../types/domain'

export interface CsvFormatter {
  buildHeaders(): string[]
  buildRows(session: Session): string[][]
}
