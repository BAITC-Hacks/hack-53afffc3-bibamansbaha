'use client';

import { useEffect } from 'react';
import type { AppState } from '@/shared/types';

export function isEmbedEvent(data: unknown, type: string): boolean {
  return !!data && typeof data === 'object' && !Array.isArray(data)
    && Object.keys(data).length === 1 && (data as { type?: unknown }).type === type;
}

export function useEmbedEvents(state: AppState | null | undefined) {
  const revision = state?.cart.revision;
  const updatedAt = state?.cart.updatedAt;
  useEffect(() => {
    if (window.parent !== window && updatedAt) {
      // Notification only: the parent retrieves cart facts from its own server request.
      window.parent.postMessage({ type: 'ekt:cart-changed' }, window.location.origin);
    }
  }, [revision, updatedAt]);
  useEffect(() => {
    if (window.parent === window) return;
    const controls = () => Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]'))
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    const notify = (type: string) => window.parent.postMessage({ type }, window.location.origin);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); notify('ekt:close'); }
      if (event.key === 'Tab') {
        const items = controls();
        if ((event.shiftKey && document.activeElement === items[0]) || (!event.shiftKey && document.activeElement === items.at(-1))) {
          event.preventDefault(); notify('ekt:focus-close');
        }
      }
    };
    const message = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const first = isEmbedEvent(event.data, 'ekt:focus-first');
      if (!first && !isEmbedEvent(event.data, 'ekt:focus-last')) return;
      const items = controls();
      const target = first ? items[0] : items.at(-1);
      target?.focus();
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('message', message);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('message', message); };
  }, []);
}
