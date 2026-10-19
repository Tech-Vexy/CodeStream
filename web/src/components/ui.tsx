import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { CastStatus } from '../lib/types';
import { statusLabel } from '../lib/format';
import { Icon } from './icons';

/* Button ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'github';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const sizeClass: Record<ButtonSize, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' };

export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, ...rest }: ButtonProps) {
  const classes = ['btn', `btn-${variant}`, sizeClass[size], className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* Status pill -------------------------------------------------------------- */

export function StatusPill({ status }: { status: CastStatus }) {
  return <span className={`pill ${status}`}>{statusLabel(status)}</span>;
}

/* Severity tag -------------------------------------------------------------- */

export function Sev({ severity }: { severity: string }) {
  const level = severity.toLowerCase();
  const cls = level === 'high' || level === 'critical' ? 'high' : level === 'low' || level === 'info' ? 'low' : 'medium';
  return <span className={`sev ${cls}`}>{level}</span>;
}

/* Progress ------------------------------------------------------------------ */

export function Progress({ done, total }: { done?: number; total?: number }) {
  const hasRange = Boolean(total) && (total as number) > 0 && done !== undefined;
  if (!hasRange) return <div className="progress progress-indeterminate" role="progressbar" aria-label="In progress" />;
  return (
    <progress className="progress" max={total} value={done}>
      {Math.round(((done as number) / (total as number)) * 100)}%
    </progress>
  );
}

/* Copy button ----------------------------------------------------------------- */

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access restricted
    }
  };

  return (
    <button type="button" className="btn-copy-transcript" onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Copied!' : label}
    </button>
  );
}

/* Skeletons --------------------------------------------------------------------- */

export function Skeleton({ width = '100%', height = 12 }: { width?: number | string; height?: number | string }) {
  return <span className="skeleton" style={{ width, height }} />;
}

/* Modal ------------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/* Avatar ------------------------------------------------------------------------ */

export function Avatar({ login, avatarUrl }: { login: string; avatarUrl?: string }) {
  if (avatarUrl) {
    return <img className="user-avatar" src={avatarUrl} alt={login} referrerPolicy="no-referrer" />;
  }
  return <span className="user-avatar">{login.slice(0, 1).toUpperCase()}</span>;
}
