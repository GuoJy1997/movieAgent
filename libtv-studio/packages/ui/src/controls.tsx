import { Icon } from './icons.tsx';
import { Children, cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';
export function Button({
  tone = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return <button type="button" className={`button ${tone} ${className}`} {...props} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {Children.map(children, child => isValidElement<{ 'aria-label'?: string }>(child) && ['input','select','textarea'].includes(String(child.type)) ? cloneElement(child, { 'aria-label': child.props['aria-label'] ?? label }) : child)}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Badge({ children, warning = false }: { children: ReactNode; warning?: boolean }) {
  return <span className={`badge ${warning ? 'warning' : ''}`}>{children}</span>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true">
        <Icon name="canvas" size={32} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function QueryState({ loading, error }: { loading: boolean; error: Error | null }) {
  return error ? (
    <div role="alert" className="alert">
      {error.message}
    </div>
  ) : loading ? (
    <div className="loading" role="status">
      正在读取资料库…
    </div>
  ) : null;
}
