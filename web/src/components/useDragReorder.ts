import { useRef, useState } from 'react';

/**
 * Drag-and-drop reordering for lists and table rows, with mouse or touch.
 * Put `rowProps(i)` on each row and `handleProps(i)` on its grip icon; `onMove(from, to)` is called on drop.
 */
export function useDragReorder(group: string, onMove: (from: number, to: number) => void, disabled = false) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const ref = useRef<{ from: number; over: number } | null>(null);
  const indexAt = (x: number, y: number) => {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest(`[data-drag-group="${group}"]`) as HTMLElement | null;
    return el ? Number(el.dataset.dragIndex) : null;
  };
  const handleProps = (i: number) => ({
    style: { cursor: disabled ? 'default' : 'grab', touchAction: 'none' as const },
    title: disabled ? undefined : 'Drag to reorder',
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      ref.current = { from: i, over: i }; setDrag(ref.current);
      document.body.classList.add('dragging-rows');
      const move = (ev: PointerEvent) => {
        const j = indexAt(ev.clientX, ev.clientY);
        if (j !== null && ref.current && j !== ref.current.over) { ref.current = { ...ref.current, over: j }; setDrag(ref.current); }
      };
      const up = () => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        document.body.classList.remove('dragging-rows');
        const r = ref.current; ref.current = null; setDrag(null);
        if (r && r.from !== r.over) onMove(r.from, r.over);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    },
  });
  const rowProps = (i: number) => ({
    'data-drag-group': group, 'data-drag-index': i,
    className: drag ? (i === drag.from ? 'drag-src' : i === drag.over ? (drag.over > drag.from ? 'drag-over-below' : 'drag-over-above') : undefined) : undefined,
  });
  return { handleProps, rowProps, dragging: Boolean(drag) };
}

/** Move one item of an array to a new position. */
export const moveItem = <T,>(arr: T[], from: number, to: number) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };
