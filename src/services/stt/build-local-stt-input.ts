import type { TranscribeAudioInput } from '../../api/stt-api'
import type { AppSettings } from '../../types/settings'
import type { SttTranscriptionRequest } from '../adapters/stt-adapter'

export type LocalSttStrategy = 'recorded-audio' | 'seed-fallback'
export type OpenAiSttStrategy = 'recorded-audio' | 'seed-fallback'
export type GeminiSttStrategy = 'recorded-audio' | 'seed-fallback'

export interface LocalSttExecutionPlan {
  input: TranscribeAudioInput
  strategy: LocalSttStrategy
}

export interface OpenAiSttExecutionPlan {
  input: TranscribeAudioInput
  strategy: OpenAiSttStrategy
}

export interface GeminiSttExecutionPlan {
  input: TranscribeAudioInput
  strategy: GeminiSttStrategy
}

function buildSeedText(request: SttTranscriptionRequest): string {
  if (request.manualTranscript?.trim()) {
    return request.manualTranscript.trim()
  }

  return ''
}

export function buildGeminiSttExecutionPlan(
  request: SttTranscriptionRequest,
  settings: AppSettings,
  fallbackSeedText = '',
): GeminiSttExecutionPlan {
  const audioPath = request.audioClip?.filePath?.trim()

  if (audioPath) {
    return {
      strategy: 'recorded-audio',
      input: {
        mode: 'gemini',
        audioPath,
        audioDurationMs: request.audioClip?.durationMs,
        sttModel: settings.geminiModel,
        sttLanguage: settings.sttLanguage,
      },
    }
  }

  const seedText = buildSeedText(request) || fallbackSeedText.trim()
  if (!seedText) {
    throw new Error('Gemini STT を実行するには保存済み録音または transcript 入力が必要です。')
  }

  return {
    strategy: 'seed-fallback',
    input: {
      mode: 'gemini',
      audioDurationMs: request.audioClip?.durationMs,
      seedText,
      sttModel: settings.geminiModel,
      sttLanguage: settings.sttLanguage,
    },
  }
}

export function buildOpenAiSttExecutionPlan(
  request: SttTranscriptionRequest,
  settings: AppSettings,
  fallbackSeedText = '',
): OpenAiSttExecutionPlan {
  const audioPath = request.audioClip?.filePath?.trim()

  if (audioPath) {
    return {
      strategy: 'recorded-audio',
      input: {
        mode: 'openai',
        audioPath,
        audioDurationMs: request.audioClip?.durationMs,
        sttModel: settings.openaiSttModel,
        sttLanguage: settings.sttLanguage,
      },
    }
  }

  const seedText = buildSeedText(request) || fallbackSeedText.trim()
  if (!seedText) {
    throw new Error('OpenAI STT を実行するには保存済み録音または transcript 入力が必要です。')
  }

  return {
    strategy: 'seed-fallback',
    input: {
      mode: 'openai',
      audioDurationMs: request.audioClip?.durationMs,
      seedText,
      sttModel: settings.openaiSttModel,
      sttLanguage: settings.sttLanguage,
    },
  }
}

export function buildLocalSttExecutionPlan(
  request: SttTranscriptionRequest,
  settings: AppSettings,
  fallbackSeedText = '',
): LocalSttExecutionPlan {
  const audioPath = request.audioClip?.filePath?.trim()

  if (audioPath) {
    return {
      strategy: 'recorded-audio',
      input: {
        mode: 'local',
        audioPath,
        audioDurationMs: request.audioClip?.durationMs,
        sttModel: settings.sttModel,
        sttDevice: settings.sttDevice,
        sttComputeType: settings.sttComputeType,
        sttLanguage: settings.sttLanguage,
        sttBeamSize: settings.sttBeamSize,
      },
    }
  }

  const seedText = buildSeedText(request) || fallbackSeedText.trim()
  if (!seedText) {
    throw new Error('local STT を実行するには保存済み録音または transcript 入力が必要です。')
  }

  return {
    strategy: 'seed-fallback',
    input: {
      mode: 'local',
      audioDurationMs: request.audioClip?.durationMs,
      seedText,
      sttModel: settings.sttModel,
      sttDevice: settings.sttDevice,
      sttComputeType: settings.sttComputeType,
      sttLanguage: settings.sttLanguage,
      sttBeamSize: settings.sttBeamSize,
    },
  }
}
