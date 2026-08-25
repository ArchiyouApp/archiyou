import * as THREE from 'three';

export type ColorRepresentation = THREE.ColorRepresentation;

/**
 * GridHelper variant whose lines fade radially toward a target color
 * (typically the scene background) as they move away from the grid origin
 * on the XY plane (Z-up coordinate system).
 *
 * Draws two line weights:
 *   - secondaryColor: every grid line.
 *   - primaryColor:   every `primaryEvery`-th line, counted symmetrically
 *                     from the centre (so the centre axis is always primary
 *                     and the spacing reads the same on either side).
 *
 * The fade radius is derived from the grid `size`; by default the fade
 * completes exactly at the grid edge along the axes (radius = size / 2).
 * Use `setSize()` to rebuild the geometry; the fade radius and line
 * colours are re-applied automatically.
 */
export class FadingGrid extends THREE.GridHelper
{
  private _shaderMaterial: THREE.ShaderMaterial;
  private _size: number;
  private _divisions: number;
  private _primaryColor:   THREE.Color;
  private _secondaryColor: THREE.Color;
  private _primaryEvery:   number;

  constructor(
    size: number = 10,
    divisions: number = 10,
    primaryColor:   ColorRepresentation = 0x444444,
    secondaryColor: ColorRepresentation = 0x888888,
    fadeColor:      ColorRepresentation = 0xffffff,
    primaryEvery:   number = 5,
  )
  {
    // Base GridHelper builds the geometry and a color attribute; we
    // immediately overwrite that attribute with our own primary/secondary
    // pattern in `_applyLineColors()` below.
    super(size, divisions, secondaryColor, secondaryColor);

    this._size           = size;
    this._divisions      = divisions;
    this._primaryColor   = new THREE.Color(primaryColor);
    this._secondaryColor = new THREE.Color(secondaryColor);
    this._primaryEvery   = Math.max(1, Math.floor(primaryEvery));

    this._shaderMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uFadeRadius: { value: size * 0.5 },
        uFadeColor:  { value: new THREE.Color(fadeColor) },
      },
      // <logdepthbuf_*> chunks are required so this material participates in
      // the logarithmic depth buffer (renderer is created with
      // `logarithmicDepthBuffer: true`). Without them the grid writes
      // perspective-divided z while built-in materials write log-depth via
      // gl_FragDepth — the two never compare correctly and the grid sinks
      // behind every other object under a perspective camera. Orthographic
      // bypasses log-depth so the bug only manifests in perspective.
      vertexShader: /* glsl */`
        #include <common>
        #include <color_pars_vertex>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vWorldPos;
        void main() {
          #include <color_vertex>
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }
      `,
      // No tone mapping: matches THREE.GridHelper's default LineBasicMaterial
      // ({ toneMapped: false }). Tone-mapping would compress the light grid
      // color toward the light background and make the grid disappear.
      // Only the colorspace chunk runs, so the fragment output is sRGB-encoded
      // just like the renderer's clear color — the two match exactly at t = 1.
      fragmentShader: /* glsl */`
        #include <common>
        #include <color_pars_fragment>
        #include <logdepthbuf_pars_fragment>
        // Note: <colorspace_pars_fragment> is auto-prepended by WebGLProgram
        // (since Three.js r152+); including it here causes duplicate
        // LinearTransferOETF/sRGBTransfer* definitions and a compile error.
        varying vec3 vWorldPos;
        uniform float uFadeRadius;
        uniform vec3  uFadeColor;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 lineCol = vec3(1.0);
          #ifdef USE_COLOR
            lineCol = vColor;
          #endif
          float d = length(vWorldPos.xy); // Z-up: ground plane is XY
          float t = smoothstep(0.0, max(uFadeRadius, 1e-4), d);
          gl_FragColor = vec4(mix(lineCol, uFadeColor, t), 1.0);
          #include <colorspace_fragment>
        }
      `,
      vertexColors: true,
      toneMapped: false,
      depthWrite: false,
      transparent: false,
    });

    // Swap in the shader material. The base type narrows .material to
    // LineBasicMaterial, so route the assignment through unknown.
    const old = this.material as THREE.Material | THREE.Material[];
    if (Array.isArray(old)) old.forEach(m => m.dispose()); else old.dispose();
    (this as unknown as { material: THREE.Material }).material = this._shaderMaterial;

    // Keep the grid visually behind coplanar 2D geometry at Z=0 without
    // moving it off the world plane. Rendering early + no depth writes lets
    // later scene geometry cleanly draw over the grid instead of fighting it.
    this.renderOrder = -10;

    this._applyLineColors();
  }

  /** Rebuild geometry at a new size/divisions; fade radius re-derives. */
  setSize(size: number, divisions: number = this._divisions): this
  {
    this._size      = size;
    this._divisions = divisions;

    const fresh = new THREE.GridHelper(size, divisions, this._secondaryColor, this._secondaryColor);
    this.geometry.dispose();
    this.geometry = fresh.geometry;
    fresh.material instanceof THREE.Material
      ? fresh.material.dispose()
      : (fresh.material as THREE.Material[]).forEach(m => m.dispose());

    this._shaderMaterial.uniforms.uFadeRadius.value = size * 0.5;
    this._applyLineColors();
    return this;
  }

  /** Update primary/secondary line colours (rewrites the vertex color attribute). */
  setColors(primaryColor: ColorRepresentation, secondaryColor: ColorRepresentation): this
  {
    this._primaryColor.set(primaryColor);
    this._secondaryColor.set(secondaryColor);
    this._applyLineColors();
    return this;
  }

  /** Change how often (in cells) a line is drawn in `primaryColor`. */
  setPrimaryEvery(every: number): this
  {
    this._primaryEvery = Math.max(1, Math.floor(every));
    this._applyLineColors();
    return this;
  }

  /**
   * Rewrites the geometry's `color` attribute so every `_primaryEvery`-th
   * line (measured from the centre) uses `_primaryColor` and the rest use
   * `_secondaryColor`. THREE.GridHelper lays the colour buffer out as
   * 4 vertices per line index (two co-planar segments, both endpoints), so
   * we paint 4 vertices per `i` here.
   */
  private _applyLineColors(): void
  {
    const attr = this.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const half  = this._divisions / 2;
    const every = this._primaryEvery;
    const p     = this._primaryColor;
    const s     = this._secondaryColor;
    for (let i = 0; i <= this._divisions; i++)
    {
      const isPrimary = ((i - half) % every) === 0;
      const c = isPrimary ? p : s;
      const base = i * 4;
      attr.setXYZ(base,     c.r, c.g, c.b);
      attr.setXYZ(base + 1, c.r, c.g, c.b);
      attr.setXYZ(base + 2, c.r, c.g, c.b);
      attr.setXYZ(base + 3, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
  }

  setFadeRadius(radius: number): this
  {
    this._shaderMaterial.uniforms.uFadeRadius.value = radius;
    return this;
  }

  setFadeColor(color: ColorRepresentation): this
  {
    (this._shaderMaterial.uniforms.uFadeColor.value as THREE.Color).set(color);
    return this;
  }

  get size():           number       { return this._size; }
  get divisions():      number       { return this._divisions; }
  get fadeRadius():     number       { return this._shaderMaterial.uniforms.uFadeRadius.value; }
  get fadeColor():      THREE.Color  { return this._shaderMaterial.uniforms.uFadeColor.value; }
  get primaryColor():   THREE.Color  { return this._primaryColor; }
  get secondaryColor(): THREE.Color  { return this._secondaryColor; }
  get primaryEvery():   number       { return this._primaryEvery; }
}
