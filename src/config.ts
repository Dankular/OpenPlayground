// Gravity, timestep and solver iterations follow the installed serialized Unity settings.
// Other defaults below are browser implementation choices. Runtime Unity overrides remain unverified.
export const CONFIG = { gravity: -9.81, timestep: 1 / 50, velocityIterations: 16, positionIterations: 16, groundY: 0, maxEntities: 200, maxImportBytes: 2_000_000 } as const;
export type ItemKind = 'human' | 'box' | 'ball' | 'plank';
export const CATALOG: { kind: ItemKind; name: string; category: string; description: string; color: string; shortcut: string }[] = [
  { kind: 'human', name: 'Human', category: 'Living', description: 'Articulated physics mannequin', color: '#d8b3a0', shortcut: '1' },
  { kind: 'box', name: 'Wooden crate', category: 'Objects', description: 'A sturdy, stackable wooden box', color: '#b88b57', shortcut: '2' },
  { kind: 'ball', name: 'Steel ball', category: 'Objects', description: 'Heavy sphere with a little bounce', color: '#9baab9', shortcut: '3' },
  { kind: 'plank', name: 'Wooden plank', category: 'Objects', description: 'Build a bridge. Or a lever.', color: '#c29b67', shortcut: '4' },
];
