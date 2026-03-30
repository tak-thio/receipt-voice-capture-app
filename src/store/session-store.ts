import { saveAudioClip } from '../api/audio-api'
import { create } from 'zustand'
import { saveCaptureImage } from '../api/capture-api'
import {
  createSession,
  listSessions,
  loadCurrentSession,
  loadLatestSession,
  loadSession,
  saveSession,
} from '../api/session-api'
import { loadSettings, saveSettings } from '../api/settings-api'
import { transcribeAudio } from '../api/stt-api'
import { DEFAULT_SETTINGS } from '../lib/constants'
import { buildReviewBlock } from '../matching/match-record'
import { parseSpeech } from '../parser/speech-parser'
import { LocalOcrAdapter } from '../services/adapters/local-ocr-adapter'
import { MockOcrAdapter } from '../services/adapters/mock-ocr-adapter'
import { MockSttAdapter } from '../services/adapters/mock-stt-adapter'
import type { SttTranscriptionRequest } from '../services/adapters/stt-adapter'
import { loadDictionaries } from '../services/dictionary-loader'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../services/sample-sequences'
import { buildLocalSttExecutionPlan } from '../services/stt/build-local-stt-input'
import { SegmentManager } from '../services/stt/segment-manager'
import type { RecordedAudioClip } from '../types/audio'
import type { DictionaryBundle } from '../types/dictionaries'
import type {
  CaptureImageMeta,
  ManualEditedField,
  ReceiptRecord,
  Session,
  SessionSummary,
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
  lastTranscriptionStrategy: string | null
  lastDetectedLanguage: string | null
  lastTranscriptionEventCount: number
  lastTranscriptionError: string | null
  lastCaptureError: string | null
  lastDictionaryReloadAt: string | null
  lastDictionaryError: string | null
  lastSessionReloadAt: string | null
  lastSessionReloadError: string | null
  availableSessions: SessionSummary[]
  initialize: () => Promise<void>
  reloadDictionaries: () => Promise<void>
  reloadCurrentSessionFromDisk: () => Promise<void>
  refreshAvailableSessions: () => Promise<void>
  restoreSessionById: (sessionId: string) => Promise<void>
  setRecording: (value: boolean) => void
  pushTranscriptEvent: (event: SttInputEvent, captureFrame: CaptureFrameInput) => Promise<void>
  processTranscriptSequence: (events: SttInputEvent[], captureFrame: CaptureFrameInput) => Promise<void>
  transcribeInput: (
    request: SttTranscriptionRequest,
    captureFrame: CaptureFrameInput,
  ) => Promise<void>
  persistRecordedAudioClip: (audioClip: RecordedAudioClip) => Promise<RecordedAudioClip>
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
const mockOcrAdapter = new MockOcrAdapter()
const localOcrAdapter = new LocalOcrAdapter()
const segmentManager = new SegmentManager()

function buildFallbackSeedText(request: SttTranscriptionRequest): string {
  if (request.manualTranscript?.trim()) {
    return request.manualTranscript.trim()
  }

  if (request.sequenceId) {
    const sequence = MOCK_TRANSCRIPT_SEQUENCES.find((item) => item.id === request.sequenceId)
    if (sequence) {
      return sequence.events.map((event) => event.text).join('\n')
    }
  }

  return ''
}

function buildRecordFromSegment(
  segment: SttCommittedSegment,
  capture: CaptureImageMeta,
  dictionaries: DictionaryBundle,
  settings: AppSettings,
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

  const ocrPromise = !settings.ocrEnabled
    ? Promise.resolve({
        rawText: '',
        extractedCandidates: {
          dates: [],
          vendors: [],
          amounts: [],
          invoiceNumbers: [],
        },
        source: 'disabled' as const,
      })
    : (settings.ocrMode === 'local' ? localOcrAdapter : mockOcrAdapter)
        .extractFromImage({ imagePath: capture.imagePath, finalBlock })
        .catch(() => ({
        rawText: '',
        extractedCandidates: {
          dates: [],
          vendors: [],
          amounts: [],
          invoiceNumbers: [],
        },
        source: 'error' as const,
      }))

  return ocrPromise.then((ocr) => {
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
    segments.map((segment) => buildRecordFromSegment(segment, capture, dictionaries, settings)),
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
  lastTranscriptionStrategy: null,
  lastDetectedLanguage: null,
  lastTranscriptionEventCount: 0,
  lastTranscriptionError: null,
  lastCaptureError: null,
  lastDictionaryReloadAt: null,
  lastDictionaryError: null,
  lastSessionReloadAt: null,
  lastSessionReloadError: null,
  availableSessions: [],
  initialize: async () => {
    const [settings, dictionaries] = await Promise.all([
      loadSettings(),
      loadDictionaries(),
    ])
    const [existingSession, availableSessions] = await Promise.all([
      loadCurrentSession(settings.storageRoot),
      listSessions(settings.storageRoot),
    ])

    const session =
      existingSession ??
      (await loadLatestSession(settings.storageRoot)) ??
      (await createSession(settings))

    set({
      isReady: true,
      settings,
      dictionaries,
      session,
      availableSessions:
        availableSessions.length > 0
          ? availableSessions
          : [
              {
                id: session.id,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                recordCount: session.records.length,
              },
            ],
      selectedRecordId: session.records[0]?.id ?? null,
      lastCaptureError: null,
      lastDictionaryReloadAt: new Date().toISOString(),
      lastDictionaryError: null,
      lastSessionReloadAt: new Date().toISOString(),
      lastSessionReloadError: null,
    })
  },
  reloadDictionaries: async () => {
    try {
      const dictionaries = await loadDictionaries()
      set({
        dictionaries,
        lastDictionaryReloadAt: new Date().toISOString(),
        lastDictionaryError: null,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Dictionary reload failed.'
      set({
        lastDictionaryError: message,
      })
      throw error instanceof Error ? error : new Error(message)
    }
  },
  refreshAvailableSessions: async () => {
    const { settings } = get()
    const availableSessions = await listSessions(settings.storageRoot)
    set({ availableSessions })
  },
  reloadCurrentSessionFromDisk: async () => {
    const { settings, selectedRecordId } = get()

    try {
      const session =
        (await loadCurrentSession(settings.storageRoot)) ??
        (await loadLatestSession(settings.storageRoot))
      if (!session) {
        throw new Error('保存済みの現在セッションが見つかりませんでした。')
      }

      const nextSelectedRecordId = session.records.some((record) => record.id === selectedRecordId)
        ? selectedRecordId
        : session.records[0]?.id ?? null

      set({
        session,
        selectedRecordId: nextSelectedRecordId,
        lastSessionReloadAt: new Date().toISOString(),
        lastSessionReloadError: null,
        availableSessions: await listSessions(settings.storageRoot),
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Session reload failed.'
      set({
        lastSessionReloadError: message,
      })
      throw error instanceof Error ? error : new Error(message)
    }
  },
  restoreSessionById: async (sessionId) => {
    const { settings } = get()
    const session = await loadSession(sessionId, settings.storageRoot)

    if (!session) {
      throw new Error('選択したセッションを読み込めませんでした。')
    }

    set({
      session,
      selectedRecordId: session.records[0]?.id ?? null,
      lastSessionReloadAt: new Date().toISOString(),
      lastSessionReloadError: null,
    })
  },
  setRecording: (value) => set({ isRecording: value }),
  persistRecordedAudioClip: async (audioClip) => {
    const session = await ensureSession(get().session, get().settings)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read recorded audio clip.'))
      reader.readAsDataURL(audioClip.blob)
    })

    const savedClip = await saveAudioClip({
      sessionId: session.id,
      audioDataUrl: dataUrl,
      mimeType: audioClip.mimeType,
      size: audioClip.size,
      startedAt: audioClip.startedAt,
      endedAt: audioClip.endedAt,
      storageRoot: get().settings.storageRoot,
    })

    return {
      ...audioClip,
      filePath: savedClip.audioPath,
    }
  },
  pushTranscriptEvent: async (event, captureFrame) => {
    await get().processTranscriptSequence([event], captureFrame)
  },
  processTranscriptSequence: async (events, captureFrame) => {
    const { dictionaries, settings } = get()
    if (!dictionaries) {
      return
    }

    const session = await ensureSession(get().session, settings)
    set({ isProcessing: true, lastCaptureError: null })

    try {
      const segments = segmentManager.append(events)
      const nextSession = await commitSegments(segments, captureFrame, session, settings, dictionaries)
      const availableSessions = await listSessions(settings.storageRoot)

      set({
        isProcessing: false,
        session: nextSession,
        availableSessions,
        pendingEvents: segmentManager.snapshot(),
        selectedRecordId: nextSession.records.at(-1)?.id ?? get().selectedRecordId,
        lastTranscriptionError: null,
        lastCaptureError: null,
      })
    } catch (error) {
      set({
        isProcessing: false,
        lastCaptureError: error instanceof Error ? error.message : 'Capture commit failed.',
      })
    }
  },
  transcribeInput: async (request, captureFrame) => {
    const { settings } = get()

    try {
      let transcription: Awaited<ReturnType<typeof transcribeAudio>> | Awaited<ReturnType<typeof sttAdapter.transcribe>>
      let transcriptionStrategy: string | null = null

      if (settings.sttMode === 'local') {
        const localPlan = buildLocalSttExecutionPlan(
          request,
          settings,
          buildFallbackSeedText(request),
        )
        transcription = await transcribeAudio(localPlan.input)
        transcriptionStrategy = localPlan.strategy
      } else {
        transcription = await sttAdapter.transcribe(request)
        transcriptionStrategy = request.manualTranscript?.trim()
          ? 'manual-transcript'
          : request.audioClip
            ? 'recording'
            : 'mock-sequence'
      }

      await get().processTranscriptSequence(transcription.events, captureFrame)
      set({
        lastTranscriptionSource: transcription.source,
        lastTranscriptionStrategy: transcriptionStrategy,
        lastDetectedLanguage: transcription.detectedLanguage ?? null,
        lastTranscriptionEventCount: transcription.events.length,
        lastTranscriptionError: null,
      })
    } catch (error) {
      set({
        lastTranscriptionStrategy: null,
        lastDetectedLanguage: null,
        lastTranscriptionEventCount: 0,
        lastTranscriptionError: error instanceof Error ? error.message : 'STT transcription failed.',
      })
    }
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
    set({
      session: nextSession,
      availableSessions: await listSessions(session.settingsSnapshot.storageRoot),
    })
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
      availableSessions: await listSessions(session.settingsSnapshot.storageRoot),
      selectedRecordId: records[0]?.id ?? null,
    })
  },
  persistSettings: async (settings) => {
    const saved = await saveSettings(settings)
    const availableSessions = await listSessions(saved.storageRoot)
    set((state) => ({
      settings: saved,
      availableSessions,
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
    const availableSessions = await listSessions(get().settings.storageRoot)
    set({
      session: nextSession,
      availableSessions,
      selectedRecordId: null,
      pendingEvents: [],
      lastTranscriptionSource: null,
      lastTranscriptionStrategy: null,
      lastDetectedLanguage: null,
      lastTranscriptionEventCount: 0,
      lastTranscriptionError: null,
      lastCaptureError: null,
      lastDictionaryError: null,
      lastSessionReloadAt: new Date().toISOString(),
      lastSessionReloadError: null,
    })
  },
}))
