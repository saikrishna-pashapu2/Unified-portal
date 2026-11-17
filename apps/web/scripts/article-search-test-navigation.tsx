import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '');
  return new URLSearchParams(search);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => '/esg/articles');
}

const router = {
  push(href: string) {
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  replace(href: string) {
    window.history.replaceState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  },
  refresh() { window.dispatchEvent(new PopStateEvent('popstate')); },
  back() { window.history.back(); },
  prefetch() { return Promise.resolve(); },
};

export function useRouter() { return router; }

export default function TestLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    router.push(href);
  }} />;
}
