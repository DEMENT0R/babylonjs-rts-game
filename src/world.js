// Мир: земля, небо, свет, тени, декор и нефтяные месторождения.

import {
  Scene,
  MeshBuilder,
  Mesh,
  TransformNode,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  ParticleSystem,
} from './babylon.js';
import { MAP } from './config.js';
import { mulberry32, rngRange, rngPick } from './utils.js';

const SUN_DIR = new Vector3(-0.52, 0.46, 0.54).normalize();

// Солнце и карта теней закреплены над центром поля боя. Дистанция до света
// задаёт глубину теневой камеры, а extent с запасом накрывает углы карты.
const SUN_DISTANCE = 150;
const SHADOW_EXTENT = 132;
const SHADOW_MIN_Z = 10;
const SHADOW_MAX_Z = 320;
const SHADOW_DARKNESS = 0.33;

const SHADOW_MODES = {
  high: { mapSize: 2048, blurKernel: 24 },
  medium: { mapSize: 1024, blurKernel: 18 },
  low: { mapSize: 512, blurKernel: 12 },
  off: null,
};

// Оси теневой камеры: по ним удобно привязывать её к сетке текселей.
const LIGHT_DIR = SUN_DIR.scale(-1);
const LIGHT_RIGHT = Vector3.Cross(Vector3.Up(), LIGHT_DIR).normalize();
const LIGHT_UP = Vector3.Cross(LIGHT_DIR, LIGHT_RIGHT).normalize();
// Babylon расширяет фиксированный ортобокс на shadowOrthoScale (10% с каждой стороны).
const SHADOW_HALF_EXTENT = SHADOW_EXTENT * 1.2;

export class World {
  constructor(scene, factory, map) {
    this.scene = scene;
    this.factory = factory;
    this.map = map;
    this.oilPatches = [];
    this.rocks = [];
    this.obstacles = [];
    this.walls = [];
    this.decor = [];
    this.shadow = null;
    this.shadowMode = 'medium';
    this.casterRoots = new Map();
    this.rng = mulberry32((map.seed ^ 0x7e11a5) >>> 0);
    this._buildLights();
    this._buildSky();
    this._buildGround();
    this._buildOil();
    this._buildWalls();
    this._buildDecor();
    this._buildHorizon();
    this._buildDust();
  }

  get style() {
    return this.map.style;
  }

  _buildLights() {
    const scene = this.scene;
    const style = this.style;
    this.hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    this.hemi.intensity = 0.68;
    this.hemi.diffuse = Color3.FromHexString(style.hemi);
    this.hemi.groundColor = Color3.FromHexString(style.hemiGround);

    this.sun = new DirectionalLight('sun', SUN_DIR.scale(-1), scene);
    this.sun.position = SUN_DIR.scale(SUN_DISTANCE);
    this.sun.diffuse = Color3.FromHexString(style.sun);
    this.sun.specular = Color3.FromHexString(style.sunSpecular);
    this.sun.intensity = 1.7;

    // Теневой объём центрирован на мире и не следует за камерой: так вся карта
    // получает тени, а при панорамировании они не «уезжают» и не мерцают.
    this.sun.shadowMinZ = SHADOW_MIN_Z;
    this.sun.shadowMaxZ = SHADOW_MAX_Z;
    this.sun.autoUpdateExtends = false;
    this.sun.orthoLeft = -SHADOW_EXTENT;
    this.sun.orthoRight = SHADOW_EXTENT;
    this.sun.orthoTop = SHADOW_EXTENT;
    this.sun.orthoBottom = -SHADOW_EXTENT;

    this._createShadow(SHADOW_MODES.medium);

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0038;
    scene.fogColor = Color3.FromHexString(style.fog);
    scene.ambientColor = new Color3(0.15, 0.17, 0.19);
  }

