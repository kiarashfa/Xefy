/**
 * The one way anything on this site remembers something. §8.1
 *
 * Three rules, and they are the same three for every feature: keys are
 * namespaced and versioned (`xefy.<feature>.v<n>`), every stored object carries
 * a `schema` integer that is checked rather than assumed, and every read and
 * write is wrapped because storage can simply not be there — a private window,
 * disabled cookies, a full quota, or a build running in Node with no `window`
 * at all.
 *
 * A feature that cannot read its own storage has to keep working and stop
 * remembering. It must never break the page, and it must never half-parse a
 * shape it does not recognise.
 */

export type ReadStatus =
  /** A stored value of the expected schema was found. */
  | 'ok'
  /** Nothing was stored. The ordinary first visit. */
  | 'empty'
  /** Something was stored under an unknown schema and was thrown away. */
  | 'discarded'
  /** Storage is not available at all. */
  | 'unavailable';

export interface StoredRead<T> {
  value: T | null;
  status: ReadStatus;
}

export interface VersionedStore<T extends object> {
  /** The full key, exposed so a feature can name it in a diagnostic. */
  readonly key: string;
  read(): StoredRead<T>;
  write(value: T): void;
  clear(): void;
}

/**
 * Storage is reached through this rather than directly, so that the absence of
 * `localStorage` — which is the normal case during a build — is a state the
 * code handles rather than an exception it throws.
 */
function backing(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function versionedStore<T extends object>(
  feature: string,
  version: number,
  schema: number,
): VersionedStore<T> {
  const key = `xefy.${feature}.v${version}`;

  return {
    key,

    read(): StoredRead<T> {
      const store = backing();
      if (!store) return { value: null, status: 'unavailable' };
      let raw: string | null;
      try {
        raw = store.getItem(key);
      } catch {
        return { value: null, status: 'unavailable' };
      }
      if (raw == null) return { value: null, status: 'empty' };

      try {
        const parsed = JSON.parse(raw) as { schema?: number } & T;
        // An unknown or newer schema is discarded whole. Reading the fields it
        // happens to share with this version would be a silent partial parse,
        // which is the failure this check exists to prevent.
        if (parsed?.schema !== schema) return { value: null, status: 'discarded' };
        return { value: parsed, status: 'ok' };
      } catch {
        return { value: null, status: 'discarded' };
      }
    },

    write(value: T): void {
      const store = backing();
      if (!store) return;
      try {
        store.setItem(key, JSON.stringify({ schema, ...value }));
      } catch {
        // Nothing to do and nothing worth saying: the feature still works for
        // the life of this page view, it just will not be there tomorrow.
      }
    },

    clear(): void {
      const store = backing();
      if (!store) return;
      try {
        store.removeItem(key);
      } catch {
        // As above.
      }
    },
  };
}

/**
 * The one-line notice §8.1 requires when a feature starts empty for a reason
 * other than "nothing was saved yet". Returns null when there is nothing worth
 * telling the reader.
 */
export function readNotice(status: ReadStatus): string | null {
  if (status === 'discarded') {
    return 'Something was saved here in an older format this version cannot read, so it has been cleared.';
  }
  if (status === 'unavailable') {
    return 'This browser is not allowing storage, so nothing here will be remembered after you leave.';
  }
  return null;
}
