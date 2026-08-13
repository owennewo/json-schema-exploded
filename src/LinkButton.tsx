import { useState } from 'react';
import { shareLinkNow } from './deepLink';

/**
 * Drawn rather than typed. The chrome's other icons are characters, and they
 * depend on the font having them — which is a bet that comes off for `⧉` and
 * `▾` and not for a chain link, where the coverage is patchy and the fallback
 * is an empty box. `currentColor`, so it inherits whatever state the button
 * it sits in is in.
 */
export function LinkGlyph() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M6.6 9.4a3 3 0 0 0 4.3 0l1.9-2a3 3 0 0 0-4.3-4.2l-.7.7" />
      <path d="M9.4 6.6a3 3 0 0 0-4.3 0l-1.9 2a3 3 0 0 0 4.3 4.2l.7-.7" />
    </svg>
  );
}

/** clipboard write with a ✓ that fades — the clipboard is silent otherwise */
export async function copyText(text: string, flag: (on: boolean) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    flag(true);
    setTimeout(() => flag(false), 1200);
  } catch {
    /* clipboard unavailable (insecure origin, denied permission) */
  }
}

/**
 * Copy a link to the current view. `anchorId` overrides the anchor, which is
 * what puts one of these on a card header: the link points at that card
 * whether or not it is the thing currently selected.
 */
export function LinkButton({
  anchorId,
  className = 'icon-btn',
  title = 'copy a link to this view — schema, anchor, focus and depth',
}: {
  anchorId?: string;
  className?: string;
  title?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      title={title}
      onClick={(ev) => {
        // on a card, the click would otherwise also select the card — which
        // is a different anchor from the one the link was asked for
        ev.stopPropagation();
        void copyText(shareLinkNow(anchorId), setDone);
      }}
    >
      {done ? '✓' : <LinkGlyph />}
    </button>
  );
}
