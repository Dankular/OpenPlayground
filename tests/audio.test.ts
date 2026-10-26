import { describe, expect, it } from 'vitest';
import { resolveAudioReference, type AudioIndex } from '../src/systems/audio';
describe('audio asset identity', () => {
  const index: AudioIndex = { schemaVersion: 1, byId: {
    'sharedassets0.assets:4': { name: 'a', url: '/a.wav' },
    'resources.assets:4': { name: 'b', url: '/b.wav' },
  } };
  it('does not conflate equal path IDs from different source files', () => {
    const pointer = { m_FileID: 0, m_PathID: 4 };
    expect(resolveAudioReference(index, 'sharedassets0.assets', pointer)?.name).toBe('a');
    expect(resolveAudioReference(index, 'resources.assets', pointer)?.name).toBe('b');
    expect(resolveAudioReference(index, 'other.assets', pointer)).toBeUndefined();
  });
  it('does not silently resolve unbound external files or null references', () => {
    expect(resolveAudioReference(index, 'sharedassets0.assets', { m_FileID: 1, m_PathID: 4 })).toBeUndefined();
    expect(resolveAudioReference(index, 'sharedassets0.assets', { m_FileID: 0, m_PathID: 0 })).toBeUndefined();
  });
});
