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

/** The current user's own notes, decrypted locally with the master key. */
export function useOwnNotes(): DecryptedNotesState {
  const loader = useCallback(
    async (session: NonNullable<ReturnType<typeof useAuth>['keys']>) => {
      const remote = await api.listNotes();
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
      const remote = await api.listSharedWithMe();
      return decryptSharedNotes(remote, session);
    },
    [],
  );

  return useDecryptedNotes(loader);
}
