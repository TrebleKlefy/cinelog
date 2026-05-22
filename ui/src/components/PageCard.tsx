import type { ReactNode } from "react";

export function PageCard({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="page-card">
      <header className="page-card__header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="page-card__actions">{actions}</div>}
      </header>
      <div className="page-card__content">{children}</div>
    </section>
  );
}
