import type { HTMLAttributes, ReactNode } from "react";

type TypographyProps = HTMLAttributes<HTMLElement> & { children: ReactNode };
export function Eyebrow({ children, className, ...props }: TypographyProps) {
  return <p {...props} className={["eyebrow", className].filter(Boolean).join(" ")}>{children}</p>;
}
export function SectionTitle({ children, className, ...props }: TypographyProps) {
  return <h2 {...props} className={["section-title", className].filter(Boolean).join(" ")}>{children}</h2>;
}
