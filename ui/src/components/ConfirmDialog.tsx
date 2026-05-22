import { useEffect, useId, type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";

/** Copy matched across Catalog, Collection, and movie views. */
export function RemoveFromCatalogCopy({ movieTitle }: { movieTitle: string }) {
  return (
    <>
      <p className="confirm-dialog__lede">
        Remove <span className="confirm-dialog__title-em">{formatFilmQuotes(movieTitle)}</span> from your catalog?
      </p>
      <p className="confirm-dialog__detail">
        It will disappear from Catalog and Collection, and your personal rating will be cleared. Import again from Search to restore.
      </p>
    </>
  );
}

export function RemoveFromShelfCopy({ movieTitle }: { movieTitle: string }) {
  return (
    <>
      <p className="confirm-dialog__lede">
        Remove <span className="confirm-dialog__title-em">{formatFilmQuotes(movieTitle)}</span> from your shelf only?
      </p>
      <p className="confirm-dialog__detail">The title stays in your catalog — only this shelf entry is removed.</p>
    </>
  );
}

function formatFilmQuotes(title: string): string {
  return `“${title}”`;
}

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Accessible modal layered above other overlays (e.g. movie quick view). Escape cancels using capture phase
 * so it does not close the underlying dialog first.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pending) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pending, onCancel]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => confirmBtnRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const ui = (
    <div className="confirm-dialog-root" role="presentation">
      <button type="button" className="confirm-dialog-backdrop" aria-label={cancelLabel} disabled={pending} onClick={() => !pending && onCancel()} />
      <div
        className="confirm-dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="visually-hidden">
          {title}
        </h2>
        <div className="confirm-dialog-body">{children}</div>
        <div className="confirm-dialog-actions">
          <button type="button" className="button button--secondary button--sm" disabled={pending} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`button button--sm${destructive ? " confirm-dialog__confirm-danger" : " button--gold"}`}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}
