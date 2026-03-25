import { maybeInvoke } from './tauri'
import { buildExportPreview } from '../services/export/build-export-preview'
import type { CsvPreviewDocument, ExportTarget } from '../types/export'
import type { Session } from '../types/domain'

export async function exportCsv(session: Session, target: ExportTarget): Promise<CsvPreviewDocument> {
  const preview = buildExportPreview(session, target)
  const tauriResult = await maybeInvoke<CsvPreviewDocument>('export_csv', {
    target,
    sessionId: session.id,
    storageRoot: session.settingsSnapshot.storageRoot,
    fileName: preview.fileName,
    csvContent: preview.csvContent,
  })

  if (tauriResult) {
    return tauriResult
  }

  return preview
}
