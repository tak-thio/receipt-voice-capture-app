import { create } from 'zustand'
import { saveCaptureImage } from '../api/capture-api'
import { createSession, loadCurrentSession, saveSession } from '../api/session-api'
import { loadSettings, saveSettings } from '../api/settings-api'
import { DEFAULT_SETTINGS } from '../lib/constants'
import { buildReviewBlock } from '../matching/match-record'
import { parseSpeech } from '../parser/speech-parser'
import { MockOcrAdapter } from '../services/adapters/mock-ocr-adapter'
import { MockSttAdapter } from '../services/adapters/mock-stt-adapter'
import type { SttTranscriptionRequest } from '../services/adapters/stt-adapter'
import { loadDictionaries } from '../services/dictionary-loader'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../services/sample-sequences'
import { SegmentManager } from '../services/stt/segment-manager'
import type { DictionaryBundle } from '../types/dictionaries'
import type {
  CaptureImageMeta,
  ManualEditedField,
  ReceiptRecord,
  Session,
  SttCommittedSegment,
  SttInputEvent,
} from '../types/domain'
import type { AppSettings } from '../types/settings'

type ReviewMode = 'table' | 'detail'

interface CaptureFrameInput {
  imageDataUrl: string
  width: number
  height: number
}

interface SessionStoreState {
  isReady: boolean
  isRecording: boolean
  isProcessing: boolean
  dictionaries: DictionaryBundle | null
  settings: AppSettings
  session: Session | null
  selectedRecordId: string | null
  reviewMode: ReviewMode
  pendingEvents: SttInputEvent[]
  lastTranscriptionSource: string | null
  initialize: () => Promise<void>
  setRecording: (value: boolean) => void
  pushTranscriptEvent: (event: SttInputEvent, captureFrame: CaptureFrameInput) => Promise<void>
  processTranscriptSequence: (events: SttInputEvent[], captureFrame: CaptureFrameInput) => Promise<void>
  transcribeMockInput: (
    request: SttTranscriptionRequest,
    captureFrame: CaptureFrameInput,
  ) => Promise<void>
  setSelectedRecordId: (recordId: string | null) => void
  setReviewMode: (mode: ReviewMode) => void
  updateFinalField: <K extends keyof ReceiptRecord['final']>(
    recordId: string,
    field: K,
    value: ReceiptRecord['final'][K],
  ) => Promise<void>
  deleteRecord: (recordId: string) => Promise<void>
  persistSettings: (settings: AppSettings) => Promise<void>
  startNewSession: () => Promise<void>
}

const sttAdapter = new MockSttAdapter({
  sequences: MOCK_TRANSCRIPT_SEQUENCES,
})
const ocrAdapter = new MockOcrAdapter()
const segmentManager = new SegmentManager()

