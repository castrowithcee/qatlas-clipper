import type { ReactNode, SVGProps } from 'react';
import './components.css';

const PATHS = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17h.01" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  inbox: <path d="M4 13l2-7h12l2 7v5H4zM4 13h5l1 2h4l1-2h5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  pointer: <path d="M5 3l14 7-6 2-2 6z" />,
  edit: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  auto: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

interface Props extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** Accessible name; without it the icon is decorative and hidden from assistive technology. */
  label?: string;
}

export function Icon({ name, label, className, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['q-icon', className].filter(Boolean).join(' ')}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
