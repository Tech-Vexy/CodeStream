import type { ReactNode } from 'react';
import type { CastStatus } from './types';

/** Human "3 minutes ago" style relative time. */
export function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const units: Array<[string, number]> = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (seconds >= size) {
      const n = Math.floor(seconds / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return '';
}

export const kindLabel = (kind: string): string => (kind === 'changes' ? 'Change review' : 'Codebase tour');

export function statusLabel(status: CastStatus): string {
  if (status === 'ready') return 'Ready';
  if (status === 'failed') return 'Failed';
  if (status === 'queued') return 'Queued';
  return 'Working';
}

/**
 * Render inline text with `code` spans; **bold** markers are stripped.
 * Unbalanced backticks degrade gracefully to plain text (model output is untrusted,
 * so it is only ever rendered as text, never as HTML).
 */
export function inline(text: string | undefined): ReactNode[] {
  const parts = String(text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split('`');
  if (parts.length % 2 === 0) {
    const last = parts.pop() ?? '';
    const prev = parts.pop() ?? '';
    parts.push(`${prev}\`${last}`);
  }
  return parts.map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/** Split a block of prose into paragraphs for rendering. */
export function paragraphs(text: string | undefined): string[] {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
