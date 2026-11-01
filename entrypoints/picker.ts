import { mountPicker } from '../src/picker/overlay';

/** Global entry called by startPicker (src/picker/start.ts) after injection, in the same isolated world. */
const PICKER_GLOBAL = '__qatlasPickerStart';

export default defineUnlistedScript(() => {
  (globalThis as Record<string, unknown>)[PICKER_GLOBAL] = (projectId: string, fieldKey: string) => {
    mountPicker({ projectId, fieldKey });
  };
});
