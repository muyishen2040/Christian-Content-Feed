import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "quiet";
function buttonClass(variant: Variant, className?: string) {
  return ["ui-button", `ui-button--${variant}`, className].filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};
export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  return <button {...props} className={buttonClass(variant, className)} type={type} />;
}

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: Variant;
  children: ReactNode;
};
export function ButtonLink({ variant = "primary", className, ...props }: ButtonLinkProps) {
  return <a {...props} className={buttonClass(variant, className)} />;
}
