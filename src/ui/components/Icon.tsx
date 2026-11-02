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
  'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
  'arrow-down': <path d="M12 5v14M6 13l6 6 6-6" />,
  trash: <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  settings: (
    <>
      <path d="M9.51 5.25L10.24 2.16h3.52l.73 3.09.52.21 2.71-1.66 2.48 2.48-1.66 2.71.21.52 3.09.73v3.52l-3.09.73-.21.52 1.66 2.71-2.48 2.48-2.71-1.66-.52.21-.73 3.09h-3.52l-.73-3.09-.52-.21-2.71 1.66-2.48-2.48 1.66-2.71-.21-.52-3.09-.73v-3.52l3.09-.73.21-.52-1.66-2.71 2.48-2.48 2.71 1.66z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  pointer: <path d="M5 3l14 7-6 2-2 6z" />,
  edit: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  auto: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
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
