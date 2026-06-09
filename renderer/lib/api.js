// Thin accessor for the preload bridge. During Next.js static build there is
// no window, so we return a harmless stub; real calls happen in the browser.
export function api() {
  if (typeof window !== "undefined" && window.api) return window.api;
  return new Proxy(
    {},
    { get: () => async () => ({}) }
  );
}
