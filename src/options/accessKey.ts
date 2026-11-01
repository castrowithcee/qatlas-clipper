import type { HeaderValues, Target } from '../config';

export const AUTH_HEADER = 'Authorization';
const BEARER = 'Bearer ';

const withoutValue = (values: HeaderValues, id: string, name: string): HeaderValues => {
  const { [name]: _gone, ...rest } = values[id] ?? {};
  void _gone;
  return { ...values, [id]: rest };
};

/** Header names compare case-insensitively, as on the wire. */
const authIndex = (headers: string[]): number => headers.findIndex((h) => h.trim().toLowerCase() === AUTH_HEADER.toLowerCase());

export interface AccessKeyState {
  /** Index of the Authorization header in `target.headers`, or -1. */
  index: number;
  /** The access key (value without the "Bearer " scheme) when the stored value uses that scheme. */
  key: string;
  /** An Authorization header with another scheme or no value: it stays a custom header and the simple field is locked. */
  custom: boolean;
}

export function accessKeyState(target: Target, values: HeaderValues): AccessKeyState {
  const index = authIndex(target.headers);
  if (index < 0) return { index, key: '', custom: false };
  const value = values[target.id]?.[target.headers[index] as string] ?? '';
  return value.startsWith(BEARER) ? { index, key: value.slice(BEARER.length), custom: false } : { index, key: '', custom: true };
}

/** Sets or clears the access key; the value `Bearer <key>` goes to the header values only, the config gets the header name. */
export function setAccessKey(target: Target, values: HeaderValues, input: string): { target: Target; values: HeaderValues } {
  const state = accessKeyState(target, values);
  if (state.custom) return { target, values };
  const key = input.trim();
  const name = state.index >= 0 ? (target.headers[state.index] as string) : AUTH_HEADER;
  if (key === '') {
    if (state.index < 0) return { target, values };
    return { target: { ...target, headers: target.headers.filter((_, i) => i !== state.index) }, values: withoutValue(values, target.id, name) };
  }
  return {
    target: state.index >= 0 ? target : { ...target, headers: [...target.headers, name] },
    values: { ...values, [target.id]: { ...values[target.id], [name]: BEARER + key } },
  };
}
