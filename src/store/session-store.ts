import { saveAudioClip } from '../api/audio-api'
import { formatReceiptText } from '../api/ai-formatter-api'
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
import { BOUNDARY_KEYWORDS, DEFAULT_SETTINGS } from '../lib/constants'
import { buildReviewBlock } from '../matching/match-record'
import { normalizeSpeechText } from '../parser/normalizers'
import { parseSpeech } from '../parser/speech-parser'
import { tokenizeSpeech } from '../parser/tokenize'
import { LocalOcrAdapter } from '../services/adapters/local-ocr-adapter'
import { MockOcrAdapter } from '../services/adapters/mock-ocr-adapter'
import { GeminiOcrAdapter } from '../services/adapters/gemini-ocr-adapter'
import { MockSttAdapter } from '../services/adapters/mock-stt-adapter'
import type { SttTranscriptionRequest } from '../services/adapters/stt-adapter'
import { loadDictionaries } from '../services/dictionary-loader'
import { MOCK_TRANSCRIPT_SEQUENCES } from '../services/sample-sequences'
import {
  buildGeminiSttExecutionPlan,
  buildLocalSttExecutionPlan,
  buildOpenAiSttExecutionPlan,
} from '../services/stt/build-local-stt-input'
import { SegmentManager } from '../services/stt/segment-manager'
import type { RecordedAudioClip } from '../types/audio'
import type { DictionaryBundle } from '../types/dictionaries'
import type {
  CaptureImageMeta,
  ManualEditedField,
  ReceiptRecord,
  Session,
  SessionSummary,
  SpeechParseResult,
  SttCommittedSegment,
  SttInputEvent,
} from '../types/domain'
import type { AppSettings } from '../types/settings'

type ReviewMode = 'table' | 'detail'

interface CaptureFrameInput {
  imageDataUrl: string
  width: number
  height: number
  capturedAtMs?: number
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
  pushTranscriptEvent: (event: SttInputEvent, captureFrames: CaptureFrameInput[]) => Promise<void>
  processTranscriptSequence: (
    events: SttInputEvent[],
    captureFrames: CaptureFrameInput[],
    options?: { flushPending?: boolean },
  ) => Promise<void>
  transcribeInput: (
    request: SttTranscriptionRequest,
    captureFrames: CaptureFrameInput[],
  ) => Promise<void>
  persistRecordedAudioClip: (audioClip: RecordedAudioClip) => Promise<RecordedAudioClip>
  setSelectedRecordId: (recordId: string | null) => void
  setReviewMode: (mode: ReviewMode) => void
  updateFinalField: <K extends keyof ReceiptRecord['final']>(
    recordId: string,
    field: K,
    value: ReceiptRecord['final'][K],
  ) => Promise<void>
  markRecordConfirmed: (recordId: string) => Promise<void>
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

async function formatSegmentText(
  rawText: string,
  dictionaries: DictionaryBundle,
  settings: AppSettings,
): Promise<SpeechParseResult> {
  const fallback = parseSpeech({
    rawText,
    dictionaries,
  })

  if (settings.aiFormatMode !== 'openai' && settings.aiFormatMode !== 'gemini') {
    return fallback
  }

  try {
    const formatted = await formatReceiptText({
      rawText,
      provider: settings.aiFormatMode,
      model: settings.aiFormatMode === 'gemini' ? settings.geminiModel : settings.aiFormatterModel,
      referenceDate: new Date().toISOString(),
      dictionaries,
    })
    const fields = formatted.records[0]

    if (!fields) {
      return {
        ...fallback,
        warnings: [...fallback.warnings, 'AI整形結果にレコードが含まれていませんでした。'],
      }
    }

    const normalizedText = normalizeSpeechText(rawText)
    const rawTokens = tokenizeSpeech(normalizedText)

    return {
      normalizedText,
      tokens: rawTokens.filter((token) => !BOUNDARY_KEYWORDS.includes(token)),
      fields: {
        ...fields,
        amount: fields.amount === null ? null : Number(fields.amount),
      },
      warnings: formatted.warnings,
      boundaryDetected: rawTokens.some((token) => BOUNDARY_KEYWORDS.includes(token)),
    }
  } catch (error) {
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        error instanceof Error
          ? `AI整形に失敗したためルールベース結果を使用しました: ${error.message}`
          : 'AI整形に失敗したためルールベース結果を使用しました。',
      ],
    }
  }
}

