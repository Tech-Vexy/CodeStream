import { useEffect, useRef, useState } from 'react';
import { Modal, Button } from './ui';
import { setToken } from '../lib/api';

interface TokenDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the pasted token after it has been stored. */
  onSaved: () => void;
}

/** Fallback auth for deployments protected by CODESTREAM_API_TOKEN instead of GitHub OAuth. */
export function TokenDialog({ open, onClose, onSaved }: TokenDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const save = () => {
    const token = value.trim();
    if (!token) return;
    setToken(token);
    onSaved();
  };

  return (
    <Modal open={open} onClose={onClose} title="API token required">
      <p>
        This CodeStream deployment is protected. Paste the value of <code>CODESTREAM_API_TOKEN</code> to continue.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <input
          ref={inputRef}
          className="input"
          type="password"
          required
          autoComplete="current-password"
          placeholder="API token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Modal>
  );
}
