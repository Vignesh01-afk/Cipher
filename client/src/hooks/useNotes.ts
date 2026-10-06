import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  decryptOwnNotes,
  decryptSharedNotes,
  sortNotesByUpdated,
  type DecryptedNote,
} from '../lib/notes';

export interface DecryptedNotesState {
  loading: boolean;
  error: string | null;
  notes: DecryptedNote[];
  /** Notes whose ciphertext could not be decrypted (for example after tampering). */
  failedNoteIds: string[];
  reload: () => Promise<void>;
}

function useDecryptedNotes(
  load: (session: NonNullable<ReturnType<typeof useAuth>['keys']>) => Promise<{
    notes: DecryptedNote[];
    failedNoteIds: string[];
  }>,
): DecryptedNotesState {
  const { keys, status } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<DecryptedNote[]>([]);
  const [failedNoteIds, setFailedNoteIds] = useState<string[]>([]);
  const requestId = useRef(0);

  const run = useCallback(async () => {
    if (!keys) return;

    requestId.current += 1;
    const currentRequest = requestId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await load(keys);
      if (requestId.current !== currentRequest) return;
      setNotes(sortNotesByUpdated(result.notes));
      setFailedNoteIds(result.failedNoteIds);
    } catch (loadError) {
      if (requestId.current !== currentRequest) return;
      setNotes([]);
      setError(loadError instanceof Error ? loadError.message : 'Could not load your notes.');
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [keys, load]);

  useEffect(() => {
    if (status !== 'unlocked' || !keys) {
      // Loading state remains true while the vault is locked so pages show a
      // loader rather than a misleading empty state.
      if (status !== 'unlocked') setLoading(status !== 'anonymous');
      return;
    }
    void run();
  }, [status, keys, run]);

  return { loading, error, notes, failedNoteIds, reload: run };
}

/**
 * Walks every page of a cursor-paginated endpoint.
 *
 * The pages are small (50 by default), so the whole list is fetched up front -
 * the brief note list is decrypted and searched locally anyway, and partial
 * pagination would silently hide notes from local search. The page cap keeps a
 * misbehaving cursor from looping forever.
 */
async function fetchAllPages<TItem>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; nextCursor: string | null }>,
): Promise<TItem[]> {
  const MAX_PAGES = 100;
  const items: TItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (!result.nextCursor) return items;
    cursor = result.nextCursor;
  }

  return items;
}

/** The current user's own notes, decrypted locally with the master key. */
export function useOwnNotes(): DecryptedNotesState {
  const loader = useCallback(
    async (session: NonNullable<ReturnType<typeof useAuth>['keys']>) => {
      const remote = await fetchAllPages(async (cursor) => {
        const page = await api.listNotes({ cursor });
        return { items: page.notes, nextCursor: page.nextCursor };
      });
      return decryptOwnNotes(remote, session);
    },
    [],
  );

  return useDecryptedNotes(loader);
}

/** Notes other users have shared with the current user, decrypted with the private key. */
export function useSharedNotes(): DecryptedNotesState {
  const loader = useCallback(
    async (session: NonNullable<ReturnType<typeof useAuth>['keys']>) => {
      const remote = await fetchAllPages(async (cursor) => {
        const page = await api.listSharedWithMe({ cursor });
        return { items: page.shares, nextCursor: page.nextCursor };
      });
      return decryptSharedNotes(remote, session);
    },
    [],
  );

  return useDecryptedNotes(loader);
}
