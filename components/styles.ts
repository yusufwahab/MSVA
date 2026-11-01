export type Variant = "primary" | "secondary" | "danger" | "quiet";

const base =
  "inline-flex min-h-11 items-center justify-center rounded-sm px-5 py-2.5 text-[0.95rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-navy text-white hover:bg-navy-deep",
  secondary: "border-2 border-navy bg-transparent text-navy hover:bg-sand",
  danger: "bg-danger text-white hover:bg-[#7d1717]",
  quiet: "text-navy underline underline-offset-4 hover:bg-sand",
};

export const buttonClass = (v: Variant = "primary", extra = "") => `${base} ${variants[v]} ${extra}`;

