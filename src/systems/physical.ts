/** PhysicalBehaviour/Utils thermal and electrical rules reconstructed from shipped CIL.
 * See research/PHYSICAL.md for source identity and unimplemented boundaries.
 */
export interface PhysicalProperties {
  Flammability: number;
  Burnrate: number;
  BurningTemperatureThreshold: number;
  HeatTransferSpeedMultiplier: number;
  Conducting: boolean;
}

export interface PhysicalSettings {
  SimulateTemperature: boolean;
  AmbientTemperatureTransfer: boolean;
  ChargeBurns: boolean;
  ForceNoCharge: boolean;
  ConductOverride: boolean;
  TemperatureWhenBurningLerpMultiplier: number;
  BurningProgressionMultiplier: number;
  EnergyWireResistance: number;
}

export interface PhysicalState {
  temperature: number;
  charge: number;
  onFire: boolean;
  burnProgress: number;
  burnIntensity: number;
  wetness: number;
}

export interface PhysicalObject {
  state: PhysicalState;
  properties: PhysicalProperties;
  settings: PhysicalSettings;
  /** Unity calls the diagonal of sprite bounds ObjectArea; it is not area. */
  objectArea: number;
  mass: number;
  /** Unity gameObject.isStatic, independent of freezing its rigidbody. */
  isStatic: boolean;
}

