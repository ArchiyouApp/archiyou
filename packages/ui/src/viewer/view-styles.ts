import * as THREE from 'three';

export interface ViewStyleMaterialConfig {
  color?: number;
  opacity?: number;
  transparent?: boolean;
  wireframe?: boolean;
  flatShading?: boolean;
  side?: 'front' | 'back' | 'double';
  depthTest?: boolean;
  strokeWidth?: number;
  strokeDash?: number;
}

export interface ViewStyleLightConfig {
  enabled: boolean;
  color?: number;
  intensity?: number;
  castShadow?: boolean;
}

export interface ViewStyleGridConfig {
  visible: boolean;
  /** Colour of the bolder, periodic "primary" lines (every `primaryEvery` cells). */
  primaryColor?: number;
  /** Colour of the lighter "secondary" lines between primaries. */
  secondaryColor?: number;
  /** Draw a primary line every N cells, measured from the centre (default 5). */
  primaryEvery?: number;
}

export interface ViewStyle {
  id: string;
  label: string;
  icon: string;
  description?: string;

  // Renderer
  background?: number;
  shadows?: boolean;
  toneMapping?: number;
  toneMappingExposure?: number;

  // Lighting
  environment?: 'room' | null;
  /** Strength of the image-based environment light (default 1). */
  environmentIntensity?: number;
  ambientLight?: ViewStyleLightConfig;
  spotlight?: ViewStyleLightConfig;
  hemiLight?: ViewStyleLightConfig;

  // Material overrides: undefined = no override, null = hide, object = replace
  mesh?: ViewStyleMaterialConfig | null;
  lines?: Partial<ViewStyleMaterialConfig> | null;

  // Grid
  grid?: ViewStyleGridConfig;

  // Ground plane (shadow receiver)
  groundPlane?: boolean;
}

export const VIEW_STYLES: ViewStyle[] = [
  {
    id: 'realistic',
    label: 'Realistic',
    icon: 'sun',
    description: 'Full PBR shading with image-based lighting and shadows',
    background: 0xf1f5f9,
    shadows: true,
    // Khronos PBR Neutral, not AgX. AgX is a filmic curve built for cinematic HDR: it
    // deliberately desaturates toward white as values rise, which turned a pure red
    // sphere into salmon and flattened every material. Neutral is designed for exactly
    // this job — showing a material's real colour — and preserves hue and saturation.
    toneMapping: THREE.NeutralToneMapping,
    // Exposure and light levels are tuned together so a lit surface renders close to its
    // DECLARED colour: a douglas beam (#c08a4a) samples ~#d6994e on screen. The original
    // values were roughly a stop and a half hot, which pushed every material up to ~0.85
    // lightness and drained the colour out of it.
    //
    // 0.9 is the top of the useful range: measured across the sweep, saturation holds to
    // about here and then falls away as Neutral compresses the highlights — by 1.05 a red
    // sphere is already losing saturation (0.70 -> 0.61) while only getting slightly
    // brighter. Raise the lights rather than the exposure if more is needed.
    toneMappingExposure: 0.9,
    environment: 'room',
    // The room IBL is untinted white light. Too much of it desaturates everything toward
    // white — it was the main reason a pure red sphere read as salmon.
    environmentIntensity: 0.4,
    ambientLight: { enabled: true, color: 0xffffff, intensity: 0.08 },
    spotlight: { enabled: true, color: 0xffffff, intensity: 12, castShadow: true },
    grid: { visible: true, primaryColor: 0xDDDDDD, secondaryColor: 0xEEEEEE, primaryEvery: 5 },
    groundPlane: true,
  },
  {
    id: 'xray',
    label: 'X-Ray',
    icon: 'eye',
    description: 'Semi-transparent surfaces reveal internal structure',
    background: 0xf1f5f9,
    shadows: false,
    toneMapping: THREE.AgXToneMapping,
    toneMappingExposure: 1.0,
    environment: null,
    ambientLight: { enabled: true, color: 0xffffff, intensity: 0.3 },
    spotlight: { enabled: true, color: 0xffffff, intensity: 5, castShadow: false },
    mesh: {
      opacity: 0.35,
      transparent: true,
      side: 'double',
      depthTest: true,
    },
    lines: { strokeWidth: 2  },
    grid: { visible: true, primaryColor: 0xB0B0B0, secondaryColor: 0xE5E5E5, primaryEvery: 5 },
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    icon: 'grid-2x2',
    description: 'Show only edges and lines, mesh surfaces hidden',
    shadows: false,
    toneMapping: THREE.LinearToneMapping,
    toneMappingExposure: 1.0,
    environment: null,
    ambientLight: { enabled: true, color: 0xffffff, intensity: 0.5 },
    spotlight: { enabled: false },
    mesh: null,
    lines: undefined, // keep line colours: a shape's edges already carry its colour
    grid: { visible: false },
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    icon: 'compass',
    description: 'Technical blueprint look with navy background and construction grid',
    background: 0x0a1628,
    shadows: false,
    toneMapping: THREE.LinearToneMapping,
    toneMappingExposure: 1.0,
    environment: null,
    ambientLight: { enabled: true, color: 0x4a8ab5, intensity: 1.5 },
    spotlight: { enabled: false },
    mesh: {
      color: 0x1e3a6e,
      opacity: 0.8,
      transparent: true,
      side: 'double',
    },
    lines: { color: 0x4fc3f7,  },
    grid: { visible: true, primaryColor: 0x4fc3f7, secondaryColor: 0x1e4b8a, primaryEvery: 5 },
  },
  {
    id: 'techdraw',
    label: 'Tech Draw',
    icon: 'ruler',
    description: 'Clean technical drawing: white surfaces, black edges',
    background: 0xfafafa,
    shadows: false,
    toneMapping: THREE.LinearToneMapping,
    toneMappingExposure: 1.0,
    environment: null,
    ambientLight: { enabled: true, color: 0xffffff, intensity: 2.0 },
    spotlight: { enabled: false },
    mesh: {
      color: 0xffffff,
      opacity: 1,
      transparent: false,
    },
    lines: { color: 0x111111 },
    grid: { visible: true, primaryColor: 0x999999, secondaryColor: 0xDDDDDD, primaryEvery: 5 },
  },
];
