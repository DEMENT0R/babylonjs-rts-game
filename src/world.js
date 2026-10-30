// Мир: земля, небо, свет, тени, декор и нефтяные месторождения.

import {
  Scene,
  MeshBuilder,
  Mesh,
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

export class World {
  constructor(scene, factory, map) {
    this.scene = scene;
    this.factory = factory;
    this.map = map;
    this.oilPatches = [];
    this.rocks = [];
    this.obstacles = [];
    this.decor = [];
    this.rng = mulberry32((map.seed ^ 0x7e11a5) >>> 0);
    this._buildLights();
    this._buildSky();
    this._buildGround();
    this._buildOil();
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
    this.sun.position = SUN_DIR.scale(90);
    this.sun.diffuse = Color3.FromHexString(style.sun);
    this.sun.specular = Color3.FromHexString(style.sunSpecular);
    this.sun.intensity = 1.7;

    this.shadow = new ShadowGenerator(1024, this.sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = 18;
    this.shadow.setDarkness(0.33);
    this.sun.shadowMinZ = 10;
    this.sun.shadowMaxZ = 210;
    this.sun.autoUpdateExtends = false;
    this.sun.orthoLeft = -58;
    this.sun.orthoRight = 58;
    this.sun.orthoTop = 58;
    this.sun.orthoBottom = -58;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.0046;
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
    tex.uScale = 9;
    tex.vScale = 9;
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
      for (let i = -MAP.half; i <= MAP.half; i += 15) {
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
      const r = rngRange(rng, 105, 155);
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
    this.dust.minEmitBox = new Vector3(-60, 0, -60);
    this.dust.maxEmitBox = new Vector3(60, 5, 60);
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

  addCaster(root, max = 8) {
    if (!root) return;
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

  removeCaster(root) {
    if (!root) return;
    const list = this.shadow.getShadowMap()?.renderList;
    if (!list) return;
    const meshes = new Set(root.getChildMeshes(false));
    meshes.add(root);
    const filtered = list.filter((m) => !meshes.has(m));
    list.length = 0;
    list.push(...filtered);
  }

  update(dt, camera) {
    const t = camera.target;
    this.sun.position.set(t.x + SUN_DIR.x * 95, 95 + t.y, t.z + SUN_DIR.z * 95);
    this.sun.direction.copyFrom(SUN_DIR.scale(-1));
    this.shadow.getShadowMap().refreshRate = 1;
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
