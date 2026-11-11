// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { moveBetween, useReorder, type Move } from '../src/options/reorder';

afterEach(cleanup);

describe('moveBetween', () => {
  const groups = { a: [1, 2, 3], b: [4, 5] };
  it('moves within a group to the target index', () => {
    expect(moveBetween(groups, { from: { group: 'a', index: 0 }, to: { group: 'a', index: 2 } })).toEqual({ a: [2, 3, 1], b: [4, 5] });
  });
  it('moves into another group at a position, also at its end', () => {
    expect(moveBetween(groups, { from: { group: 'a', index: 1 }, to: { group: 'b', index: 1 } })).toEqual({ a: [1, 3], b: [4, 2, 5] });
    expect(moveBetween(groups, { from: { group: 'b', index: 0 }, to: { group: 'a', index: 3 } })).toEqual({ a: [1, 2, 3, 4], b: [5] });
  });
  it('ignores impossible moves', () => {
    expect(moveBetween(groups, { from: { group: 'a', index: 5 }, to: { group: 'b', index: 0 } })).toBe(groups);
    expect(moveBetween(groups, { from: { group: 'a', index: 0 }, to: { group: 'c', index: 0 } })).toBe(groups);
    expect(moveBetween(groups, { from: { group: 'a', index: 0 }, to: { group: 'b', index: 3 } })).toBe(groups);
  });
});

function Demo({ onMoved }: { onMoved?: (m: Move) => void }) {
  const [groups, setGroups] = useState<Record<string, string[]>>({ one: ['A', 'B', 'C'], two: ['D'] });
  const reorder = useReorder({
    sizeOf: (g) => groups[g]?.length ?? 0,
    onMove: (m) => {
      onMoved?.(m);
      setGroups(moveBetween(groups, m));
    },
    announce: (m) => `${groups[m.from.group]![m.from.index]}: ${m.to.group} ${m.to.index + 1}`,
  });
  return (
    <>
      {Object.entries(groups).map(([group, items]) => (
        <ul key={group} aria-label={group}>
          {items.map((name, i) => {
            const { row, grip } = reorder.item(name, name, i, group);
            return (
              <li key={name} className={row.className} onDragOver={row.onDragOver} onDrop={row.onDrop}>
                <button {...grip} aria-label={`Move ${name}`} />
                {name}
              </li>
            );
          })}
          <li aria-hidden data-testid={`end-${group}`} {...reorder.dropProps({ group, index: items.length })} />
        </ul>
      ))}
      <p role="status">{reorder.announcement}</p>
    </>
  );
}

const dt = () => ({ effectAllowed: '', dropEffect: '', setData: vi.fn(), setDragImage: vi.fn() });
const order = (group: string) => Array.from(screen.getByRole('list', { name: group }).querySelectorAll('li:not([aria-hidden])')).map((li) => li.textContent);

describe('useReorder', () => {
  it('moves with the arrow keys, announces the position and keeps the focus on the grip', async () => {
    render(<Demo />);
    act(() => screen.getByRole('button', { name: 'Move C' }).focus());
    await userEvent.setup().keyboard('{ArrowUp}');
    expect(order('one')).toEqual(['A', 'C', 'B']);
    expect(screen.getByRole('status').textContent).toBe('C: one 2');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move C' }));
  });

  it('stops at the ends of a group', async () => {
    const onMoved = vi.fn();
    render(<Demo onMoved={onMoved} />);
    act(() => screen.getByRole('button', { name: 'Move A' }).focus());
    await userEvent.setup().keyboard('{ArrowUp}');
    act(() => screen.getByRole('button', { name: 'Move D' }).focus());
    await userEvent.setup().keyboard('{ArrowDown}');
    expect(onMoved).not.toHaveBeenCalled();
  });

  it('moves between groups by dragging onto a row and onto the end of a group', () => {
    render(<Demo />);
    const data = dt();
    fireEvent.dragStart(screen.getByRole('button', { name: 'Move B' }), { dataTransfer: data });
    const target = screen.getByRole('button', { name: 'Move D' }).closest('li')!;
    fireEvent.dragOver(target, { dataTransfer: data });
    expect(target.className).toContain('is-drop-before');
    fireEvent.drop(target, { dataTransfer: data });
    expect(order('one')).toEqual(['A', 'C']);
    expect(order('two')).toEqual(['B', 'D']);
    expect(screen.getByRole('status').textContent).toBe('B: two 1');

    fireEvent.dragStart(screen.getByRole('button', { name: 'Move A' }), { dataTransfer: data });
    fireEvent.drop(screen.getByTestId('end-two'), { dataTransfer: data });
    expect(order('one')).toEqual(['C']);
    expect(order('two')).toEqual(['B', 'D', 'A']);
  });

  it('moves to the last place on a drop at the end of the own group and clears the marks when the drag ends', () => {
    const onMoved = vi.fn();
    render(<Demo onMoved={onMoved} />);
    const data = dt();
    const grip = screen.getByRole('button', { name: 'Move A' });
    fireEvent.dragStart(grip, { dataTransfer: data });
    fireEvent.drop(screen.getByTestId('end-one'), { dataTransfer: data });
    expect(onMoved).toHaveBeenCalledWith({ from: { group: 'one', index: 0 }, to: { group: 'one', index: 2 } });
    expect(screen.getAllByRole('listitem').map((li) => li.textContent).filter(Boolean)).toEqual(['B', 'C', 'A', 'D']);
    fireEvent.dragStart(grip, { dataTransfer: data });
    fireEvent.dragOver(grip.closest('li')!.nextElementSibling!, { dataTransfer: data });
    fireEvent.dragEnd(grip);
    expect(document.querySelector('.is-drop-after, .is-drop-before, .is-dragged')).toBeNull();
  });
});
