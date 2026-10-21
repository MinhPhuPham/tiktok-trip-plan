/** localStorage that never throws (private mode, quota, disabled storage). */
export const storage = {
  read<T>(key: string, parse: (raw: unknown) => T | null): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw == null ? null : parse(JSON.parse(raw));
    } catch {
      return null;
    }
  },
  readText(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key: string, value: unknown): boolean {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  },
};
