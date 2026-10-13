/** Marks key moments in Microsoft Clarity so recordings can be filtered (e.g. only visits that reached a full tour). */
export function track(event: string, tag?: [string, string]) {
  try {
    const c = (window as any).clarity;
    if (typeof c !== 'function') return;
    c('event', event);
    if (tag) c('set', tag[0], tag[1]);
  } catch {
    /* tracking must never break the app */
  }
}
