import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A trigger button plus a floating panel. Used wherever this app would
 * otherwise reach for a native <select>: option lists render differently on
 * every OS, can't carry the captions the depth concept needs, and are the one
 * piece of chrome that never matched the tool's own visual language.
 *
 * Closes on outside pointerdown and on Escape — the Escape handler runs in
 * the capture phase and marks the event handled, because App binds Escape to
 * "clear the selection" and closing a popover must not also do that.
 */
export function Popover({
  className,
  panelClass,
  label,
  title,
  side = 'down',
  align = 'left',
  children,
}: {
  className?: string;
  /** extra class on the floating panel — sizing lives with the content */
  panelClass?: string;
  label: ReactNode;
  title?: string;
  side?: 'down' | 'up';
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: PointerEvent) => {
      if (!wrap.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="pop-wrap" ref={wrap}>
      <button
        className={className}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className={`pop pop-${side} pop-${align}${panelClass ? ` ${panelClass}` : ''}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