export const DEFAULT_PHYSICAL_SETTINGS: Readonly<PhysicalSettings> = {
  SimulateTemperature: true, AmbientTemperatureTransfer: true, ChargeBurns: true,
  ForceNoCharge: false, ConductOverride: true, TemperatureWhenBurningLerpMultiplier: 1,
  BurningProgressionMultiplier: 1, EnergyWireResistance: 1,
};
export const DEFAULT_PHYSICAL_PROPERTIES: Readonly<PhysicalProperties> = {
  Flammability: 0, Burnrate: 0, BurningTemperatureThreshold: 5000,
  HeatTransferSpeedMultiplier: 1, Conducting: false,
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp01(t);

export function createPhysicalObject(options: {
  ambientTemperature: number; mass: number; width: number; height: number;
  settings?: Partial<PhysicalSettings>; properties?: Partial<PhysicalProperties>;
  state?: Partial<PhysicalState>; isStatic?: boolean;
}): PhysicalObject {
  return {
    state: { temperature: options.ambientTemperature, charge: 0, onFire: false,
      burnProgress: 0, burnIntensity: 0, wetness: 0, ...options.state },
    settings: { ...DEFAULT_PHYSICAL_SETTINGS, ...options.settings },
    properties: { ...DEFAULT_PHYSICAL_PROPERTIES, ...options.properties },
    objectArea: Math.hypot(options.width, options.height), mass: options.mass,
    isStatic: options.isStatic ?? false,
  };
}

export function getCharge(object: PhysicalObject): number {
  return object.settings.ForceNoCharge ? 0 : object.state.charge;
}

export function getHeatCapacity(object: PhysicalObject): number {
  if (!object.settings.SimulateTemperature) return 1;
  // Guard zero-size browser objects; admitted Unity sprite bounds are nonzero.
  return Math.max(Number.EPSILON, object.objectArea * Math.max(.1, .025 * object.mass));
}

export function ignite(object: PhysicalObject, ignitionSample: number, ignoreFlammability = false): boolean {
  if (!object.isStatic && object.properties.Flammability > 0 &&
      (ignoreFlammability || ignitionSample <= object.properties.Flammability)) object.state.onFire = true;
  return object.state.onFire;
}

export function extinguish(object: PhysicalObject): void {
  object.state.temperature = Math.min(object.state.temperature, object.properties.BurningTemperatureThreshold);
  object.state.onFire = false;
}

/** Original ManagedUpdate uses real render frames for electrical charring.
 * Call once per rendered simulation frame, not once for every fixed substep.
 */
export function updatePhysicalFrame(object: PhysicalObject, deltaTime: number, timeScale: number): void {
  if (object.isStatic) return;
  const s = object.state;
  if (s.burnProgress < .3 && object.settings.ChargeBurns)
    s.burnProgress += object.properties.Burnrate * getCharge(object) * .01 * timeScale;
  s.wetness = clamp01(s.wetness - deltaTime);
  if (s.onFire) {
    s.burnIntensity += deltaTime * .1;
    if (s.burnProgress >= .995) s.onFire = false;
    s.burnProgress = clamp01(s.burnProgress);
    if (s.wetness > .1) { extinguish(object); s.burnIntensity = 0; }
  } else s.burnIntensity -= deltaTime * .1;
  s.burnIntensity = clamp01(s.burnIntensity);
}

/** One Unity-equivalent fixed update, 0.02 seconds in the inspected build. */
export function stepPhysical(object: PhysicalObject, ambientTemperature: number, random: () => number = Math.random): void {
  if (object.isStatic) return;
  const s = object.state, p = object.properties, settings = object.settings;
  s.charge *= .95;
  if (!settings.SimulateTemperature) return;
  if (settings.AmbientTemperatureTransfer)
    s.temperature = lerp(s.temperature, ambientTemperature, .0001 / getHeatCapacity(object));
  if (s.onFire && s.temperature < p.BurningTemperatureThreshold * 3)
    s.temperature = lerp(s.temperature, p.BurningTemperatureThreshold * 3, .01 * settings.TemperatureWhenBurningLerpMultiplier);
  const notFullyBurnt = s.burnProgress <= .98;
  if (notFullyBurnt && s.temperature > p.BurningTemperatureThreshold && p.Flammability > 0) {
    if (s.burnProgress < .2) s.burnProgress += .001;
    if (random() > .9995) ignite(object, 0, true);
  }
  if (s.onFire) s.burnProgress += Math.max(0, s.temperature - p.BurningTemperatureThreshold) * .00006 * (p.Burnrate / 2) * settings.BurningProgressionMultiplier;
  if (s.temperature < p.BurningTemperatureThreshold) {
    if (notFullyBurnt && s.onFire) s.burnProgress += .000025 * (p.Burnrate / 2) * settings.BurningProgressionMultiplier;
    if (s.onFire && random() > .995) extinguish(object);
  }
  // HeatTransferSpeedMultiplier=0 is undefined in the original expression.
  // Preserve finite state in the browser while tracking that case in the ledger.
  if (p.HeatTransferSpeedMultiplier > 0)
    s.temperature += getCharge(object) * .0008 / p.HeatTransferSpeedMultiplier;
  s.temperature = Math.max(-273.15, Math.min(5_000_000, s.temperature));
}

/** Preserve each body's heat capacity when exchanging heat. */
export function averageTemperature(a: PhysicalObject, b: PhysicalObject, transferFactor = .01): void {
  if (!a.settings.SimulateTemperature || !b.settings.SimulateTemperature) return;
  const amount = Math.min(a.properties.HeatTransferSpeedMultiplier, b.properties.HeatTransferSpeedMultiplier) * transferFactor;
  const at = a.state.temperature, bt = b.state.temperature;
  a.state.temperature = lerp(at, bt, amount / getHeatCapacity(a));
  b.state.temperature = lerp(bt, at, amount / getHeatCapacity(b));
}

export function conductContact(a: PhysicalObject, b: PhysicalObject): void {
  if (!a.settings.ForceNoCharge && getCharge(a) > getCharge(b) &&
      a.settings.ConductOverride && b.settings.ConductOverride && a.properties.Conducting && b.properties.Conducting)
    b.state.charge = lerp(getCharge(b), getCharge(a), .8);
}

export function transferContact(a: PhysicalObject, b: PhysicalObject): void {
  averageTemperature(a, b);
  conductContact(a, b);
}

/** PhysicalBehaviour.OnCollisionStay2D friction heating. */
export function heatFromSliding(object: PhysicalObject, relativeVelocitySquared: number, friction?: number): void {
  if (!object.isStatic && object.settings.SimulateTemperature)
    object.state.temperature += relativeVelocitySquared * .0001 * (friction === undefined ? .5 : friction * 2);
}
