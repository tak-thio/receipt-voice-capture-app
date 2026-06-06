// カメラのシャッター音(WebAudio で合成、音声アセット不要)。
// 「パシャッ」に近い短いクリック+ノイズバーストを鳴らす。

let audioContext: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) {
    return null
  }
  if (!audioContext) {
    audioContext = new Ctor()
  }
  return audioContext
}

/** iOS はユーザー操作後でないと音が出ないため、操作ハンドラ内で一度呼んで解放する。 */
export function unlockShutterAudio(): void {
  const ctx = getContext()
  if (ctx && ctx.state === 'suspended') {
    void ctx.resume()
  }
}

export function playShutterSound(): void {
  const ctx = getContext()
  if (!ctx) {
    return
  }
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }

  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.0001
  master.connect(ctx.destination)

  // 1) メカ音っぽい短いクリック(高め)
  const click = ctx.createOscillator()
  click.type = 'square'
  click.frequency.setValueAtTime(2200, now)
  click.frequency.exponentialRampToValueAtTime(900, now + 0.04)
  const clickGain = ctx.createGain()
  clickGain.gain.setValueAtTime(0.0001, now)
  clickGain.gain.exponentialRampToValueAtTime(0.4, now + 0.005)
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  click.connect(clickGain).connect(master)

  // 2) シャッター幕のノイズバースト
  const noiseLen = Math.floor(ctx.sampleRate * 0.08)
  const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < noiseLen; i += 1) {
    // 後半に向けて減衰するホワイトノイズ
    data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen)
  }
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const noiseFilter = ctx.createBiquadFilter()
  noiseFilter.type = 'highpass'
  noiseFilter.frequency.value = 1500
  const noiseGain = ctx.createGain()
  noiseGain.gain.setValueAtTime(0.25, now + 0.01)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
  noise.connect(noiseFilter).connect(noiseGain).connect(master)

  master.gain.setValueAtTime(1, now)

  click.start(now)
  click.stop(now + 0.07)
  noise.start(now + 0.01)
  noise.stop(now + 0.1)
}