function buildRecordFromSegment(
  segment: SttCommittedSegment,
  capture: CaptureImageMeta,
  dictionaries: DictionaryBundle,
): Promise<ReceiptRecord> {
  const parsed = parseSpeech({
    rawText: segment.rawText,
    dictionaries,
  })

  const now = new Date().toISOString()
  const finalBlock = {
    ...parsed.fields,
    manualEditedFields: [],
  }

  return ocrAdapter.extractFromImage({ imagePath: capture.imagePath, finalBlock }).then((ocr) => {
    const review = buildReviewBlock(
      finalBlock,
      {
        rawText: ocr.rawText,
        extractedCandidates: ocr.extractedCandidates,
        source: ocr.source,
      },
      parsed.warnings,
    )

    return {
      id: `record-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      imagePath: capture.imagePath,
      capturedAt: capture.capturedAt,
      imageWidth: capture.width,
      imageHeight: capture.height,
      stt: {
        rawText: segment.rawText,
        normalizedText: parsed.normalizedText,
        tokens: parsed.tokens,
        segmentStartMs: segment.segmentStartMs,
        segmentEndMs: segment.segmentEndMs,
        sourceEvents: segment.sourceEvents,
        parsedFields: parsed.fields,
        parserWarnings: parsed.warnings,
      },
      ocr: {
        rawText: ocr.rawText,
        extractedCandidates: ocr.extractedCandidates,
        source: ocr.source,
      },
      final: finalBlock,
      review,
    }
  })
}

async function ensureSession(currentSession: Session | null, settings: AppSettings): Promise<Session> {
  if (currentSession) {
    return currentSession
  }

  return createSession(settings)
}

async function commitSegments(
  segments: SttCommittedSegment[],
  captureFrame: CaptureFrameInput,
  session: Session,
  settings: AppSettings,
  dictionaries: DictionaryBundle,
): Promise<Session> {
  if (!segments.length) {
    return session
  }

  const capture = await saveCaptureImage({
    sessionId: session.id,
    imageDataUrl: captureFrame.imageDataUrl,
    width: captureFrame.width,
    height: captureFrame.height,
    storageRoot: settings.storageRoot,
  })

  const newRecords = await Promise.all(
    segments.map((segment) => buildRecordFromSegment(segment, capture, dictionaries)),
  )

  const nextSession: Session = {
    ...session,
    updatedAt: new Date().toISOString(),
    records: [...session.records, ...newRecords],
  }

  await saveSession(nextSession, settings.storageRoot)
  return nextSession
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  isReady: false,
  isRecording: false,
  isProcessing: false,
  dictionaries: null,
  settings: DEFAULT_SETTINGS,
  session: null,
  selectedRecordId: null,
  reviewMode: 'table',
  pendingEvents: [],
  lastTranscriptionSource: null,
  initialize: async () => {
    const [settings, dictionaries] = await Promise.all([
      loadSettings(),
      loadDictionaries(),
    ])
    const existingSession = await loadCurrentSession(settings.storageRoot)

    const session = existingSession ?? (await createSession(settings))

    set({
      isReady: true,
      settings,
      dictionaries,
      session,
      selectedRecordId: session.records[0]?.id ?? null,
    })
  },
  setRecording: (value) => set({ isRecording: value }),
  pushTranscriptEvent: async (event, captureFrame) => {
    await get().processTranscriptSequence([event], captureFrame)
  },
  processTranscriptSequence: async (events, captureFrame) => {
    const { dictionaries, settings } = get()
    if (!dictionaries) {
      return
    }

    const session = await ensureSession(get().session, settings)
    set({ isProcessing: true })

    const segments = segmentManager.append(events)
    const nextSession = await commitSegments(segments, captureFrame, session, settings, dictionaries)

    set({
      isProcessing: false,
      session: nextSession,
      pendingEvents: segmentManager.snapshot(),
      selectedRecordId: nextSession.records.at(-1)?.id ?? get().selectedRecordId,
    })
  },
  transcribeMockInput: async (request, captureFrame) => {
    const transcription = await sttAdapter.transcribe(request)
    await get().processTranscriptSequence(transcription.events, captureFrame)
    set({ lastTranscriptionSource: transcription.source })
  },
  setSelectedRecordId: (recordId) => set({ selectedRecordId: recordId }),
  setReviewMode: (mode) => set({ reviewMode: mode }),
  updateFinalField: async (recordId, field, value) => {
    const session = get().session
    if (!session) {
      return
    }

    const records = session.records.map((record) => {
      if (record.id !== recordId) {
        return record
      }

      const manualEditedFields = new Set(record.final.manualEditedFields)
      if (field !== 'manualEditedFields') {
        manualEditedFields.add(field as ManualEditedField)
      }

      const nextFinal = {
        ...record.final,
        [field]: value,
        manualEditedFields: Array.from(manualEditedFields),
      }

      return {
        ...record,
        updatedAt: new Date().toISOString(),
        final: nextFinal,
        review: buildReviewBlock(nextFinal, record.ocr, record.stt.parserWarnings),
      }
    })

    const nextSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      records,
    }

    await saveSession(nextSession, session.settingsSnapshot.storageRoot)
    set({ session: nextSession })
  },
  deleteRecord: async (recordId) => {
    const session = get().session
    if (!session) {
      return
    }

    const records = session.records.filter((record) => record.id !== recordId)
    const nextSession: Session = {
      ...session,
      updatedAt: new Date().toISOString(),
      records,
    }

    await saveSession(nextSession, session.settingsSnapshot.storageRoot)
    set({
      session: nextSession,
      selectedRecordId: records[0]?.id ?? null,
    })
  },
  persistSettings: async (settings) => {
    const saved = await saveSettings(settings)
    set((state) => ({
      settings: saved,
      session: state.session
        ? {
            ...state.session,
            settingsSnapshot: saved,
          }
        : null,
    }))
  },
  startNewSession: async () => {
    const nextSession = await createSession(get().settings)
    sttAdapter.reset()
    segmentManager.reset()
    set({
      session: nextSession,
      selectedRecordId: null,
      pendingEvents: [],
      lastTranscriptionSource: null,
    })
  },
}))
