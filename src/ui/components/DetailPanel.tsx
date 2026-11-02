import type { ReactNode } from 'react';
import { Dialog } from './Dialog';

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  /** Buttons under the content. */
  actions?: ReactNode;
}

/** Modal side panel at the right window edge (full screen on narrow windows); focus trap, Escape and focus return come from `Dialog`. */
export function DetailPanel(props: Props) {
  return <Dialog {...props} variant="panel" />;
}
