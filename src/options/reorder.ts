import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { moveTo } from './draft';

/** A place in a list; lists that have no groups use the group `''`. */
export interface Slot {
  group: string;
  index: number;
}

/** `to.index` is the index the item has in the target group after the move. */
export interface Move {
  from: Slot;
  to: Slot;
}

/** Applies a move to lists by group; an impossible move returns the lists unchanged. */
export function moveBetween<T>(groups: Record<string, T[]>, { from, to }: Move): Record<string, T[]> {
  const source = groups[from.group];
  const target = groups[to.group];
  if (!source || !target || from.index < 0 || from.index >= source.length) return groups;
  if (from.group === to.group) return { ...groups, [from.group]: moveTo(source, from.index, to.index) };
  if (to.index < 0 || to.index > target.length) return groups;
  const item = source[from.index] as T;
  const next = [...target];
  next.splice(to.index, 0, item);
  return { ...groups, [from.group]: source.filter((_, i) => i !== from.index), [to.group]: next };
}

interface Options {
  /** Number of items in a group; the arrow keys stop at its ends. */
  sizeOf: (group: string) => number;
  /** Called for every move, by mouse or keyboard; the caller changes its list. */
  onMove: (move: Move) => void;
  /** Text for the live region after a move; rendered as text only. */
  announce: (move: Move) => string;
}

/**
 * Reordering by dragging the grip with the mouse and by the arrow keys at the grip.
 * Both lead to `onMove`, which may also cross groups.
 */
export function useReorder({ sizeOf, onMove, announce }: Options) {
  const id = useId();
  const [announcement, setAnnouncement] = useState('');
  const [drag, setDrag] = useState<{ from: Slot; over: Slot }>();
  // The grip to focus after a move: a moved row can lose the focus when the DOM is reordered.
  const focusGrip = useRef<string | undefined>(undefined);

  useEffect(() => {
    const key = focusGrip.current;
    if (key === undefined) return;
    focusGrip.current = undefined;
    document.getElementById(`${id}-grip-${key}`)?.focus();
  });

  const move = (move: Move) => {
    const size = sizeOf(move.to.group);
    // A drop on the end of the item's own group means its last place.
    const m = move.from.group === move.to.group && move.to.index === size ? { ...move, to: { ...move.to, index: size - 1 } } : move;
    if (m.from.group === m.to.group && m.from.index === m.to.index) return;
    if (m.to.index < 0 || m.to.index >= (m.from.group === m.to.group ? size : size + 1)) return;
    setAnnouncement(announce(m));
    onMove(m);
  };

  const same = (a: Slot, b: Slot) => a.group === b.group && a.index === b.index;

  /** Props for a drop target: a row, or with `index` at the group's size the end of a group. */
  const dropProps = (slot: Slot) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!same(drag.over, slot)) setDrag({ ...drag, over: slot });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      if (!drag) return;
      e.preventDefault();
      move({ from: drag.from, to: slot });
      setDrag(undefined);
    },
  });

  /** Props for the row and its grip button; `name` is the item's name for the drag image's data. */
  const item = (key: string, name: string, index: number, group = '') => {
    const slot = { group, index };
    const dragged = drag !== undefined && same(drag.from, slot);
    let mark: string | undefined;
    if (drag && same(drag.over, slot) && !dragged) mark = drag.from.group === group && drag.from.index < index ? 'is-drop-after' : 'is-drop-before';
    return {
      row: {
        className: [dragged ? 'is-dragged' : undefined, mark].filter(Boolean).join(' '),
        ...dropProps(slot),
      },
      grip: {
        id: `${id}-grip-${key}`,
        draggable: true as const,
        onDragStart: (e: DragEvent<HTMLElement>) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', name);
          const row = e.currentTarget.closest('tr, li');
          if (row) e.dataTransfer.setDragImage(row, 0, 0);
          setDrag({ from: slot, over: slot });
        },
        onDragEnd: () => setDrag(undefined),
        onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
          const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
          if (delta === 0) return;
          e.preventDefault();
          focusGrip.current = key;
          move({ from: slot, to: { group, index: index + delta } });
        },
      },
    };
  };

  return { item, dropProps, announcement };
}
