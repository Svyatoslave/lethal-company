export type App = 'admin' | 'operator' | 'crew' | 'observer';

const key = (app: App) => `olnr.${app}.token`;
const memory = new Map<App, string>();

export function tokenOf(app: App): string | null {
  try {
    return localStorage.getItem(key(app)) ?? memory.get(app) ?? null;
  } catch {
    return memory.get(app) ?? null;
  }
}
export function setToken(app: App, token: string) {
  memory.set(app, token);
  try {
    localStorage.setItem(key(app), token);
  } catch {
    /* private mode: the session lives only in memory for this tab */
  }
}
export function clearToken(app: App) {
  memory.delete(app);
  try {
    localStorage.removeItem(key(app));
  } catch {
    /* ignore */
  }
}

export function pref(name: string, fallback: string): string {
  try {
    return localStorage.getItem(`olnr.pref.${name}`) ?? fallback;
  } catch {
    return fallback;
  }
}
export function setPref(name: string, value: string) {
  try {
    localStorage.setItem(`olnr.pref.${name}`, value);
  } catch {
    /* ignore */
  }
}
