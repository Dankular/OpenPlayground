import type { Entity, Part } from '../simulation';
import type { SourceComponent } from '../prefabs';
import { sourceComponent } from './physical-world';

export interface AudioAsset { name: string; url: string; channels?: number; frequency?: number; duration?: number }
export interface AudioIndex { schemaVersion: 1; byId: Record<string, AudioAsset> }
export interface AudioPointer { m_FileID: number; m_PathID: number }
export function resolveAudioReference(index: AudioIndex, sourceFile: string, pointer: unknown): AudioAsset | undefined {
  const ref = pointer as AudioPointer | undefined;
  // A path ID alone never establishes cross-file identity. External references
  // need the extractor's resolved source, rather than a guess by clip name.
  if (!ref || ref.m_FileID !== 0 || !Number.isSafeInteger(ref.m_PathID) || ref.m_PathID === 0) return undefined;
  return index.byId[`${sourceFile}:${ref.m_PathID}`];
}
export async function loadAudioIndex(): Promise<AudioIndex | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}local-assets/audio-index.json`);
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null;
    const data = await response.json(); return data.schemaVersion === 1 && data.byId ? data : null;
  } catch { return null; }
}

/** On-demand original PCM assets, with pitch following simulation time scale. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private sources = new Set<AudioBufferSourceNode>();
  volume = 1;
  timeScale = 1;
  camera = { x: 0, y: 4, width: 20 };
  constructor(readonly index: AudioIndex | null, readonly options: { random?: () => number } = {}) {}
  unlock(): void {
    if (!this.index || typeof AudioContext === 'undefined') return;
    if (!this.context) { this.context = new AudioContext(); this.master = this.context.createGain(); this.master.connect(this.context.destination); }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }
  setTimeScale(value: number): void {
    this.timeScale = Math.max(0, value);
    if (this.context) for (const source of this.sources) source.playbackRate.setValueAtTime(this.timeScale, this.context.currentTime);
  }
  private async buffer(asset: AudioAsset): Promise<AudioBuffer> {
    let pending = this.buffers.get(asset.url);
    if (!pending) {
      pending = (async () => {
        const response = await fetch(`${import.meta.env.BASE_URL}${asset.url.replace(/^\//, '')}`);
        if (!response.ok) throw new Error(`Audio asset unavailable: ${asset.name}`);
        return this.context!.decodeAudioData(await response.arrayBuffer());
      })();
      this.buffers.set(asset.url, pending);
      pending.catch(() => this.buffers.delete(asset.url));
    }
    return pending;
  }
  play(pointer: unknown, sourceFile: string, options: { volume?: number; position?: { x: number; y: number } } = {}): void {
    if (!this.index) return;
    const asset = resolveAudioReference(this.index, sourceFile, pointer); if (!asset) return;
    this.unlock(); if (!this.context || !this.master) return;
    const context = this.context, master = this.master;
    void this.buffer(asset).then(buffer => {
      const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
      source.buffer = buffer; source.playbackRate.value = this.timeScale;
      const position = options.position;
      // Unity's scene listener/spatial rolloff is approximated by 2D stereo.
      const distance = position ? Math.hypot(position.x - this.camera.x, position.y - this.camera.y) : 0;
      gain.gain.value = Math.max(0, Math.min(1, options.volume ?? 1)) * this.volume / Math.max(1, distance / 15);
      pan.pan.value = position ? Math.max(-1, Math.min(1, (position.x - this.camera.x) / Math.max(1, this.camera.width / 2))) : 0;
      source.connect(gain); gain.connect(pan); pan.connect(master); this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
      source.start();
    }).catch(error => console.info('Audio playback unavailable.', error));
  }
  private pick(values: unknown): unknown {
    if (!Array.isArray(values) || !values.length) return undefined;
    return values[Math.min(values.length - 1, Math.floor((this.options.random ?? Math.random)() * values.length))];
  }
  firearm(entity: Entity, component: SourceComponent, firstShot: boolean): void {
    const clip = this.pick(component.data.ShotSounds); if (!clip) return;
    const file = (component as SourceComponent & { file?: string }).file ?? 'sharedassets0.assets';
    this.play(clip, file, { position: entity.parts[0]?.body.getPosition(), volume: Number(component.data.ShotVolume ?? 1) * (component.data.Automatic && !firstShot ? .5 : 1) });
  }
  impact(part: Part, impulse: number): void {
    const component = sourceComponent(part, 'PhysicalBehaviour'); if (!component) return;
    const properties = component.properties?.data; if (!properties) return;
    const strength = impulse * Number(properties.ImpactIntensityMutliplier ?? 1); if (strength < .002) return;
    const mass = Math.max(1, part.body.getMass()), hard = strength > .5 / mass;
    const override = component.data.OverrideImpactSounds;
    const clips = Array.isArray(override) && override.length ? override : hard ? properties.HardImpact : properties.SoftImpact;
    this.play(this.pick(clips), (component as SourceComponent & { file?: string }).file ?? 'sharedassets0.assets', {
      position: part.body.getPosition(), volume: strength * .3 / mass * Number(properties.HitVolumeMultiplier ?? 1),
    });
  }
  stop(): void { for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } } this.sources.clear(); }
}
