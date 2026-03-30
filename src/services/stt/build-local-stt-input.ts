import type { TranscribeAudioInput } from '../../api/stt-api'
import type { AppSettings } from '../../types/settings'
import type { SttTranscriptionRequest } from '../adapters/stt-adapter'

export type LocalSttStrategy = 'recorded-audio' | 'seed-fallback'

export interface LocalSttExecutionPlan {
  input: TranscribeAudioInput
  strategy: LocalSttStrategy
}

function buildSeedText(request: SttTranscriptionRequest): string {
  if (request.manualTranscript?.trim()) {
    return request.manualTranscript.trim()
  }

  return ''
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