  _buildSky() {
    const style = this.style;
    const tex = new DynamicTexture('skyTexture', { width: 1024, height: 512 }, this.scene, true);
    const ctx = tex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    const stops = style.sky;
    stops.forEach((color, index) => grad.addColorStop(index / (stops.length - 1), color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    // звёзды
    const rng = mulberry32((this.map.seed ^ 0x51a7) >>> 0);
    for (let i = 0; i < 420; i++) {
      const x = rng() * 1024;
      const y = rng() * 260;
      const r = rng() < 0.88 ? 0.8 : 1.6;
      ctx.fillStyle = `rgba(200,225,255,${0.12 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // мягкое зарево у горизонта
    const glow = ctx.createRadialGradient(700, 375, 0, 700, 375, 260);
    glow.addColorStop(0, style.glow);
    glow.addColorStop(0.4, style.glowMid);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 1024, 512);

    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 4;

    const mat = new StandardMaterial('skyMat', this.scene);
    mat.disableLighting = true;
    mat.emissiveTexture = tex;
    mat.diffuseTexture = tex;
    mat.specularColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.fogEnabled = false;

    this.sky = MeshBuilder.CreateSphere('sky', { diameter: 700, segments: 32, sideOrientation: Mesh.BACKSIDE }, this.scene);
    this.sky.material = mat;
    this.sky.infiniteDistance = true;
    this.sky.isPickable = false;
    this.sky.applyFog = false;
    this.sky.alwaysSelectAsActiveMesh = true;
    this.skyMesh = this.sky;
  }

  _buildGround() {
    const style = this.style;
    const tex = new DynamicTexture('groundTexture', { width: 1024, height: 1024 }, this.scene, true);
    const ctx = tex.getContext();
    const rng = mulberry32((this.map.seed ^ 0xc0ffee) >>> 0);
    ctx.fillStyle = style.ground;
    ctx.fillRect(0, 0, 1024, 1024);

    // большие пятна
    for (let i = 0; i < 90; i++) {
      const x = rng() * 1024;
      const y = rng() * 1024;
      const r = rngRange(rng, 40, 190);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rng() > 0.45;
      g.addColorStop(0, dark ? style.patchDark : style.patchLight);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // трещины
    ctx.lineCap = 'round';
    for (let i = 0; i < 55; i++) {
      let x = rng() * 1024;
      let y = rng() * 1024;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rng() * 5);
      for (let s = 0; s < segs; s++) {
        x += rngRange(rng, -60, 60);
        y += rngRange(rng, -60, 60);
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `${style.crack}${0.18 + rng() * 0.3})`;
      ctx.lineWidth = rngRange(rng, 0.6, 2.2);
      ctx.stroke();
    }

    // камешки и крапины
    for (let i = 0; i < 5200; i++) {
      const x = rng() * 1024;
      const y = rng() * 1024;
      const light = rng() > 0.55;
      ctx.fillStyle = light
        ? `${style.speckLight}${0.1 + rng() * 0.3})`
        : `${style.speckDark}${0.1 + rng() * 0.28})`;
      ctx.beginPath();
      ctx.arc(x, y, rngRange(rng, 0.5, 2.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // редкие тёмные "выходы породы"
    for (let i = 0; i < 22; i++) {
      const x = rng() * 1024;
      const y = rng() * 1024;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rng() * Math.PI);
      ctx.fillStyle = `${style.speckDark}${0.25 + rng() * 0.25})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, rngRange(rng, 8, 30), rngRange(rng, 4, 14), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.uScale = 13;
    tex.vScale = 13;
    tex.anisotropicFilteringLevel = 8;

    const mat = new StandardMaterial('groundMat', this.scene);
    mat.diffuseTexture = tex;
    mat.specularColor = new Color3(0.03, 0.035, 0.04);
    mat.specularPower = 8;

    this.ground = MeshBuilder.CreateGround('ground', { width: MAP.ground, height: MAP.ground, subdivisions: 1 }, this.scene);
    this.ground.material = mat;
    this.ground.receiveShadows = true;
    this.ground.isPickable = true;
    this.ground.metadata = { ground: true };

