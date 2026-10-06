import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zipFiles } from '../js/io/zip.js';

const enc = new TextEncoder();

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip archive has consistent headers and stored data', async () => {
  const files = [
    { name: 'plan.dxf', data: enc.encode('0\r\nSECTION\r\n0\r\nEOF\r\n') },
    { name: 'model.obj', data: enc.encode('v 0 0 0\n') },
  ];
  const blob = zipFiles(files, new Date(2026, 9, 6, 12, 30, 10));
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const endAt = buf.length - 22;
  assert.equal(view.getUint32(endAt, true), 0x06054b50);
  assert.equal(view.getUint16(endAt + 10, true), 2);
  const centralSize = view.getUint32(endAt + 12, true);
  const centralAt = view.getUint32(endAt + 16, true);
  assert.equal(centralAt + centralSize, endAt);

  let p = centralAt;
  for (const f of files) {
    assert.equal(view.getUint32(p, true), 0x02014b50);
    const nameLen = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    assert.equal(name, f.name);
    const local = view.getUint32(p + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint32(local + 14, true), crc32(f.data));
    const size = view.getUint32(local + 18, true);
    const dataAt = local + 30 + view.getUint16(local + 26, true);
    assert.deepEqual(buf.subarray(dataAt, dataAt + size), f.data);
    p += 46 + nameLen;
  }
});
