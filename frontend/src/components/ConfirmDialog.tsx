import React from 'react';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Body text; newlines are rendered (whitespace-pre-line). */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red confirm button (destructive), warning = amber, default = blue */
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

const CONFIRM_STYLES: Record<NonNullable<ConfirmDialogProps['variant']>, string> = {
  danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  warning: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-400',
  default: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
};

/**
 * Accessible replacement for window.confirm(): keyboard-dismissable, styled
 * per severity, and consistent across the app.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="flex items-center justify-center min-h-screen px-4 py-8">
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onCancel} />

        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm">
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 rounded-full p-2 ${
                variant === 'danger' ? 'bg-red-100 text-red-600' :
                variant === 'warning' ? 'bg-amber-100 text-amber-600' :
                'bg-blue-100 text-blue-600'
              }`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                <p className="mt-2 text-sm text-gray-600 whitespace-pre-line">{message}</p>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 rounded-b-lg flex justify-end gap-2">
            <button
              onClick={onCancel}
              autoFocus
              className="px-4 py-2 text-sm border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 ${CONFIRM_STYLES[variant]}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