async function buildRecordFromSegment(
  segment: SttCommittedSegment,
  capture: CaptureImageMeta,
  dictionaries: DictionaryBundle,
  settings: AppSettings,
): Promise<ReceiptRecord> {
  const parsed = await formatSegmentText(segment.rawText, dictionaries, settings)

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
    : (settings.ocrMode === 'local'
        ? localOcrAdapter
        : settings.ocrMode === 'gemini'
          ? new GeminiOcrAdapter(settings.geminiModel)
          : mockOcrAdapter)
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
  captureFrames: CaptureFrameInput[],
  session: Session,
  settings: AppSettings,
  dictionaries: DictionaryBundle,
): Promise<Session> {
  if (!segments.length) {
    return session
  }

  const newRecords = await Promise.all(
    segments.map(async (segment, index) => {
      const captureFrame = selectCaptureFrameForSegment(segment, captureFrames)
      const capture = await saveCaptureImage({
        sessionId: session.id,
        imageDataUrl: captureFrame.imageDataUrl,
        width: captureFrame.width,
        height: captureFrame.height,
        storageRoot: settings.storageRoot,
        suggestedFileName: `capture-${Date.now()}-${index + 1}.jpg`,
      })

      return buildRecordFromSegment(segment, capture, dictionaries, settings)
    }),
  )

  const nextSession: Session = {
    ...session,
    settingsSnapshot: settings,
    updatedAt: new Date().toISOString(),
    records: [...session.records, ...newRecords],
  }

  await saveSession(nextSession, settings.storageRoot)
  return nextSession
}

function selectCaptureFrameForSegment(
  segment: SttCommittedSegment,
  captureFrames: CaptureFrameInput[],
): CaptureFrameInput {
  const frames = captureFrames.length ? captureFrames : []
  if (!frames.length) {
    throw new Error('レコードに紐づける画像がありません。')
  }

  const startMs = segment.segmentStartMs ?? 0
  const endMs = segment.segmentEndMs ?? startMs
  const targetMs = Math.max(startMs, endMs - 800)
  const framesInSegment = frames.filter((frame) => {
    const capturedAtMs = frame.capturedAtMs ?? targetMs
    return capturedAtMs >= startMs && capturedAtMs <= endMs
  })
  const candidates = framesInSegment.length ? framesInSegment : frames

  return candidates.reduce((best, frame) => {
    const bestDistance = Math.abs((best.capturedAtMs ?? targetMs) - targetMs)
    const frameDistance = Math.abs((frame.capturedAtMs ?? targetMs) - targetMs)
    return frameDistance < bestDistance ? frame : best
  })
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
  pushTranscriptEvent: async (event, captureFrames) => {
    await get().processTranscriptSequence([event], captureFrames)
  },
  processTranscriptSequence: async (events, captureFrames, options) => {
    const { dictionaries, settings } = get()
    if (!dictionaries) {
      return
    }

    const session = await ensureSession(get().session, settings)
    set({ isProcessing: true, lastCaptureError: null })

    try {
      const segments = [
        ...segmentManager.append(events),
        ...(options?.flushPending ? segmentManager.flush() : []),
      ]
      const nextSession = await commitSegments(segments, captureFrames, session, settings, dictionaries)
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
  transcribeInput: async (request, captureFrames) => {
    const { settings } = get()
    set({
      isProcessing: true,
      lastTranscriptionError: null,
      lastCaptureError: null,
    })

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
      } else if (settings.sttMode === 'openai') {
        const openAiPlan = buildOpenAiSttExecutionPlan(
          request,
          settings,
          buildFallbackSeedText(request),
        )
        transcription = await transcribeAudio(openAiPlan.input)
        transcriptionStrategy = `openai-${openAiPlan.strategy}`
      } else if (settings.sttMode === 'gemini') {
        const geminiPlan = buildGeminiSttExecutionPlan(
          request,
          settings,
          buildFallbackSeedText(request),
        )
        transcription = await transcribeAudio(geminiPlan.input)
        transcriptionStrategy = `gemini-${geminiPlan.strategy}`
      } else {
        transcription = await sttAdapter.transcribe(request)
        transcriptionStrategy = request.manualTranscript?.trim()
          ? 'manual-transcript'
          : request.audioClip
            ? 'recording'
          : 'mock-sequence'
      }

      if (!transcription.events.length) {
        throw new Error('文字起こし結果が空でした。録音音量、入力マイク、またはSTTサービスの応答を確認してください。')
      }

      await get().processTranscriptSequence(transcription.events, captureFrames, {
        flushPending: true,
      })
      set({
        lastTranscriptionSource: transcription.source,
        lastTranscriptionStrategy: transcriptionStrategy,
        lastDetectedLanguage: transcription.detectedLanguage ?? null,
        lastTranscriptionEventCount: transcription.events.length,
        lastTranscriptionError: null,
      })
    } catch (error) {
      set({
        isProcessing: false,
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

      const nextReview = buildReviewBlock(nextFinal, record.ocr, record.stt.parserWarnings)

      return {
        ...record,
        updatedAt: new Date().toISOString(),
        final: nextFinal,
        review: {
          ...nextReview,
          confirmedAt: null,
        },
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
  markRecordConfirmed: async (recordId) => {
    const session = get().session
    if (!session) {
      return
    }

    const confirmedAt = new Date().toISOString()
    const records = session.records.map((record) =>
      record.id === recordId
        ? {
            ...record,
            updatedAt: confirmedAt,
            review: {
              ...record.review,
              confirmedAt,
            },
          }
        : record,
    )
    const nextSession = {
      ...session,
      updatedAt: confirmedAt,
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
