export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Margin kept between the tooltip and the window edge. */
const EDGE = 4;

/**
 * Viewport position for a tooltip below its trigger, shifted into the window horizontally
 * and flipped above the trigger when it would not fit below.
 * `gap` is the tooltip's own top margin, which is added on top of the returned `top`.
 */
export function placeTooltip(trigger: Box, tip: { width: number; height: number }, view: { width: number; height: number }, gap = 0) {
  const maxLeft = Math.max(EDGE, view.width - tip.width - EDGE);
  const left = Math.min(Math.max(trigger.left, EDGE), maxLeft);
  const below = trigger.top + trigger.height;
  const fitsBelow = below + gap + tip.height <= view.height - EDGE;
  const above = trigger.top - gap - tip.height;
  const top = fitsBelow || above < EDGE ? below : above;
  return { left, top };
}
