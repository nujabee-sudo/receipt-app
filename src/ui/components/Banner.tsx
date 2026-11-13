import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Banner({ children, to, tone = 'warn' }: { children: ReactNode; to?: string; tone?: 'warn' | 'info' }) {
  const body = <span>{children}</span>;
  return (
    <div className={`banner banner-${tone}`} role="status">
      {to ? <Link to={to}>{body} ›</Link> : body}
    </div>
  );
}
