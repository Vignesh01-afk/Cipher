import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFileMimeType, safePreviewBlobType, safePreviewKind } from './files';

/**
 * The MIME allowlist is the defence against stored XSS in file previews:
 * `file.mimeType` is uploader-controlled, so it must never select an
 * executable renderer (HTML, SVG, ...) in the app origin.
 */
describe('safePreviewKind', () => {
  test('allowlisted media types preview', () => {
    assert.equal(safePreviewKind('image/png'), 'image');
    assert.equal(safePreviewKind('image/jpeg'), 'image');
    assert.equal(safePreviewKind('image/gif'), 'image');
    assert.equal(safePreviewKind('image/webp'), 'image');
    assert.equal(safePreviewKind('video/mp4'), 'video');
    assert.equal(safePreviewKind('video/webm'), 'video');
    assert.equal(safePreviewKind('audio/mpeg'), 'audio');
    assert.equal(safePreviewKind('audio/flac'), 'audio');
    assert.equal(safePreviewKind('application/pdf'), 'pdf');
    assert.equal(safePreviewKind('text/plain'), 'text');
  });

  test('executable / script-bearing types are never previewable', () => {
    assert.equal(safePreviewKind('text/html'), 'none');
    assert.equal(safePreviewKind('application/xhtml+xml'), 'none');
    assert.equal(safePreviewKind('image/svg+xml'), 'none');
    assert.equal(safePreviewKind('text/javascript'), 'none');
    assert.equal(safePreviewKind('application/xml'), 'none');
    assert.equal(safePreviewKind('text/markdown'), 'none');
  });

  test('unknown, empty and parameterised types are handled', () => {
    assert.equal(safePreviewKind('application/octet-stream'), 'none');
    assert.equal(safePreviewKind(null), 'none');
    assert.equal(safePreviewKind(undefined), 'none');
    assert.equal(safePreviewKind(''), 'none');
    // Case and parameters are normalised before the lookup.
    assert.equal(safePreviewKind('TEXT/HTML'), 'none');
    assert.equal(safePreviewKind('text/plain; charset=utf-8'), 'text');
    assert.equal(safePreviewKind(' Image/PNG '), 'image');
  });

  test('non-allowlisted image/video variants fall through to none', () => {
    assert.equal(safePreviewKind('image/bmp'), 'none');
    assert.equal(safePreviewKind('video/quicktime'), 'none');
    assert.equal(safePreviewKind('audio/x-mpegurl'), 'audio'); // any audio/* is safe
  });
});

describe('safePreviewBlobType', () => {
  test('never emits an executable type from uploader metadata', () => {
    assert.equal(safePreviewBlobType('text/html'), 'application/octet-stream');
    assert.equal(safePreviewBlobType('image/svg+xml'), 'application/octet-stream');
    assert.equal(safePreviewBlobType('text/javascript'), 'application/octet-stream');
    assert.equal(safePreviewBlobType(null), 'application/octet-stream');
  });

  test('allowlisted types keep their (normalised) type', () => {
    assert.equal(safePreviewBlobType('image/png'), 'image/png');
    assert.equal(safePreviewBlobType('IMAGE/PNG'), 'image/png');
    assert.equal(safePreviewBlobType('video/mp4'), 'video/mp4');
    assert.equal(safePreviewBlobType('audio/ogg'), 'audio/ogg');
    assert.equal(safePreviewBlobType('text/plain'), 'text/plain');
  });
});

describe('normalizeFileMimeType', () => {
  test('disallowed types collapse to octet-stream at rest', () => {
    assert.equal(normalizeFileMimeType('text/html'), 'application/octet-stream');
    assert.equal(normalizeFileMimeType('image/svg+xml'), 'application/octet-stream');
    assert.equal(normalizeFileMimeType('application/zip'), 'application/octet-stream');
  });

  test('allowlisted types round-trip', () => {
    assert.equal(normalizeFileMimeType('image/png'), 'image/png');
    assert.equal(normalizeFileMimeType('text/plain'), 'text/plain');
    assert.equal(normalizeFileMimeType('application/pdf'), 'application/pdf');
  });
});
