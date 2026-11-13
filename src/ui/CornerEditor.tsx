import { useRef, useState, type PointerEvent } from 'react';
import type { Pt } from '../domain/types';
import { useObjectUrl } from './hooks';

type Quad = [Pt, Pt, Pt, Pt];

/** 원본 위에서 네 모서리를 끌어 옮긴다. 좌표는 원본 픽셀 기준. */
export function CornerEditor({
  original,
  initial,
  onSave,
  onCancel,
}: {
  original: Blob;
  initial: Quad | null;
  onSave: (q: Quad) => void;
  onCancel: () => void;
}) {
  const url = useObjectUrl(original);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [q, setQ] = useState<Quad | null>(initial);
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const onLoad = (img: HTMLImageElement) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setSize({ w, h });
    if (!q) {
      const mx = w * 0.04;
      const my = h * 0.04;
      setQ([
        [mx, my],
        [w - mx, my],
        [w - mx, h - my],
        [mx, h - my],
      ]);
    }
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (active === null || !size || !q || !svgRef.current) return;
    const box = svgRef.current.getBoundingClientRect();
    const x = Math.min(size.w, Math.max(0, ((e.clientX - box.left) / box.width) * size.w));
    const y = Math.min(size.h, Math.max(0, ((e.clientY - box.top) / box.height) * size.h));
    const next = [...q] as Quad;
    next[active] = [x, y];
    setQ(next);
  };

  const r = size ? Math.max(size.w, size.h) * 0.025 : 10;
  return (
    <div className="corner-editor">
      <div className="ce-stage">
        {url && <img src={url} alt="원본 사진" onLoad={(e) => onLoad(e.currentTarget)} />}
        {size && q && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${size.w} ${size.h}`}
            onPointerMove={move}
            onPointerUp={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
          >
            <polygon points={q.map((p) => p.join(',')).join(' ')} className="ce-poly" />
            {q.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={r}
                className="ce-handle"
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setActive(i);
                }}
              />
            ))}
          </svg>
        )}
      </div>
      <div className="row-buttons">
        <button className="btn" onClick={onCancel}>
          취소
        </button>
        <button className="btn primary" disabled={!q} onClick={() => q && onSave(q)}>
          이대로 자르기
        </button>
      </div>
    </div>
  );
}
