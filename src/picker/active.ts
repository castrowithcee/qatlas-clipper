/** Shared with the highlight overlay: the picker publishes its running state here, the highlight hides while it runs. */
export const PICKER_ACTIVE_KEY = Symbol.for('qatlas.picker.active');
export const PICKER_STATE_EVENT = 'qatlas-picker-state';

type Globals = Record<symbol, (() => void) | undefined>;
const globals = globalThis as unknown as Globals;

export const isPickerActive = (): boolean => typeof globals[PICKER_ACTIVE_KEY] === 'function';

export const getActivePickerClose = (): (() => void) | undefined => globals[PICKER_ACTIVE_KEY];

export function setActivePicker(close: (() => void) | undefined): void {
  globals[PICKER_ACTIVE_KEY] = close;
  try {
    globalThis.dispatchEvent(new Event(PICKER_STATE_EVENT));
  } catch {
    // No event target in this environment; the highlight then only sees the state on its next refresh.
  }
}
