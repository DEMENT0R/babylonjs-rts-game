// Визуальные эффекты: трассеры, вспышки, взрывы, дым, снаряды и маркеры.

import {
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Color3,
  Color4,
  Vector3,
  Quaternion,
  Matrix,
  Mesh,
  PointLight,
  Engine,
} from './babylon.js';
import { FACTIONS } from './config.js';

const color = (hex) => Color3.FromHexString(hex);

function radialTexture(scene, name, draw) {
  const tex = new DynamicTexture(name, { width: 128, height: 128 }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 128, 128);
  draw(ctx);
  tex.hasAlpha = true;
  tex.update(false);
  return tex;
}

function makeSoftTexture(scene) {
  return radialTexture(scene, 'fxSoft', (ctx) => {
    for (const [x, y, r, a] of [
      [64, 64, 60, 0.9],
      [42, 52, 34, 0.6],
      [86, 46, 30, 0.55],
      [70, 86, 28, 0.5],
    ]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.55, `rgba(255,255,255,${a * 0.35})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function makeSparkTexture(scene) {
  return radialTexture(scene, 'fxSpark', (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,245,210,0.95)');
    g.addColorStop(0.45, 'rgba(255,190,90,0.35)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(64, 2);
    ctx.lineTo(64, 126);
    ctx.moveTo(2, 64);
    ctx.lineTo(126, 64);
    ctx.stroke();
  });
}

function makeFlareTexture(scene) {
  return radialTexture(scene, 'fxFlare', (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,236,170,0.8)');
    g.addColorStop(0.55, 'rgba(255,170,70,0.2)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.moveTo(64, 6);
    ctx.lineTo(70, 58);
    ctx.lineTo(122, 64);
    ctx.lineTo(70, 70);
    ctx.lineTo(64, 122);
    ctx.lineTo(58, 70);
    ctx.lineTo(6, 64);
    ctx.lineTo(58, 58);
    ctx.closePath();
    ctx.fill();
  });
}

function makeRingTexture(scene) {
  return radialTexture(scene, 'fxRing', (ctx) => {
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(64, 64, 46, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function makeScorchTexture(scene) {
  return radialTexture(scene, 'fxScorch', (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.5, 'rgba(12,9,6,0.65)');
    g.addColorStop(0.82, 'rgba(25,18,12,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.texSoft = makeSoftTexture(scene);
    this.texSpark = makeSparkTexture(scene);
    this.texFlare = makeFlareTexture(scene);
    this.texRing = makeRingTexture(scene);
    this.texScorch = makeScorchTexture(scene);

    this.mats = {
      smoke: this._puffMat('fxSmokeMat', this.texSoft, '#3c3b37', false, 0.85),
      dust: this._puffMat('fxDustMat', this.texSoft, '#b49a75', false, 0.65),
      fire: this._puffMat('fxFireMat', this.texSpark, '#ff9a3d', true, 1),
      spark: this._puffMat('fxSparkMat', this.texSpark, '#ffe6a3', true, 1),
      flare: this._puffMat('fxFlareMat', this.texFlare, '#ffd08a', true, 1),
      smokeDark: this._puffMat('fxDarkSmokeMat', this.texSoft, '#1a1917', false, 0.9),
    };

    this.puffs = [];
    for (let i = 0; i < 150; i++) {
      const mesh = MeshBuilder.CreatePlane(`puff_${i}`, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.isVisible = false;
      mesh.visibility = 0;
      mesh.metadata = { fx: true };
      this.puffs.push({ mesh, active: false, age: 0, life: 1, vel: new Vector3(), size0: 1, size1: 2, fade: 1, grow: 1 });
    }
    this.puffCursor = 0;

    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const line = MeshBuilder.CreateLines(`tracer_${i}`, { points: [Vector3.Zero(), Vector3.Zero()], updatable: true }, scene);
      line.isPickable = false;
      line.isVisible = false;
      line.alpha = 1;
      this.tracers.push({ mesh: line, active: false, age: 0, life: 0.1, alpha: 1 });
    }
    this.tracerCursor = 0;

    // Снаряды: пули, танковые снаряды и ракеты РСЗО. Капсула вытянута вдоль
    // траектории, поэтому даже быстрые пули хорошо читаются на экране.
    this.projectileKinds = {
      bullet: { scale: [0.62, 0.85, 0.62], speed: 92, trail: 'spark', trailChance: 0.12 },
      shell: { scale: [1.15, 1.45, 1.15], speed: 52, trail: 'smoke', trailChance: 0.7 },
      rocket: { scale: [1.4, 3.1, 1.4], speed: 38, trail: 'smokeDark', trailChance: 0.95 },
    };
    const projectileMats = {
      bulletPlayer: this._projectileMat('fxBulletPlayer', '#bdf6ff', '#5fe4ff'),
      bulletEnemy: this._projectileMat('fxBulletEnemy', '#ffd0b8', '#ff7a48'),
      shell: this._projectileMat('fxProjShell', '#ffe5b0', '#ffb14f'),
      rocket: this._projectileMat('fxProjRocket', '#fff0cc', '#ff8a2e'),
    };
    this.projectiles = [];
    for (let i = 0; i < 96; i++) {
      const mesh = MeshBuilder.CreateCapsule(`proj_${i}`, {
        height: 1,
        radius: 0.085,
        tessellation: 6,
        capSubdivisions: 2,
      }, scene);
      mesh.material = projectileMats.bulletPlayer;
      mesh.isPickable = false;
      mesh.isVisible = false;
      mesh.rotationQuaternion = new Quaternion();
      mesh.metadata = { fx: true };
      this.projectiles.push({
        mesh,
        mats: projectileMats,
        active: false,
        kind: 'bullet',
        t: 0,
        from: new Vector3(),
        to: new Vector3(),
        speed: 90,
        arc: 0,
        faction: 'player',
        onImpact: null,
        trailAcc: 0,
      });
    }
    this.projectileCursor = 0;
    this.up = new Vector3(0, 1, 0);
    this.projectileDir = new Vector3();
    this.rings = [];
    const ringMat = new StandardMaterial('fxShockMat', scene);
    ringMat.diffuseColor = Color3.Black();
    ringMat.emissiveColor = color('#ffb15a');
    ringMat.specularColor = Color3.Black();
    ringMat.alpha = 0.6;
    ringMat.alphaMode = Engine.ALPHA_ADD;
    ringMat.disableLighting = true;
    ringMat.fogEnabled = false;
    for (let i = 0; i < 14; i++) {
      const mesh = MeshBuilder.CreateTorus(`shock_${i}`, { diameter: 4, thickness: 0.22, tessellation: 48 }, scene);
      mesh.rotation.x = 0;
      mesh.position.y = 0.25;
      mesh.material = ringMat;
      mesh.isPickable = false;
      mesh.isVisible = false;
      mesh.visibility = 0;
      this.rings.push({ mesh, active: false, age: 0, life: 0.55, maxScale: 2.6 });
    }
    this.ringCursor = 0;
    this.markers = [];

    this.decals = [];
    const decalMat = new StandardMaterial('fxScorchMat', scene);
    decalMat.diffuseTexture = this.texScorch;
    decalMat.emissiveTexture = this.texScorch;
    decalMat.useAlphaFromDiffuseTexture = true;
    decalMat.disableLighting = true;
    decalMat.specularColor = Color3.Black();
    decalMat.fogEnabled = false;
    decalMat.alpha = 0.75;
    for (let i = 0; i < 24; i++) {
      const mesh = MeshBuilder.CreatePlane(`scorch_${i}`, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
      mesh.rotation.x = Math.PI / 2;
      mesh.material = decalMat;
      mesh.isPickable = false;
      mesh.isVisible = false;
      this.decals.push({ mesh, active: false, age: 0 });
    }
    this.decalCursor = 0;

    // Гильзы: маленькие латунные цилиндры, вылетающие из оружия. Все они —
    // thin instances одного меша, поэтому куча гильз на земле стоит один draw call.
    this.casingMax = 72;
    this.casings = [];
    this.casingCursor = 0;
    this.casingData = new Float32Array(this.casingMax * 16);
    const brass = new StandardMaterial('fxBrassMat', scene);
    brass.diffuseColor = color('#b58b38');
    brass.specularColor = color('#ffe7b0');
    brass.specularPower = 72;
    brass.emissiveColor = color('#2b2007');
    brass.fogEnabled = true;
    const casingMesh = MeshBuilder.CreateCylinder(
      'casingMesh',
      { height: 1, diameter: 1, tessellation: 6, cap: Mesh.CAP_ALL },
      scene,
    );
    casingMesh.material = brass;
    casingMesh.isPickable = false;
    casingMesh.alwaysSelectAsActiveMesh = true;
    casingMesh.doNotSyncBoundingInfo = true;
    casingMesh.thinInstanceSetBuffer('matrix', this.casingData, 16, false);
    casingMesh.thinInstanceCount = 0;
    this.casingMesh = casingMesh;
    for (let i = 0; i < this.casingMax; i++) {
      this.casings.push({
        active: false,
        age: 0,
        life: 4,
        size: 0.09,
        settled: false,
        bounces: 0,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0,
        sx: 0, sy: 0, sz: 0,
      });
    }
    this.casingScale = new Vector3();
    this.casingPos = new Vector3();
    this.casingQuat = new Quaternion();
    this.casingMatrix = new Matrix();
    // Колбэк на первое касание земли: звук гильзы подключается снаружи.
    this.onCasingLand = null;

    this.light = new PointLight('fxFlash', new Vector3(0, 5, 0), scene);    this.light.intensity = 0;
    this.light.range = 26;
    this.light.diffuse = color('#ffae5a');
    this.light.specular = color('#ff8a3a');

    this.smokeAcc = new Map();

    this.tmpA = new Vector3();
    this.tmpB = new Vector3();
    this.excludeFromGlow();
  }

  excludeFromGlow() {
    const glow = this.scene.getGlowLayerByName?.('glow');
    if (!glow?.addExcludedMesh) return;
    const exclude = (mesh) => {
      if (mesh) glow.addExcludedMesh(mesh);
    };
    this.puffs.forEach((p) => exclude(p.mesh));
    this.tracers.forEach((t) => exclude(t.mesh));
    this.rings.forEach((r) => exclude(r.mesh));
    this.decals.forEach((d) => exclude(d.mesh));
    exclude(this.casingMesh);
  }

  _projectileMat(name, diffuse, emissive) {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseColor = color(diffuse);
    m.emissiveColor = color(emissive);
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.fogEnabled = true;
    m.freeze();
    return m;
  }

  _puffMat(name, tex, tint, additive, alpha) {
    const m = new StandardMaterial(name, this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.useAlphaFromDiffuseTexture = true;
    m.diffuseColor = color(tint);
    m.emissiveColor = color(tint).scale(additive ? 1.15 : 0.55);
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = alpha;
    m.alphaMode = additive ? Engine.ALPHA_ADD : Engine.ALPHA_COMBINE;
    m.backFaceCulling = false;
    m.fogEnabled = true;
    return m;
  }

  _getPuff() {
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[this.puffCursor];
      this.puffCursor = (this.puffCursor + 1) % this.puffs.length;
      if (!p.active) return p;
    }
    return null;
  }

  puff(kind, position, opts = {}) {
    const p = this._getPuff();
    if (!p) return;
    const mat = this.mats[kind] ?? this.mats.smoke;
    p.mesh.material = mat;
    p.mesh.position.copyFrom(position);
    p.mesh.isVisible = true;
    p.mesh.visibility = 1;
    p.age = 0;
    p.life = opts.life ?? 1;
    p.size0 = opts.size0 ?? 0.7;
    p.size1 = opts.size1 ?? 1.8;
    p.fade = opts.fade ?? 0.9;
    p.vel.copyFrom(opts.vel ?? Vector3.Zero());
    p.buoyancy = opts.buoyancy ?? 0.6;
    p.drag = opts.drag ?? 0.4;
    p.spin = opts.spin ?? 0;
    p.alpha = opts.alpha ?? 1;
    p.active = true;
    p.mesh.scaling.setAll(p.size0);
    p.mesh.rotation.z = Math.random() * Math.PI * 2;
    return p;
  }

  muzzle(position, faction = 'player', size = 1) {
    this.puff('flare', position, {
      life: 0.09,
      size0: 0.55 * size,
      size1: 1.0 * size,
      fade: 1,
      alpha: 0.95,
      vel: Vector3.Zero(),
    });
    const p = this.puff('spark', position, {
      life: 0.14,
      size0: 0.3 * size,
      size1: 0.9 * size,
      fade: 0.7,
      vel: new Vector3((Math.random() - 0.5) * 2, 0.4, (Math.random() - 0.5) * 2),
      buoyancy: 0,
    });
    if (p) p.mesh.material = this.mats.spark;
  }

  tracer(from, to, faction = 'player', width = 1) {
    let slot = null;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[this.tracerCursor];
      this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
      if (!t.active) {
        slot = t;
        break;
      }
    }
    if (!slot) return;
    const jitter = new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5);
    const a = from.clone();
    const b = to.clone().addInPlace(jitter);
    MeshBuilder.CreateLines(slot.mesh.name, { points: [a, b], instance: slot.mesh }, this.scene);
    const f = FACTIONS[faction] ?? FACTIONS.player;
    slot.mesh.color = color(f.accent);
    slot.mesh.alpha = 1;
    slot.mesh.isVisible = true;
    slot.active = true;
    slot.age = 0;
    slot.life = 0.11 + Math.random() * 0.05;
    slot.alpha = 0.9 * width;
    slot.mesh.alpha = slot.alpha;
  }

  shotTrail(from, to, faction) {
    // для танка: короткая светящаяся трасса в точке выстрела
    this.muzzle(from, faction, 1.5);
  }

  fireShell(from, to, onImpact, speed = 52) {
    return this.fireProjectile({ from, to, kind: 'shell', speed, onImpact });
  }

  /**
   * Запускает видимый снаряд. Урон применяется в onImpact, поэтому попадание
   * совпадает с моментом, когда пуля действительно долетела до цели.
   */
  fireProjectile({ from, to, kind = 'bullet', faction = 'player', speed = null, arc = 0, onImpact = null }) {
    const spec = this.projectileKinds[kind] ?? this.projectileKinds.bullet;
    let slot = null;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[this.projectileCursor];
      this.projectileCursor = (this.projectileCursor + 1) % this.projectiles.length;
      if (!p.active) {
        slot = p;
        break;
      }
    }
    if (!slot) return false;
    slot.active = true;
    slot.kind = kind;
    slot.t = 0;
    slot.from.copyFrom(from);
    slot.to.copyFrom(to);
    slot.speed = speed ?? spec.speed;
    slot.arc = arc ?? (kind === 'rocket' ? 2.4 : 0);
    slot.faction = faction;
    slot.onImpact = onImpact;
    slot.trailAcc = 0;
    const mat = kind === 'bullet'
      ? (faction === 'enemy' ? slot.mats.bulletEnemy : slot.mats.bulletPlayer)
      : slot.mats[kind] ?? slot.mats.shell;
    slot.mesh.material = mat;
    slot.mesh.scaling.set(spec.scale[0], spec.scale[1], spec.scale[2]);
    slot.mesh.position.copyFrom(from);
    slot.mesh.isVisible = true;
    const dir = this.projectileDir.copyFrom(to).subtractInPlace(from);
    if (dir.lengthSquared() > 1e-6) {
      dir.normalize();
      Quaternion.FromUnitVectorsToRef(this.up, dir, slot.mesh.rotationQuaternion);
    }
    return true;
  }

  hit(position, faction = 'enemy', scale = 1) {
    const f = FACTIONS[faction] ?? FACTIONS.player;
    for (let i = 0; i < 5; i++) {
      this.puff('spark', position, {
        life: 0.18 + Math.random() * 0.15,
        size0: 0.2 * scale,
        size1: 0.5 * scale,
        fade: 0.8,
        vel: new Vector3((Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8),
        buoyancy: -4,
        alpha: 0.9,
      });
    }
  }

  explode(position, scale = 1, opts = {}) {
    const count = Math.round(5 + 7 * scale);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6 * scale;
      this.puff('fire', position.clone().add(new Vector3(0, 0.3 + Math.random() * 0.8 * scale, 0)), {
        life: 0.3 + Math.random() * 0.4,
        size0: 0.7 * scale,
        size1: 2.0 * scale,
        fade: 0.9,
        alpha: 1,
        vel: new Vector3(Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp),
        buoyancy: 2.5,
        drag: 2.2,
      });
    }
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 9 * scale;
      this.puff('spark', position, {
        life: 0.25 + Math.random() * 0.5,
        size0: 0.12 * scale,
        size1: 0.4 * scale,
        fade: 1,
        vel: new Vector3(Math.cos(a) * sp, 2 + Math.random() * 7, Math.sin(a) * sp),
        buoyancy: -9,
        drag: 0.6,
      });
    }
    for (let i = 0; i < Math.round(4 + 4 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * 2.5 * scale;
      this.puff('smokeDark', position.clone().add(new Vector3(0, 0.8 + Math.random() * scale, 0)), {
        life: 1.2 + Math.random() * 1.4,
        size0: 0.9 * scale,
        size1: 3.2 * scale,
        fade: 0.55,
        alpha: 0.8,
        vel: new Vector3(Math.cos(a) * sp, 1.8 + Math.random() * 1.6, Math.sin(a) * sp),
        buoyancy: 0.5,
        drag: 0.5,
      });
    }

    this.shockwave(position, scale);
    this.flash(position, 4 * scale);
    if (opts.scorch !== false) this.scorch(position, 5 + scale * 3);
  }

  shockwave(position, scale = 1) {
    let slot = null;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[this.ringCursor];
      this.ringCursor = (this.ringCursor + 1) % this.rings.length;
      if (!r.active) {
        slot = r;
        break;
      }
    }
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.life = 0.45 + 0.15 * scale;
    slot.maxScale = 1.4 + 1.5 * scale;
    slot.mesh.position.set(position.x, 0.2, position.z);
    slot.mesh.scaling.set(0.4, 1, 0.4);
    slot.mesh.isVisible = true;
    slot.mesh.visibility = 0.8;
  }

  flash(position, intensity = 4) {
    this.light.position.set(position.x, Math.max(2, position.y + 2), position.z);
    this.light.intensity = Math.max(this.light.intensity, intensity);
  }

  scorch(position, size = 5) {
    let slot = null;
    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[this.decalCursor];
      this.decalCursor = (this.decalCursor + 1) % this.decals.length;
      if (!d.active) {
        slot = d;
        break;
      }
    }
    if (!slot) {
      slot = this.decals[this.decalCursor];
      this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    }
    slot.active = true;
    slot.mesh.isVisible = true;
    slot.mesh.position.set(position.x, 0.028, position.z);
    slot.mesh.rotation.x = Math.PI / 2;
    slot.mesh.rotation.z = Math.random() * Math.PI * 2;
    slot.mesh.scaling.set(size, size, size);
    slot.mesh.visibility = 0.85;
  }

  repairSparks(position, scale = 1) {
    for (let i = 0; i < 4; i++) {
      const height = 0.8 + Math.random() * 2.4 * scale;
      const px = position.x + (Math.random() - 0.5) * scale * 2.4;
      const pz = position.z + (Math.random() - 0.5) * scale * 2.4;
      this.puff('spark', new Vector3(px, height, pz), {
        life: 0.18 + Math.random() * 0.18,
        size0: 0.12,
        size1: 0.34,
        fade: 1,
        alpha: 0.95,
        vel: new Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3),
        buoyancy: -5,
        drag: 1.2,
      });
    }
  }

  buildDust(position, scale = 1) {    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.2 + Math.random() * 3.5 * scale;
      this.puff('dust', position.clone().add(new Vector3(Math.cos(a) * 1.4 * scale, 0.2, Math.sin(a) * 1.4 * scale)), {
        life: 0.8 + Math.random() * 1.1,
        size0: 0.6 * scale,
        size1: 2.3 * scale,
        fade: 0.7,
        alpha: 0.8,
        vel: new Vector3(Math.cos(a) * sp, 0.6 + Math.random() * 1.2, Math.sin(a) * sp),
        buoyancy: 0.5,
        drag: 1.2,
      });
    }
  }

  impactDust(position, scale = 1) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      this.puff('dust', position.clone().add(new Vector3(0, 0.25, 0)), {
        life: 0.5 + Math.random() * 0.5,
        size0: 0.4 * scale,
        size1: 1.2 * scale,
        fade: 0.6,
        vel: new Vector3(Math.cos(a) * 2, 0.8, Math.sin(a) * 2),
        buoyancy: 0.3,
      });
    }
  }

  orderMarker(position, kind = 'move') {
    const isAttack = kind === 'attack';
    const m = MeshBuilder.CreatePlane('orderMarker', { size: 1, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    const mat = new StandardMaterial('orderMarkerMat', this.scene);
    mat.diffuseTexture = this.texRing;
    mat.emissiveTexture = this.texRing;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = Color3.Black();
    mat.emissiveColor = color(isAttack ? '#ff5b3c' : '#63e6a8');
    mat.diffuseColor = color(isAttack ? '#ff5b3c' : '#63e6a8');
    mat.alpha = 0.9;
    mat.fogEnabled = false;
    m.material = mat;
    m.rotation.x = Math.PI / 2;
    m.position.set(position.x, 0.12, position.z);
    m.isPickable = false;
    m.visibility = 0.85;
    this.scene.getGlowLayerByName?.('glow')?.addExcludedMesh(m);
    this.markers.push({ mesh: m, mat, age: 0, life: 0.55, maxScale: 2.4 });
  }

  damageSmoke(entity, dt) {
    if (!entity.alive) return;
    const frac = entity.hp / entity.maxHp;
    if (frac > 0.52) {
      this.smokeAcc.delete(entity.id);
      return;
    }
    let acc = this.smokeAcc.get(entity.id) ?? 0;
    acc += dt;
    const interval = frac < 0.25 ? 0.24 : 0.55;
    if (acc < interval) {
      this.smokeAcc.set(entity.id, acc);
      return;
    }
    this.smokeAcc.set(entity.id, 0);
    const top = entity.position.clone();
    top.y = entity.def.height * (0.45 + Math.random() * 0.4);
    top.x += (Math.random() - 0.5) * entity.radius * 1.2;
    top.z += (Math.random() - 0.5) * entity.radius * 1.2;
    this.puff('smokeDark', top, {
      life: 1.3 + Math.random() * 1.0,
      size0: 0.4 + entity.radius * 0.16,
      size1: 1.2 + entity.radius * 0.3,
      fade: 0.45,
      alpha: 0.55,
      vel: new Vector3((Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6),
      buoyancy: 0.3,
    });
    if (frac < 0.25 && Math.random() < 0.45) {
      this.puff('fire', top, {
        life: 0.25 + Math.random() * 0.2,
        size0: 0.3,
        size1: 0.8,
        fade: 0.8,
        vel: new Vector3(0, 0.8, 0),
        buoyancy: 1,
      });
    }
  }

  /**
   * Выбрасывает гильзу из оружия. `yaw` — направление ствола, чтобы гильза
   * летела вправо от стрелка, а не в случайную сторону.
   */
  casing(position, yaw = 0, kind = 'rifle') {
    const c = this._freeCasing();
    if (!c) return;
    const shell = kind === 'shell';
    const size = shell ? 1.6 : kind === 'turret' ? 1.25 : 1;
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    // У турелей нет «лица»: гильзы летят в обе стороны.
    const side = kind === 'turret' && Math.random() < 0.5 ? -1 : 1;
    c.active = true;
    c.age = 0;
    c.life = shell ? 5.5 : 3.4 + Math.random() * 1.4;
    c.size = 0.085 * size;
    c.settled = false;
    c.bounces = 0;
    c.x = position.x + rightX * 0.22 * side;
    c.y = position.y;
    c.z = position.z + rightZ * 0.22 * side;
    c.vx = rightX * (1.7 + Math.random() * 1.5) * side + fwdX * (Math.random() - 0.5) * 0.9;
    c.vy = (shell ? 2.0 : 2.5) + Math.random() * 1.2;
    c.vz = rightZ * (1.7 + Math.random() * 1.5) * side + fwdZ * (Math.random() - 0.5) * 0.9;
    c.rx = Math.random() * Math.PI * 2;
    c.ry = Math.random() * Math.PI * 2;
    c.rz = Math.random() * Math.PI * 2;
    c.sx = (Math.random() - 0.5) * 34;
    c.sy = (Math.random() - 0.5) * 34;
    c.sz = (Math.random() - 0.5) * 34;
  }

  _freeCasing() {
    for (let i = 0; i < this.casingMax; i++) {
      const c = this.casings[this.casingCursor];
      this.casingCursor = (this.casingCursor + 1) % this.casingMax;
      if (!c.active) return c;
    }
    const oldest = this.casings[this.casingCursor];
    this.casingCursor = (this.casingCursor + 1) % this.casingMax;
    return oldest;
  }

  _updateCasings(dt) {
    const data = this.casingData;
    let count = 0;
    for (const c of this.casings) {
      if (!c.active) continue;
      c.age += dt;
      if (c.age >= c.life) {
        c.active = false;
        continue;
      }
      if (!c.settled) {
        c.vy -= 22 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.sx * dt;
        c.ry += c.sy * dt;
        c.rz += c.sz * dt;
        if (c.y <= 0.04) {
          c.y = 0.04;
          c.vy = -c.vy * 0.34;
          c.vx *= 0.55;
          c.vz *= 0.55;
          c.sx *= 0.45;
          c.sy *= 0.45;
          c.sz *= 0.45;
          c.bounces++;
          if (c.bounces === 1) this.onCasingLand?.({ x: c.x, y: c.y, z: c.z });
          // Мелкая гильза быстро успокаивается, тяжёлая ещё катится.
          if (Math.abs(c.vy) < 0.6 || c.bounces > 4) {
            c.settled = true;
            c.vx = c.vy = c.vz = 0;
            c.sx = c.sy = c.sz = 0;
          }
        }
      }
      const fade = Math.min(1, (c.life - c.age) / 0.9);
      const s = c.size * (0.55 + 0.45 * fade);
      this.casingScale.set(s, s * 1.85, s);
      this.casingPos.set(c.x, c.y, c.z);
      Quaternion.RotationYawPitchRollToRef(c.ry, c.rx, c.rz, this.casingQuat);
      Matrix.ComposeToRef(this.casingScale, this.casingQuat, this.casingPos, this.casingMatrix);
      data.set(this.casingMatrix.m, count * 16);
      count++;
    }
    this.casingMesh.thinInstanceCount = count;
    if (count > 0) this.casingMesh.thinInstanceBufferUpdated('matrix');
  }

  update(dt) {
    for (const p of this.puffs) {
      if (!p.active) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.active = false;
        p.mesh.isVisible = false;
        continue;
      }
      p.vel.y += p.buoyancy * dt;
      p.vel.scaleInPlace(Math.max(0, 1 - p.drag * dt));
      p.mesh.position.addInPlace(p.vel.scale(dt));
      const size = p.size0 + (p.size1 - p.size0) * Math.min(1, t * 1.4);
      p.mesh.scaling.setAll(size);
      if (p.spin) p.mesh.rotation.z += p.spin * dt;
      const fadeIn = Math.min(1, t * 8);
      p.mesh.visibility = Math.max(0, (1 - t) * fadeIn * p.fade) * (p.alpha ?? 1);
    }

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.active = false;
        t.mesh.isVisible = false;
        continue;
      }
      t.mesh.alpha = t.alpha * (1 - t.age / t.life);
    }

    for (const s of this.projectiles) {
      if (!s.active) continue;
      const length = Vector3.Distance(s.from, s.to);
      s.t += (s.speed * dt) / Math.max(0.001, length);
      if (s.t >= 1) {
        s.active = false;
        s.mesh.isVisible = false;
        const cb = s.onImpact;
        s.onImpact = null;
        if (cb) cb(s.to);
        continue;
      }
      const pos = Vector3.Lerp(s.from, s.to, s.t);
      if (s.arc) pos.y += Math.sin(Math.PI * s.t) * s.arc;
      s.mesh.position.copyFrom(pos);

      const spec = this.projectileKinds[s.kind] ?? this.projectileKinds.bullet;
      s.trailAcc += dt;
      const interval = s.kind === 'rocket' ? 0.035 : s.kind === 'shell' ? 0.07 : 0.14;
      if (s.trailAcc >= interval) {
        s.trailAcc = 0;
        if (Math.random() < spec.trailChance) {
          this.puff(spec.trail, pos, {
            life: s.kind === 'rocket' ? 0.55 : 0.26,
            size0: s.kind === 'rocket' ? 0.22 : 0.1,
            size1: s.kind === 'rocket' ? 0.9 : 0.34,
            fade: 0.5,
            alpha: s.kind === 'rocket' ? 0.65 : 0.4,
            vel: s.kind === 'rocket'
              ? new Vector3((Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4)
              : Vector3.Zero(),
            buoyancy: 0.2,
          });
        }
        if (s.kind === 'rocket') {
          this.puff('fire', pos, {
            life: 0.14,
            size0: 0.28,
            size1: 0.7,
            fade: 0.8,
            vel: Vector3.Zero(),
            buoyancy: 0.4,
          });
        }
      }
    }

    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.isVisible = false;
        continue;
      }
      const s = 0.35 + (r.maxScale - 0.35) * (1 - Math.pow(1 - t, 3));
      r.mesh.scaling.set(s, s, s);
      r.mesh.visibility = (1 - t) * 0.8;
    }

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const marker = this.markers[i];
      marker.age += dt;
      const t = marker.age / marker.life;
      if (t >= 1) {
        marker.mesh.dispose();
        this.markers.splice(i, 1);
        continue;
      }
      const s = 1 + marker.maxScale * (1 - Math.pow(1 - t, 3));
      marker.mesh.scaling.set(s, s, s);
      marker.mesh.visibility = (1 - t) * 0.9;
    }

    if (this.light.intensity > 0.01) {
      this.light.intensity = Math.max(0, this.light.intensity - dt * 26);
    } else {
      this.light.intensity = 0;
    }

    this._updateCasings(dt);
  }
}

