import { describe, expect, it } from 'vitest';
import { placeTooltip } from '../src/ui/components/placeTooltip';

const view = { width: 384, height: 600 };
const tip = { width: 150, height: 40 };

describe('placeTooltip', () => {
  it('aligns to the trigger when it fits', () => {
    expect(placeTooltip({ left: 20, top: 10, width: 28, height: 28 }, tip, view)).toEqual({ left: 20, top: 38 });
  });
  it('shifts left at the right edge', () => {
    const { left } = placeTooltip({ left: 350, top: 10, width: 28, height: 28 }, tip, view);
    expect(left + tip.width).toBeLessThanOrEqual(view.width);
  });
  it('stays inside when wider than the window', () => {
    expect(placeTooltip({ left: 100, top: 10, width: 28, height: 28 }, { width: 500, height: 40 }, view).left).toBeGreaterThanOrEqual(0);
  });
  it('flips above when it does not fit below', () => {
    const { top } = placeTooltip({ left: 20, top: 570, width: 28, height: 28 }, tip, view, 4);
    expect(top + 4 + tip.height).toBeLessThanOrEqual(570);
  });
});
