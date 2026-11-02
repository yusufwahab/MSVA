export type Variant = "primary" | "secondary" | "danger" | "quiet";

const base =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-[0.95rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-accent-bright text-on-accent hover:bg-accent",
  secondary: "border border-line-strong bg-transparent text-ink hover:border-accent-bright hover:text-accent-ink",
  danger: "bg-danger text-canvas hover:opacity-90",
  quiet: "px-3 text-accent-ink underline underline-offset-4 hover:bg-surface-2",
};

export const buttonClass = (v: Variant = "primary", extra = "") => `${base} ${variants[v]} ${extra}`;
