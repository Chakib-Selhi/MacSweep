import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  /** Escape closes the dialog only when cancelling is allowed (never during a clean). */
  canCancel: boolean;
  onCancel: () => void;
  testId: string;
  children: ReactNode;
}

/** A native modal <dialog>: it traps focus and blocks the page behind it. */
export function Dialog({ open, title, canCancel, onCancel, testId, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (canCancel) onCancel();
      }}
      className="m-auto w-[34rem] max-w-[90vw] rounded-xl bg-white p-6 text-neutral-900 shadow-2xl backdrop:bg-black/40 dark:bg-neutral-900 dark:text-neutral-100"
    >
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
