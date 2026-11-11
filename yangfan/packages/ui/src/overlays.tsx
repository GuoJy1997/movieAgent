import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './controls.tsx';
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  dirty = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
  dirty?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirm, setConfirm] = useState(false);
  const close = () => (dirty ? setConfirm(true) : onClose());
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={wide ? 'dialog wide' : 'dialog'}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onSubmit={event => event.stopPropagation()}
      aria-label={title}
    >
      <header className="dialog-head">
        <h2>{title}</h2>
        <Button tone="quiet" aria-label="关闭对话框" onClick={close}>
          ×
        </Button>
      </header>
      <div className="dialog-body">
        {confirm ? (
          <div className="form-stack">
            <p>有未保存的修改，确定放弃吗？</p>
            <div className="dialog-actions">
              <Button autoFocus onClick={() => setConfirm(false)}>
                继续编辑
              </Button>
              <Button tone="danger" onClick={onClose}>
                放弃修改
              </Button>
            </div>
          </div>
        ) : (
          children
        )}
      </div>
    </dialog>, document.body
  );
}
