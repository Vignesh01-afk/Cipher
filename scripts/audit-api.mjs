/**
 * CipherNote API audit harness (read-only against the running dev API).
 *
 * Exercises auth, authorization/IDOR, notes, sharing, revocation, chat, files
 * and input validation against http://localhost:4000. It creates throwaway
 * users (audit-*@example.com) and prints PASS/FAIL for each check.
 */
const B = process.env.API_BASE ?? 'http://localhost:4000/api';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

const b64 = (n) => Buffer.alloc(n).toString('base64');

async function call(path, { method = 'GET', token, body, raw } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${B}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

function keyMaterial() {
  return {
    publicKey: b64(294),
    wrappedPrivateKey: b64(1200),
    privateKeyIv: b64(12),
    kdfSalt: b64(16),
    kdfIterations: 210000,
    wrappedMasterKey: b64(60),
    masterKeyIv: b64(12),
    masterKeyRaw: b64(32),
  };
}

async function register(prefix, password = 'AuditPass123!') {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const res = await call('/auth/register', {
    method: 'POST',
    body: { email, displayName: `${prefix} User`, password, ...keyMaterial() },
  });
  return { email, password, res, token: res.json?.token, user: res.json?.user };
}

function notePayload(ciphertext = b64(64)) {
  return {
    ciphertext,
    iv: b64(12),
    encryptionVersion: 1,
    algorithm: 'AES-GCM-256',
    payloadBytes: 48,
    wrappedNoteKey: b64(60),
    noteKeyIv: b64(12),
  };
}

async function main() {
  console.log(`\nCipherNote API audit against ${B}\n`);

  // ---------- Phase 4: authentication ----------
  console.log('== Authentication ==');
  const alice = await register('audit-alice');
  const bob = await register('audit-bob');
  check('register Alice -> 201', alice.res.status === 201, `got ${alice.res.status}`);
  check('register Bob -> 201', bob.res.status === 201, `got ${bob.res.status}`);
  check('register response omits passwordHash', !alice.res.text.includes('passwordHash'));
  check('register returns cipherId', typeof alice.user?.cipherId === 'string');

  const dup = await call('/auth/register', {
    method: 'POST',
    body: { email: alice.email, displayName: 'Dup', password: 'AuditPass123!', ...keyMaterial() },
  });
  check('duplicate register -> 409 EMAIL_TAKEN', dup.status === 409 && dup.json?.code === 'EMAIL_TAKEN', `${dup.status} ${dup.json?.code}`);

  const wrongPass = await call('/auth/login', { method: 'POST', body: { email: alice.email, password: 'WrongPass123!' } });
  check('login wrong password -> 401', wrongPass.status === 401, `got ${wrongPass.status}`);
  const wrongEmail = await call('/auth/login', { method: 'POST', body: { email: `nobody-${Date.now()}@example.com`, password: 'AuditPass123!' } });
  check('login unknown email -> 401', wrongEmail.status === 401, `got ${wrongEmail.status}`);
  const emptyLogin = await call('/auth/login', { method: 'POST', body: {} });
  check('login empty body -> 400', emptyLogin.status === 400, `got ${emptyLogin.status}`);
  const badEmail = await call('/auth/login', { method: 'POST', body: { email: 'not-an-email', password: 'x' } });
  check('login invalid email -> 400', badEmail.status === 400, `got ${badEmail.status}`);

  const weak = await call('/auth/register', {
    method: 'POST',
    body: { email: `weak-${Date.now()}@example.com`, displayName: 'W', password: 'short', ...keyMaterial() },
  });
  check('register weak password -> 400', weak.status === 400, `got ${weak.status}`);

  const goodLogin = await call('/auth/login', { method: 'POST', body: { email: alice.email, password: alice.password } });
  check('login correct -> 200 + token', goodLogin.status === 200 && Boolean(goodLogin.json?.token), `got ${goodLogin.status}`);

  const meNoToken = await call('/auth/me');
  check('GET /auth/me without token -> 401', meNoToken.status === 401, `got ${meNoToken.status}`);
  const meBadToken = await call('/auth/me', { token: 'garbage.token.value' });
  check('GET /auth/me invalid token -> 401', meBadToken.status === 401, `got ${meBadToken.status}`);
  const meTampered = await call('/auth/me', { token: `${alice.token}x` });
  check('GET /auth/me tampered token -> 401', meTampered.status === 401, `got ${meTampered.status}`);
  const meOk = await call('/auth/me', { token: alice.token });
  check('GET /auth/me valid -> 200', meOk.status === 200, `got ${meOk.status}`);
  check('/auth/me omits passwordHash', !meOk.text.includes('passwordHash'));

  // ---------- Phase 7/12: notes CRUD + validation ----------
  console.log('\n== Notes CRUD & validation ==');
  const noAuthNotes = await call('/notes');
  check('GET /notes without token -> 401', noAuthNotes.status === 401, `got ${noAuthNotes.status}`);

  const created = await call('/notes', { method: 'POST', token: alice.token, body: notePayload() });
  check('Alice create note -> 201', created.status === 201, `got ${created.status} ${created.text.slice(0, 120)}`);
  const noteId = created.json?.note?.id;
  check('created note has id', Boolean(noteId));

  const badNote = await call('/notes', { method: 'POST', token: alice.token, body: { ciphertext: 'not base64!!' } });
  check('create note invalid payload -> 400', badNote.status === 400, `got ${badNote.status}`);
  const emptyPatch = await call(`/notes/${noteId}`, { method: 'PATCH', token: alice.token, body: {} });
  check('empty PATCH -> 400', emptyPatch.status === 400, `got ${emptyPatch.status}`);
  const missingNote = await call('/notes/does-not-exist-xyz', { token: alice.token });
  check('GET nonexistent note -> 404', missingNote.status === 404, `got ${missingNote.status}`);

  const listNotes = await call('/notes', { token: alice.token });
  check('GET /notes -> 200 list contains note', listNotes.status === 200 && listNotes.json.notes.some((n) => n.id === noteId));

  const patched = await call(`/notes/${noteId}`, { method: 'PATCH', token: alice.token, body: { ciphertext: b64(80), iv: b64(12), payloadBytes: 60 } });
  check('owner PATCH note -> 200', patched.status === 200, `got ${patched.status}`);

  // ---------- Phase 5: authorization / IDOR ----------
  console.log('\n== Authorization / IDOR ==');
  const bobGet = await call(`/notes/${noteId}`, { token: bob.token });
  check('Bob GET Alice note -> 403', bobGet.status === 403, `got ${bobGet.status}`);
  const bobPatch = await call(`/notes/${noteId}`, { method: 'PATCH', token: bob.token, body: { ciphertext: b64(64) } });
  check('Bob PATCH Alice note -> 403', bobPatch.status === 403, `got ${bobPatch.status}`);
  const bobDelete = await call(`/notes/${noteId}`, { method: 'DELETE', token: bob.token });
  check('Bob DELETE Alice note -> 403', bobDelete.status === 403, `got ${bobDelete.status}`);
  const bobShares = await call(`/notes/${noteId}/shares`, { token: bob.token });
  check('Bob list Alice shares -> 403', bobShares.status === 403, `got ${bobShares.status}`);
  const bobCreateShare = await call(`/notes/${noteId}/shares`, { method: 'POST', token: bob.token, body: { userId: alice.user.id, wrappedKey: b64(256) } });
  check('Bob create share on Alice note -> 403', bobCreateShare.status === 403, `got ${bobCreateShare.status}`);
  const bobRevoke = await call(`/notes/${noteId}/shares/${alice.user.id}`, { method: 'DELETE', token: bob.token });
  check('Bob revoke on Alice note -> 403', bobRevoke.status === 403, `got ${bobRevoke.status}`);

  const selfShare = await call(`/notes/${noteId}/shares`, { method: 'POST', token: alice.token, body: { userId: alice.user.id, wrappedKey: b64(256) } });
  check('self-share -> 400', selfShare.status === 400, `got ${selfShare.status}`);
  const ghostShare = await call(`/notes/${noteId}/shares`, { method: 'POST', token: alice.token, body: { userId: 'ghost-user-id', wrappedKey: b64(256) } });
  check('share with nonexistent user -> 404', ghostShare.status === 404, `got ${ghostShare.status}`);

  // ---------- Phase 9: sharing + revocation ----------
  console.log('\n== Sharing & revocation ==');
  const share = await call(`/notes/${noteId}/shares`, { method: 'POST', token: alice.token, body: { userId: bob.user.id, wrappedKey: b64(256) } });
  check('Alice shares with Bob -> 201', share.status === 201, `got ${share.status} ${share.text.slice(0, 120)}`);

  const bobGetAfterShare = await call(`/notes/${noteId}`, { token: bob.token });
  check('Bob GET shared note -> 200', bobGetAfterShare.status === 200, `got ${bobGetAfterShare.status}`);
  check('shared note exposes wrappedKey to Bob', Boolean(bobGetAfterShare.json?.note?.wrappedKey));
  check('shared note hides owner wrappedNoteKey from Bob', bobGetAfterShare.json?.note?.wrappedNoteKey === null);

  const bobSharedList = await call('/shared', { token: bob.token });
  check('Bob /shared contains note', bobSharedList.status === 200 && bobSharedList.json.shares.some((s) => s.noteId === noteId));

  const dupShare = await call(`/notes/${noteId}/shares`, { method: 'POST', token: alice.token, body: { userId: bob.user.id, wrappedKey: b64(256) } });
  check('duplicate share upserts -> 201', dupShare.status === 201, `got ${dupShare.status}`);

  const revoke = await call(`/notes/${noteId}/shares/${bob.user.id}`, { method: 'DELETE', token: alice.token });
  check('Alice revokes Bob -> 200', revoke.status === 200, `got ${revoke.status}`);
  const bobGetAfterRevoke = await call(`/notes/${noteId}`, { token: bob.token });
  check('Bob GET after revoke -> 403', bobGetAfterRevoke.status === 403, `got ${bobGetAfterRevoke.status}`);
  const bobSharedAfter = await call('/shared', { token: bob.token });
  check('Bob /shared empty after revoke', bobSharedAfter.status === 200 && !bobSharedAfter.json.shares.some((s) => s.noteId === noteId));
  const revokeAgain = await call(`/notes/${noteId}/shares/${bob.user.id}`, { method: 'DELETE', token: alice.token });
  check('revoke twice -> 409', revokeAgain.status === 409, `got ${revokeAgain.status}`);
  const revokeOwner = await call(`/notes/${noteId}/shares/${alice.user.id}`, { method: 'DELETE', token: alice.token });
  check('revoke owner -> 400', revokeOwner.status === 400, `got ${revokeOwner.status}`);

  // Re-share restores access
  const reshare = await call(`/notes/${noteId}/shares`, { method: 'POST', token: alice.token, body: { userId: bob.user.id, wrappedKey: b64(256) } });
  check('re-share after revoke -> 201', reshare.status === 201, `got ${reshare.status}`);
  const bobGetReshare = await call(`/notes/${noteId}`, { token: bob.token });
  check('Bob access restored -> 200', bobGetRehareStatus(bobGetReshare), `got ${bobGetReshare.status}`);

  // ---------- Phase 10: chat ----------
  console.log('\n== Chat ==');
  const convo = await call('/chat/conversations', {
    method: 'POST',
    token: alice.token,
    body: { recipientId: bob.user.id, wrappedKeys: { [alice.user.id]: b64(256), [bob.user.id]: b64(256) } },
  });
  check('start conversation -> 201', convo.status === 201, `got ${convo.status} ${convo.text.slice(0, 120)}`);
  const convoId = convo.json?.conversation?.id;
  check('conversation has id', Boolean(convoId));

  const selfConvo = await call('/chat/conversations', { method: 'POST', token: alice.token, body: { recipientId: alice.user.id, wrappedKeys: {} } });
  check('self conversation -> 400', selfConvo.status === 400, `got ${selfConvo.status}`);

  const msg = await call(`/chat/conversations/${convoId}/messages`, {
    method: 'POST',
    token: alice.token,
    body: { ciphertext: b64(48), iv: b64(12), clientId: `client-${Date.now()}`, payloadBytes: 40 },
  });
  check('send message -> 201', msg.status === 201, `got ${msg.status} ${msg.text.slice(0, 120)}`);

  const bobMsgs = await call(`/chat/conversations/${convoId}/messages`, { token: bob.token });
  check('Bob reads conversation messages -> 200', bobMsgs.status === 200, `got ${bobMsgs.status}`);

  const outsider = await register('audit-carol');
  const carolRead = await call(`/chat/conversations/${convoId}/messages`, { token: outsider.token });
  check('non-member reads conversation -> 403', carolRead.status === 403, `got ${carolRead.status}`);
  const carolSend = await call(`/chat/conversations/${convoId}/messages`, { method: 'POST', token: outsider.token, body: { ciphertext: b64(48), iv: b64(12), clientId: `x-${Date.now()}`, payloadBytes: 40 } });
  check('non-member sends to conversation -> 403', carolSend.status === 403, `got ${carolSend.status}`);

  const badMsg = await call(`/chat/conversations/${convoId}/messages`, { method: 'POST', token: alice.token, body: { ciphertext: b64(48) } });
  check('send malformed message -> 400', badMsg.status === 400, `got ${badMsg.status}`);

  // ---------- Phase 11: files ----------
  console.log('\n== Files ==');
  const privateNote = await call('/notes', { method: 'POST', token: alice.token, body: notePayload() });
  const privateNoteId = privateNote.json?.note?.id;
  check('Alice creates a second (never-shared) note', privateNote.status === 201, `got ${privateNote.status}`);
  const file = await call('/files', {
    method: 'POST',
    token: alice.token,
    body: {
      noteId: privateNoteId,
      filename: 'audit.txt',
      mimeType: 'text/plain',
      plaintextBytes: 12,
      ciphertext: b64(48),
      fileIv: b64(12),
      encryptionVersion: 1,
      algorithm: 'AES-GCM-256',
      wrappedFileKey: b64(60),
      fileKeyIv: b64(12),
      wrappedForNoteKey: b64(60),
      noteKeyWrapIv: b64(12),
    },
  });
  check('Alice upload file -> 201', file.status === 201, `got ${file.status} ${file.text.slice(0, 140)}`);
  const fileId = file.json?.file?.id;

  const bobFile = await call(`/files/${fileId}`, { token: bob.token });
  check('Bob (no share) file meta -> 403', bobFile.status === 403, `got ${bobFile.status}`);
  const bobFileContent = await call(`/files/${fileId}/content`, { token: bob.token });
  check('Bob (no share) file content -> 403', bobFileContent.status === 403, `got ${bobFileContent.status}`);
  const carolFile = await call(`/files/${fileId}/content`, { token: outsider.token });
  check('Carol (no share) file content -> 403', carolFile.status === 403, `got ${carolFile.status}`);
  const aliceFileContent = await call(`/files/${fileId}/content`, { token: alice.token });
  check('Alice file content -> 200', aliceFileContent.status === 200, `got ${aliceFileContent.status}`);

  // Share the note with Bob, then Bob should reach the attached file.
  await call(`/notes/${privateNoteId}/shares`, { method: 'POST', token: alice.token, body: { userId: bob.user.id, wrappedKey: b64(256) } });
  const bobFileShared = await call(`/files/${fileId}/content`, { token: bob.token });
  check('Bob (shared note) file content -> 200', bobFileShared.status === 200, `got ${bobFileShared.status}`);
  await call(`/notes/${privateNoteId}/shares/${bob.user.id}`, { method: 'DELETE', token: alice.token });
  const bobFileRevoked = await call(`/files/${fileId}/content`, { token: bob.token });
  check('Bob (revoked) file content -> 403', bobFileRevoked.status === 403, `got ${bobFileRevoked.status}`);

  const traversal = await call('/files/..%2F..%2Fetc%2Fpasswd', { token: alice.token });
  check('path-traversal file id -> 404/400', traversal.status === 404 || traversal.status === 400, `got ${traversal.status}`);

  const ghostFile = await call('/files/ghost-file-id/content', { token: alice.token });
  check('nonexistent file -> 404', ghostFile.status === 404, `got ${ghostFile.status}`);

  // ---------- Phase 12: misc API ----------
  console.log('\n== Misc API / validation ==');
  const malformed = await call('/auth/login', { method: 'POST', raw: '{not json' });
  check('malformed JSON -> 400', malformed.status === 400, `got ${malformed.status}`);
  const unknownRoute = await call('/does/not/exist', { token: alice.token });
  check('unknown API route -> 404', unknownRoute.status === 404, `got ${unknownRoute.status}`);
  const badAudit = await call('/audit?action=NOT_A_REAL_ACTION', { token: alice.token });
  check('unknown audit action -> 400', badAudit.status === 400, `got ${badAudit.status}`);
  const auditOk = await call('/audit', { token: alice.token });
  check('GET /audit -> 200', auditOk.status === 200, `got ${auditOk.status}`);
  const carolAudit = await call('/audit', { token: outsider.token });
  check('audit logs are per-user (Carol sees no Alice events)', carolAudit.status === 200 && !carolAudit.json.logs.some((l) => l.targetId === noteId));
  const lookupBad = await call('/users/lookup?email=nope', { token: alice.token });
  check('users lookup invalid email -> 400', lookupBad.status === 400, `got ${lookupBad.status}`);

  // CORS: disallowed origin should be rejected (no ACAO header)
  const cors = await fetch(`${B}/health`, { headers: { Origin: 'http://evil.example.com' } });
  check('CORS blocks unknown origin', cors.headers.get('access-control-allow-origin') === null, `ACAO=${cors.headers.get('access-control-allow-origin')}`);

  console.log(`\n===== API AUDIT: ${passed} passed, ${failed} failed =====`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(` - ${f}`);
  }
}

function bobGetRehareStatus(res) {
  return res.status === 200;
}

main().catch((error) => {
  console.error('Audit harness crashed:', error);
  process.exit(1);
});
