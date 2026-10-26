import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';

describe('production serving and asset transfer', () => {
  let child: ChildProcess, directory: string, base: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'openplayground-server-test-'));
    await mkdir(join(directory, 'dist')); await writeFile(join(directory, 'dist', 'index.html'), '<h1>OpenPlayground</h1>');
    child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0', DIST_DIR: join(directory, 'dist'), ASSET_DIR: join(directory, 'assets'), ASSET_UPLOAD_TOKEN: 'test-only-key' }, stdio: ['ignore', 'pipe', 'pipe'] });
    base = await new Promise<string>((done, fail) => { child.once('error', fail); child.stdout!.on('data', data => { const port = /ready on (\d+)/.exec(String(data)); if (port) done(`http://127.0.0.1:${port[1]}`); }); });
  });
  afterAll(async () => {
    child?.kill();
    if (child && child.exitCode === null) await new Promise(done => child.once('exit', done));
    const path = await realpath(directory), parent = await realpath(tmpdir());
    if (!path.startsWith(parent + sep) || !path.includes('openplayground-server-test-')) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  });
  it('serves the app and health probe and returns real 404s for missing assets', async () => {
    expect(await (await fetch(base)).text()).toContain('OpenPlayground');
    expect((await (await fetch(`${base}/healthz`)).json()).status).toBe('ok');
    expect((await fetch(`${base}/local-assets/missing.json`)).status).toBe(404);
  });
  it('requires authorization, validates the transfer hash and serves byte ranges', async () => {
    const bytes = Buffer.from('sample asset data'), hash = createHash('sha256').update(bytes).digest('hex');
    expect((await fetch(`${base}/_deploy/assets/a.wav`, { method: 'PUT', body: bytes })).status).toBe(404);
    const headers = { authorization: 'Bearer test-only-key', 'x-asset-sha256': hash };
    expect((await fetch(`${base}/_deploy/assets/a.wav`, { method: 'PUT', headers, body: bytes })).status).toBe(201);
    const range = await fetch(`${base}/local-assets/a.wav`, { headers: { range: 'bytes=0-5' } });
    expect(range.status).toBe(206); expect(await range.text()).toBe('sample'); expect(range.headers.get('content-type')).toBe('audio/wav');
    expect((await fetch(`${base}/_deploy/assets/b.wav`, { method: 'PUT', headers: { ...headers, 'x-asset-sha256': '0'.repeat(64) }, body: bytes })).status).toBe(400);
    expect((await fetch(`${base}/local-assets/b.wav`)).status).toBe(404);
  });
});