    // тёмная кайма за игровой зоной, чтобы карта читалась
    const edgeMat = new StandardMaterial('edgeMat', this.scene);
    edgeMat.diffuseColor = Color3.FromHexString(style.edge);
    edgeMat.specularColor = Color3.Black();
    edgeMat.alpha = 0.55;
    const strip = 7;
    const half = MAP.half + 1;
    for (const [w, d, x, z] of [
      [MAP.half * 2 + strip * 2, strip, 0, -half - strip / 2],
      [MAP.half * 2 + strip * 2, strip, 0, half + strip / 2],
      [strip, MAP.half * 2 + strip * 2, -half - strip / 2, 0],
      [strip, MAP.half * 2 + strip * 2, half + strip / 2, 0],
    ]) {
      const plate = MeshBuilder.CreateGround(`edge_${x}_${z}`, { width: w, height: d }, this.scene);
      plate.position.set(x, 0.015, z);
      plate.material = edgeMat;
      plate.isPickable = false;
      plate.receiveShadows = false;
    }
  }

  _bakeSource(mesh) {
    mesh.bakeCurrentTransformIntoVertices();
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scaling.set(1, 1, 1);
    mesh.position.y = -500;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.castShadow = false;
    return mesh;
  }

  _makeSources(root) {
    const groups = new Map();
    for (const mesh of root.getChildMeshes(false)) {
      if (!mesh.material) continue;
      const key = mesh.material.name;
      if (!groups.has(key)) groups.set(key, { material: mesh.material, meshes: [] });
      groups.get(key).meshes.push(mesh);
    }
    const sources = [];
    for (const { material, meshes } of groups.values()) {
      let source = meshes.length > 1
        ? Mesh.MergeMeshes(meshes, true, true, undefined, false, false)
        : meshes[0];
      if (!source) continue;
      source.parent = null;
      source.material = material;
      this._bakeSource(source);
      sources.push(source);
    }
    root.dispose();
    return sources;
  }

  _buildOil() {
    const template = this.factory.buildOilPatch();
    const sources = this._makeSources(template.root);
    this.map.oilPatches.forEach((info, index) => {
      const patch = {
        x: info.x,
        z: info.z,
        radius: info.radius ?? 4.4,
        owner: info.owner ?? null,
        rotation: info.rotation ?? 0,
        derrick: null,
        root: null,
      };
      for (const source of sources) {
        const inst = source.createInstance(`oil_${index}_${source.name}`);
        inst.position.set(info.x, 0, info.z);
        inst.rotation.y = patch.rotation;
        inst.isPickable = true;
        inst.receiveShadows = false;
        inst.metadata = { oilPatch: patch };
      }
      this.oilPatches.push(patch);
    });
  }

  _buildWalls() {
    const list = this.map.walls ?? [];
    if (!list.length) return;
    const concrete = this.factory.mat('ruinConcrete', { color: '#5a554c', specular: 0.03 });
    const dark = this.factory.mat('ruinDark', { color: '#2f302c', specular: 0.04 });
    const rust = this.factory.mat('ruinRust', { color: '#6d4b36', specular: 0.05 });
    const warn = this.factory.mat('ruinWarn', { color: '#b9842a', emissive: '#3a2506', specular: 0.1 });

    list.forEach((info, index) => {
      const dx = info.x2 - info.x1;
      const dz = info.z2 - info.z1;
      const length = Math.hypot(dx, dz);
      if (length < 1) return;
      const angle = Math.atan2(-dz, dx);
      const root = new TransformNode(`wall_${index}`, this.scene);
      const rng = mulberry32((this.map.seed ^ (0x51f00d + index * 7919)) >>> 0);
      const concreteParts = [];
      const darkParts = [];
      const rustParts = [];
      const warnParts = [];

      const box = (parts, width, height, depth, x, y, z, rotation = 0) => {
        const mesh = MeshBuilder.CreateBox(`wallpart_${index}_${parts.length}`, {
          width,
          height,
          depth,
        }, this.scene);
        mesh.position.set(x, y, z);
        mesh.rotation.y = rotation;
        parts.push(mesh);
      };

      // Основание и отдельные разрушенные секции: стена выглядит собранной
      // из бетонных блоков, но с проломами.
      box(concreteParts, length, 0.38, 1.55, 0, 0.19, 0);
      const sections = Math.max(2, Math.round(length / 2.6));
      const sectionLength = length / sections;
      for (let i = 0; i < sections; i++) {
        const x = -length / 2 + (i + 0.5) * sectionLength;
        const height = 1.45 + rng() * 0.95;
        box(concreteParts, sectionLength * 0.94, height, 1.18, x, 0.35 + height * 0.5, 0);
        if (i % 2 === 0) {
          box(darkParts, sectionLength * 0.96, 0.16, 1.28, x, 0.35 + height, 0);
        }
      }
      for (let i = 0; i < 3; i++) {
        const x = -length / 2 + 0.8 + rng() * (length - 1.6);
        const y = 0.65 + rng() * 0.9;
        box(rustParts, 1.1 + rng() * 0.6, 0.1, 0.1, x, y, 0.66, 0);
        box(warnParts, 0.75, 0.12, 0.06, x + 0.4, y, 0.72, 0);
      }

      const merge = (parts, material) => {
        if (!parts.length) return;
        const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
        if (!merged) return;
        merged.material = material;
        merged.parent = root;
        merged.position.set(0, 0, 0);
        merged.rotation.set(0, 0, 0);
        merged.isPickable = false;
        merged.receiveShadows = true;
        merged.castShadow = true;
        merged.name = `wall_${index}_${material.name}`;
      };
      merge(concreteParts, concrete);
      merge(darkParts, dark);
      merge(rustParts, rust);
      merge(warnParts, warn);

      root.position.set((info.x1 + info.x2) * 0.5, 0, (info.z1 + info.z2) * 0.5);
      root.rotation.y = angle;
      this.addCaster(root, 4);
      this.walls.push({
        x1: info.x1,
        z1: info.z1,
        x2: info.x2,
        z2: info.z2,
        radius: Math.max(0.65, info.radius ?? 0.65),
      });
    });
  }

  _buildDecor() {
    const rng = this.rng;
    const { rocks, crates, crystals, pebbles } = this.map.decor;

    // Камни: несколько базовых форм, дальше — инстансы по данным карты.
    const rockSources = [];
    for (let i = 0; i < 4; i++) {
      rockSources.push(this._bakeSource(this.factory.buildRock(rng)));
    }
    rocks.forEach((info, index) => {
      const source = rockSources[info.source % rockSources.length];
      const inst = source.createInstance(`rock_${index}`);
      inst.position.set(info.x, 0.04, info.z);
      inst.rotation.set(0, info.yaw ?? 0, 0);
      inst.scaling.set(info.scale, info.scale * (info.squash ?? 1), info.scale);
      const baseRadius = source.getBoundingInfo().boundingSphere.radius;
      const radius = Math.max(1.1, baseRadius * info.scale * 0.72);
      this.rocks.push({ x: info.x, z: info.z, radius });
      this.obstacles.push({ x: info.x, z: info.z, radius, kind: 'rock' });
    });

    // Кристаллы: один источник, инстансы с разной высотой и наклоном.
    const crystalMat = this.factory.mat('crystal', {
      color: '#5cd8ff',
      emissive: '#3ab8e8',
      unlit: false,
      specular: 0.8,
      shininess: 100,
    });
    const crystalSrc = MeshBuilder.CreateCylinder('crystalSrc', {
      diameterTop: 0.05,
      diameterBottom: 0.5,
      height: 1,
      tessellation: 5,
    }, this.scene);
    crystalSrc.position.y = 0.5;
    crystalSrc.material = crystalMat;
    this._bakeSource(crystalSrc);

    crystals.forEach((info, index) => {
      const inst = crystalSrc.createInstance(`crystal_${index}`);
      inst.position.set(info.x, -0.05, info.z);
      inst.scaling.set(info.scaleX, info.scaleY, info.scaleZ);
      inst.rotation.set(info.rx, info.ry, info.rz);
      inst.isPickable = false;
    });

    // Ящики: 2 источника материалов, инстансы по данным карты.
    const crateSources = this._makeSources(this.factory.buildCrateProp(1));
    crates.forEach((info, index) => {
      for (const source of crateSources) {
        const inst = source.createInstance(`crate_${index}_${source.name}`);
        inst.position.set(info.x, 0, info.z);
        inst.rotation.y = info.yaw ?? 0;
        inst.scaling.setAll(info.scale);
        inst.isPickable = false;
      }
      this.obstacles.push({ x: info.x, z: info.z, radius: 0.75 * info.scale, kind: 'crate' });
    });

    // Пограничные столбы: 2 источника на весь периметр.
    const postMat = this.factory.mat('post', { color: '#2e3a40', specular: 0.2 });
    const postBody = MeshBuilder.CreateCylinder('postBody', { diameter: 0.5, height: 2.2, tessellation: 6 }, this.scene);
    postBody.position.y = 1.1;
    postBody.material = postMat;
    const postCap = MeshBuilder.CreateBox('postCap', { width: 0.7, height: 0.22, depth: 0.7 }, this.scene);
    postCap.position.y = 2.25;
    postCap.material = postMat;
    const postSource = Mesh.MergeMeshes([postBody, postCap], true, true, undefined, false, false);
    postSource.material = postMat;
    this._bakeSource(postSource);

    const postLightMat = this.factory.mat('postlight', { color: '#ff5a3c', emissive: '#ff3a1e', unlit: true });
    const postLight = MeshBuilder.CreateSphere('postLightSrc', { diameter: 0.22, segments: 5 }, this.scene);
    postLight.position.y = 2.18;
    postLight.material = postLightMat;
    this._bakeSource(postLight);

    for (const side of [-1, 1]) {
      for (let i = -MAP.half; i <= MAP.half; i += 20) {
        for (const [x, z] of [
          [i, side * (MAP.half + 0.6)],
          [side * (MAP.half + 0.6), i],
        ]) {
          const p = postSource.createInstance(`post_${x}_${z}`);
          p.position.set(x, 0, z);
          p.isPickable = false;
          const l = postLight.createInstance(`postlight_${x}_${z}`);
          l.position.set(x, 0, z);
          l.isPickable = false;
        }
      }
    }

    // мелкая галька без коллизий
    const pebbleMat = this.factory.mat('pebble', { color: '#4a4237', specular: 0.1 });
    const pebble = MeshBuilder.CreateIcoSphere('pebble', { radius: 0.4, subdivisions: 0 }, this.scene);
    pebble.material = pebbleMat;
    pebble.isPickable = false;
    pebble.receiveShadows = false;
    pebbles.forEach((info, index) => {
      const inst = pebble.createInstance(`pebble_${index}`);
      inst.scaling.set(
        info.scale * info.stretchX,
        info.scale * 0.4,
        info.scale * info.stretchZ,
      );
      inst.position.set(info.x, 0.08, info.z);
      inst.rotation.y = info.yaw ?? 0;
    });
    pebble.position.y = -500;
    pebble.isPickable = false;
  }

  _buildHorizon() {
    const rng = mulberry32((this.map.seed ^ 0xdead5) >>> 0);
    const mat = this.factory.mat('mountain', { color: '#322d27', specular: 0.02 });
    const sources = [];
    for (let i = 0; i < 3; i++) {
      const mesh = MeshBuilder.CreateIcoSphere(`mountainSrc_${i}`, { radius: 1, subdivisions: 1 }, this.scene);
      mesh.convertToFlatShadedMesh();
      mesh.scaling.set(rngRange(rng, 12, 24), rngRange(rng, 9, 16), rngRange(rng, 10, 22));
      mesh.material = mat;
      sources.push(this._bakeSource(mesh));
    }
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2;
      const r = rngRange(rng, MAP.half * 1.75, MAP.half * 2.55);
      const source = rngPick(rng, sources);
      const inst = source.createInstance(`mountain_${i}`);
      const s = rngRange(rng, 0.8, 1.4);
      const baseHeight = source.getBoundingInfo().boundingBox.extendSize.y * 2;
      inst.position.set(Math.cos(a) * r, baseHeight * s * 0.16, Math.sin(a) * r);
      inst.scaling.set(s, s * rngRange(rng, 0.75, 1.3), s);
      inst.rotation.y = rng() * Math.PI;
      inst.isPickable = false;
    }
  }

  _buildDust() {
    const tex = new DynamicTexture('dustDot', { width: 64, height: 64 }, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,235,200,0.9)');
    g.addColorStop(0.5, 'rgba(220,190,150,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    tex.update(false);

    this.dust = new ParticleSystem('ambientDust', 70, this.scene);
    this.dust.particleTexture = tex;
    this.dust.emitter = new Vector3(0, 1, 0);
    this.dust.minEmitBox = new Vector3(-MAP.half, 0, -MAP.half);
    this.dust.maxEmitBox = new Vector3(MAP.half, 5, MAP.half);
    this.dust.color1 = new Color4(0.85, 0.78, 0.65, 0.22);
    this.dust.color2 = new Color4(0.7, 0.7, 0.65, 0.12);
    this.dust.colorDead = new Color4(0.6, 0.6, 0.6, 0);
    this.dust.minSize = 0.06;
    this.dust.maxSize = 0.22;
    this.dust.minLifeTime = 8;
    this.dust.maxLifeTime = 16;
    this.dust.emitRate = 9;
    this.dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    this.dust.direction1 = new Vector3(-0.35, 0.05, -0.35);
    this.dust.direction2 = new Vector3(0.35, 0.3, 0.35);
    this.dust.minEmitPower = 0.1;
    this.dust.maxEmitPower = 0.5;
    this.dust.updateSpeed = 0.01;
    this.dust.start();
  }

  /** Держит теневой объём над точкой, куда смотрит камера. */
  update(dt, camera) {
    if (!this.shadow || !camera) return;
    const focus = camera.target;
    const texel = (2 * SHADOW_HALF_EXTENT) / this.shadow.mapSize;
    const lx = focus.x * LIGHT_RIGHT.x + focus.z * LIGHT_RIGHT.z;
    const ly = focus.x * LIGHT_UP.x + focus.z * LIGHT_UP.z;
    // Привязка к текселям убирает дрожание теней при панорамировании.
    const sx = (Math.floor(lx / texel) + 0.5) * texel;
    const sy = (Math.floor(ly / texel) + 0.5) * texel;
    const ox = (sx - lx) * LIGHT_RIGHT.x + (sy - ly) * LIGHT_UP.x;
    const oz = (sx - lx) * LIGHT_RIGHT.z + (sy - ly) * LIGHT_UP.z;
    this.sun.position.set(
      focus.x + ox + SUN_DIR.x * SUN_DISTANCE,
      SUN_DIR.y * SUN_DISTANCE,
      focus.z + oz + SUN_DIR.z * SUN_DISTANCE,
    );
  }

  _createShadow(quality) {
    this.shadow = new ShadowGenerator(quality.mapSize, this.sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = quality.blurKernel;
    this.shadow.setDarkness(SHADOW_DARKNESS);
    this.shadow.getShadowMap().refreshRate = 1;
    this.casterRoots.forEach((max, root) => this._addCasterMeshes(root, max));
  }

  /** Переключает качество теней из меню графики. */
  setShadowMode(mode = 'medium') {
    const next = Object.prototype.hasOwnProperty.call(SHADOW_MODES, mode) ? mode : 'medium';
    if (next === this.shadowMode) return;
    this.shadowMode = next;
    if (next === 'off') {
      this.sun.shadowEnabled = false;
      this.shadow?.dispose();
      this.shadow = null;
      return;
    }
    this.sun.shadowEnabled = true;
    const quality = SHADOW_MODES[next];
    if (!this.shadow) {
      this._createShadow(quality);
      return;
    }
    if (this.shadow.mapSize !== quality.mapSize) this.shadow.mapSize = quality.mapSize;
    this.shadow.blurKernel = quality.blurKernel;
    this.shadow.getShadowMap().refreshRate = 1;
  }

  _addCasterMeshes(root, max = 8) {
    if (!this.shadow) return;
    if (!root.getChildMeshes) {
      this.shadow.addShadowCaster(root);
      return;
    }
    const meshes = root.getChildMeshes(false).filter((mesh) => mesh.castShadow);
    if (meshes.length <= max) {
      meshes.forEach((mesh) => this.shadow.addShadowCaster(mesh));
      return;
    }
    const scored = meshes.map((mesh) => {
      const ext = mesh.getBoundingInfo().boundingBox.extendSize;
      const s = mesh.scaling;
      return { mesh, volume: Math.abs(ext.x * s.x * ext.y * s.y * ext.z * s.z) };
    });
    scored.sort((a, b) => b.volume - a.volume);
    scored.slice(0, max).forEach((item) => this.shadow.addShadowCaster(item.mesh));
  }

  addCaster(root, max = 8) {
    if (!root) return;
    this.casterRoots.set(root, max);
    this._addCasterMeshes(root, max);
  }

  removeCaster(root) {
    if (!root) return;
    this.casterRoots.delete(root);
    if (!this.shadow) return;
    const list = this.shadow.getShadowMap()?.renderList;
    if (!list) return;
    const meshes = new Set(root.getChildMeshes(false));
    meshes.add(root);
    const filtered = list.filter((m) => !meshes.has(m));
    list.length = 0;
    list.push(...filtered);
  }
}

// Утилита для поиска свободного места вокруг точки (используется спавном юнитов).
export function findFreeSpot(game, x, z, radius, startAngle = 0) {
  for (let ring = 0; ring < 8; ring++) {
    const r = ring * (radius * 1.8 + 0.9);
    for (let i = 0; i < 12; i++) {
      const a = startAngle + (i / 12) * Math.PI * 2 + ring * 0.3;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (game.isPositionFree(px, pz, radius)) return { x: px, z: pz };
    }
  }
  return { x, z };
}
