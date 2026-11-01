"use client";

import { buttonClass, type Variant } from "./styles";
export { buttonClass };

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export function Button({ variant = "primary", loading, className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={buttonClass(variant, className)}>
      {loading ? "Please wait…" : children}
    </button>
  );
}

const inputCls =
  "block w-full rounded-sm border-2 border-line bg-white px-3 py-2.5 text-base text-ink placeholder:text-muted/70 focus:border-navy aria-[invalid=true]:border-danger";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return <Field label={label} error={error} hint={hint}>{(p) => <input {...rest} {...p} className={`${inputCls} ${rest.className ?? ""}`} />}</Field>;
}

export function TextArea({ label, error, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  return <Field label={label} error={error} hint={hint}>{(p) => <textarea rows={4} {...rest} {...p} className={`${inputCls} ${rest.className ?? ""}`} />}</Field>;
}

export function SelectField({ label, error, hint, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  return <Field label={label} error={error} hint={hint}>{(p) => <select {...rest} {...p} className={`${inputCls} ${rest.className ?? ""}`}>{children}</select>}</Field>;
}

export function Alert({ tone = "error", children, title }: { tone?: "error" | "success" | "info" | "warn"; children: ReactNode; title?: string }) {
  const tones = {
    error: "border-danger bg-danger-soft text-danger",
    success: "border-ok bg-ok-soft text-ok",
    info: "border-navy bg-sand text-ink",
    warn: "border-clay bg-warn-soft text-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`border-l-4 px-4 py-3 text-[0.95rem] ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="py-10 text-muted">
      {label}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-2 border-dashed border-line px-6 py-10 text-center">
      <p className="font-serif text-xl">{title}</p>
      {children && <div className="mt-2 text-muted">{children}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-line bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function PageHeader({ title, children, lead }: { title: string; lead?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-muted">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-sand text-ink",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-clay",
  bad: "bg-danger-soft text-danger",
  info: "bg-navy text-white",
};
export function Badge({ tone = "neutral", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${badgeTones[tone]}`}>{children}</span>;
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-3 w-full bg-sand">
      <div className="h-full bg-navy" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Native <dialog>: focus is trapped and Escape closes it without extra code. */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const programmatic = useRef(false);
  // The cleanup also runs when Next hides a cached route, which would otherwise leave a hidden modal
  // blocking the whole document.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    return () => {
      if (d.open) {
        programmatic.current = true;
        d.close();
      }
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (programmatic.current) programmatic.current = false;
        else onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(92vw,34rem)] border-2 border-navy bg-card p-0 text-ink"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="mb-4 text-2xl">
            {title}
          </h2>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-muted">{body}</div>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Responsive table: scrolls horizontally on small screens instead of squeezing columns. */
export function Table({ head, children, caption }: { head: string[]; children: ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto border border-line bg-card">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-sand">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
