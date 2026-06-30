import { useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import { cn } from '../ui'

// 領収書プレビュー用のズーム/パン画像。
// - ダブルクリックで拡大⇄等倍
// - 拡大中はドラッグで移動
// - 右下の半透明ボタンで ＋ / − / リセット、ホイールでもズーム
export function ZoomableImage({ src, alt, className }: { src: string; alt?: string; className?: string }) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const clamp = (s: number) => Math.min(6, Math.max(1, Math.round(s * 10) / 10))

  function zoomBy(delta: number) {
    setScale((s) => {
      const ns = clamp(s + delta)
      if (ns === 1) setOffset({ x: 0, y: 0 })
      return ns
    })
  }
  function reset() {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }
  function onDoubleClick() {
    if (scale > 1) reset()
    else setScale(2.5)
  }
  function onWheel(e: RWheelEvent<HTMLImageElement>) {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? 0.3 : -0.3)
  }
  function onPointerDown(e: RPointerEvent<HTMLImageElement>) {
    if (scale <= 1) return // 等倍のときはパンしない
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: RPointerEvent<HTMLImageElement>) {
    if (!drag.current) return
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) })
  }
  function onPointerUp() {
    drag.current = null
    setDragging(false)
  }

  const btn =
    'grid h-8 w-8 place-items-center rounded-md bg-slate-900/40 text-base font-bold text-white ' +
    'backdrop-blur-sm transition-colors hover:bg-slate-900/70'

  return (
    <div className={cn('relative flex items-center justify-center overflow-hidden bg-slate-50', className)}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transition: dragging ? 'none' : 'transform 0.15s ease-out',
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
        }}
        className="max-h-full max-w-full select-none object-contain"
      />
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button type="button" className={btn} title="拡大" onClick={() => zoomBy(0.5)}>＋</button>
        <button type="button" className={btn} title="縮小" onClick={() => zoomBy(-0.5)}>−</button>
        <button type="button" className={btn} title="リセット" onClick={reset}>⟲</button>
      </div>
      {scale > 1 && (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-900/40 px-1.5 py-0.5 text-xs text-white backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  )
}
