declare global {
  interface Window {
    __articleAiRefreshes?: number;
  }
}

const router = {
  refresh() {
    window.__articleAiRefreshes = (window.__articleAiRefreshes ?? 0) + 1;
    window.dispatchEvent(new Event("article-ai-router-refresh"));
  },
};

export const useRouter = () => router;
