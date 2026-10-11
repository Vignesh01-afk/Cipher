import type { ReactNode } from 'react';
import { Warning } from '@phosphor-icons/react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Modal open={open} onClose={busy ? () => undefined : onCancel} size="sm">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Warning className={`h-5 w-5 shrink-0 ${destructive ? 'text-rose-500' : 'text-amber-500'}`} />
          <p className="text-sm leading-6 text-ink dark:text-paper">{message}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
