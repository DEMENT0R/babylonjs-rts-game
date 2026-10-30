// Модели из примитивов Babylon.js.
// Каждая модель — TransformNode с деталями; части, которые анимируются,
// возвращаются в parts.

import {
  B,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Color3,
  Vector3,
  Mesh,
} from './babylon.js';
import { FACTIONS } from './config.js';
import { rngRange } from './utils.js';

const hex = (value) => Color3.FromHexString(value);

export class ModelFactory {
  constructor(scene) {
    this.scene = scene;
    this.materials = new Map();
    this.templates = new Map();
  }

  color(faction, key) {
    return FACTIONS[faction]?.[key] ?? FACTIONS.neutral?.[key] ?? '#808080';
  }

  /** Кэшированный StandardMaterial. */
  mat(key, opts = {}) {
    const cacheKey = `${key}:${JSON.stringify(opts)}`;
    if (this.materials.has(cacheKey)) return this.materials.get(cacheKey);

    const name = `mat_${key}_${this.materials.size}`;
    const m = new StandardMaterial(name, this.scene);
    if (opts.color) m.diffuseColor = hex(opts.color);
    if (opts.emissive) m.emissiveColor = hex(opts.emissive);
    if (opts.specular !== undefined) {
      m.specularColor = new Color3(opts.specular, opts.specular, opts.specular);
    } else {
      m.specularColor = new Color3(0.22, 0.26, 0.3);
    }
    m.specularPower = opts.shininess ?? 48;
    if (opts.alpha !== undefined) {
      m.alpha = opts.alpha;
      // Depth-prepass для полупрозрачных объектов в Babylon может «съедать»
      // цвет при alpha-смешивании. Включаем только там, где он действительно нужен.
      m.needDepthPrePass = opts.depthPrePass === true;
    }
    if (opts.unlit) {
      m.disableLighting = true;
      m.emissiveColor = hex(opts.color ?? '#ffffff');
      if (opts.emissive) m.emissiveColor = hex(opts.emissive);
    }
    if (opts.backFaceCulling === false) m.backFaceCulling = false;
    if (opts.fog === false) m.fogEnabled = false;
    if (opts.depthWrite === false) m.disableDepthWrite = true;
    m.freeze();
    this.materials.set(cacheKey, m);
    return m;
  }

  factionMat(faction, kind) {
    const f = FACTIONS[faction];
    switch (kind) {
      case 'hull':
        return this.mat(`hull_${faction}`, { color: f.primary, specular: 0.16, shininess: 72 });
      case 'panel':
        return this.mat(`panel_${faction}`, { color: f.secondary, specular: 0.12 });
      case 'trim':
        return this.mat(`trim_${faction}`, { color: f.light, specular: 0.25 });
      case 'accent':
        return this.mat(`accent_${faction}`, {
          color: f.accent,
          emissive: f.glow,
          specular: 0,
          unlit: true,
        });
      case 'glow':
        return this.mat(`glow_${faction}`, {
          color: f.glow,
          emissive: f.glow,
          specular: 0,
          unlit: true,
        });
      case 'dark':
        return this.mat('dark', { color: '#141c22', specular: 0.08 });
      case 'steel':
        return this.mat('steel', { color: '#4d565e', specular: 0.25, shininess: 80 });
      case 'concrete':
        return this.mat('concrete', { color: '#565149', specular: 0.04 });
      case 'rust':
        return this.mat('rust', { color: '#6d4b36', specular: 0.05 });
      case 'rubber':
        return this.mat('rubber', { color: '#121518', specular: 0.05 });
      default:
        return this.mat(`hull_${faction}`, { color: f.primary });
    }
  }

  baseMaterials(faction) {
    return {
      hull: this.factionMat(faction, 'hull'),
      panel: this.factionMat(faction, 'panel'),
      trim: this.factionMat(faction, 'trim'),
      accent: this.factionMat(faction, 'accent'),
      glow: this.factionMat(faction, 'glow'),
      dark: this.factionMat(faction, 'dark'),
      steel: this.factionMat(faction, 'steel'),
      concrete: this.factionMat(faction, 'concrete'),
      rust: this.factionMat(faction, 'rust'),
      rubber: this.factionMat(faction, 'rubber'),
      glass: this.mat('glass', { color: '#8eeeff', emissive: '#2b8ca3', alpha: 0.55, specular: 0.8 }),
      warn: this.mat('warn', { color: '#ffb02e', emissive: '#ff8a1e', unlit: true }),
      white: this.mat('white', { color: '#d8e5ea', specular: 0.35 }),
      oil: this.mat('oil', { color: '#090807', specular: 0.9, shininess: 120 }),
    };
  }

  cloneTemplate(key, build) {
    let template = this.templates.get(key);
    if (!template) {
      template = build();
      this.optimizeTemplate(template.root, template.parts);
      template.root.position.y = -500;
      template.root.setEnabled(true);
      template.root.name = `tpl_${key}`;
      this.templates.set(key, template);
    }
    const root = template.root.clone(`model_${key}_${(Math.random() * 1e9) | 0}`, null);
    root.position.y = 0;
    root.setEnabled(true);
    // Babylon добавляет к именам клонированных детей префикс корня и путь
    // родителей (`root.turret.barrelgroup.muzzle`). Сопоставляем части по
    // относительному пути, иначе анимации и дула указывали на шаблон,
    // который стоит под землёй на y = -500.
    const byName = new Map();
    const byPath = new Map();
    const prefix = `${root.name}.`;
    for (const node of root.getDescendants(false)) {
      if (!node.name) continue;
      byName.set(node.name, node);
      byPath.set(node.name.startsWith(prefix) ? node.name.slice(prefix.length) : node.name, node);
    }
    const pathOf = (node) => {
      const path = [];
      let current = node;
      while (current && current !== template.root) {
        path.unshift(current.name);
        current = current.parent;
      }
      return path.join('.');
    };
    const resolve = (node) => {
      if (!node || !node.name) return node;
      return byPath.get(pathOf(node)) ?? byName.get(node.name) ?? node;
    };
    const parts = {};
    for (const [name, value] of Object.entries(template.parts)) {
      if (Array.isArray(value)) {
        parts[name] = value.map((v) => resolve(v));
      } else if (value && value.name) {
        parts[name] = resolve(value);
      } else {
        parts[name] = value;
      }
    }
    return { root, parts, height: template.height };
  }

  /**
   * Склеивает статичные части модели по материалам, чтобы сократить число
   * draw call'ов. Анимированные узлы (башня, радар, ноги и т.п.) не трогаем.
   */
  optimizeTemplate(root, parts) {
    const protectedMeshes = new Set();
    const protectNode = (node) => {
      if (!node) return;
      if (node.getClassName?.() === 'Mesh') protectedMeshes.add(node);
      if (node.getChildMeshes) {
        node.getChildMeshes(false).forEach((mesh) => protectedMeshes.add(mesh));
      }
    };
    for (const value of Object.values(parts)) {
      if (Array.isArray(value)) value.forEach(protectNode);
      else if (value && typeof value.getChildMeshes === 'function') protectNode(value);
    }

    const groups = new Map();
    for (const mesh of root.getChildMeshes(false)) {
      if (protectedMeshes.has(mesh)) continue;
      if (mesh.getClassName?.() !== 'Mesh') continue;
      if (!mesh.material) continue;
      const key = mesh.material.name;
      if (!groups.has(key)) groups.set(key, { material: mesh.material, meshes: [] });
      groups.get(key).meshes.push(mesh);
    }

    let mergedCount = 0;
    for (const { material, meshes } of groups.values()) {
      if (meshes.length < 2) continue;
      const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `merged_${material.name}_${mergedCount++}`;
      merged.material = material;
      merged.parent = root;
      merged.isPickable = false;
      merged.receiveShadows = true;
      merged.castShadow = true;
      merged.position.set(0, 0, 0);
      merged.rotation.set(0, 0, 0);
      merged.scaling.set(1, 1, 1);
    }
  }

  unit(type, faction) {
    const build = {
      marine: () => this.buildMarine(faction),
      scout: () => this.buildScout(faction),
      tank: () => this.buildTank(faction),
      artillery: () => this.buildArtillery(faction),
    }[type];
    return this.cloneTemplate(`unit:${type}:${faction}`, build);
  }

  building(type, faction) {
    const build = {
      hq: () => this.buildHQ(faction),
      power: () => this.buildPower(faction),
      barracks: () => this.buildBarracks(faction),
      derrick: () => this.buildDerrick(faction),
    }[type];
    return this.cloneTemplate(`building:${type}:${faction}`, build);
  }

  // ---------------------------------------------------------------- UNIT: MARINE
  buildMarine(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`marine_${faction}`, this.scene);
    const parts = {};

    const add = (mesh, parent = root) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    // ноги
    const hips = [];
    for (const side of [-1, 1]) {
      const hip = new TransformNode(`hip_${side}`, this.scene);
      hip.parent = root;
      hip.position.set(0.24 * side, 0.92, 0);
      const leg = MeshBuilder.CreateBox(`leg_${side}`, { width: 0.3, height: 0.78, depth: 0.34 }, this.scene);
      leg.position.y = -0.4;
      add(leg, hip).material = m.panel;
      const knee = MeshBuilder.CreateBox(`knee_${side}`, { width: 0.34, height: 0.24, depth: 0.4 }, this.scene);
      knee.position.set(0, -0.66, 0.03);
      add(knee, hip).material = m.dark;
      const boot = MeshBuilder.CreateBox(`boot_${side}`, { width: 0.4, height: 0.22, depth: 0.56 }, this.scene);
      boot.position.set(0, -0.85, 0.1);
      add(boot, hip).material = m.rubber;
      hips.push(hip);
    }

    const torso = MeshBuilder.CreateBox('torso', { width: 0.96, height: 0.8, depth: 0.56 }, this.scene);
    torso.position.y = 1.38;
    add(torso).material = m.hull;

    const abdomen = MeshBuilder.CreateBox('abdomen', { width: 0.58, height: 0.26, depth: 0.46 }, this.scene);
    abdomen.position.y = 0.92;
    add(abdomen).material = m.dark;

    const plate = MeshBuilder.CreateBox('chestplate', { width: 0.58, height: 0.42, depth: 0.14 }, this.scene);
    plate.position.set(0, 1.44, 0.32);
    add(plate).material = m.trim;

    const stripe = MeshBuilder.CreateBox('cheststripe', { width: 0.44, height: 0.07, depth: 0.16 }, this.scene);
    stripe.position.set(0, 1.3, 0.33);
    add(stripe).material = m.accent;

    for (const side of [-1, 1]) {
      const pad = MeshBuilder.CreateBox(`shoulder_${side}`, { width: 0.36, height: 0.32, depth: 0.52 }, this.scene);
      pad.position.set(0.62 * side, 1.68, 0);
      pad.rotation.z = -0.22 * side;
      add(pad).material = m.panel;
      const padStripe = MeshBuilder.CreateBox(`shoulderstripe_${side}`, { width: 0.06, height: 0.2, depth: 0.4 }, this.scene);
      padStripe.position.set(0.62 * side + 0.2 * side, 1.69, 0);
      add(padStripe).material = m.accent;
    }

    const helmet = MeshBuilder.CreateSphere('helmet', { diameter: 0.48, segments: 10 }, this.scene);
    helmet.position.set(0, 1.94, 0.02);
    helmet.scaling.set(1, 0.9, 1);
    add(helmet).material = m.panel;

    const helmetTop = MeshBuilder.CreateSphere('helmettop', { diameter: 0.4, segments: 8 }, this.scene);
    helmetTop.position.set(0, 2.04, -0.01);
    helmetTop.scaling.set(1, 0.55, 1);
    add(helmetTop).material = m.hull;

    const crest = MeshBuilder.CreateBox('crest', { width: 0.1, height: 0.08, depth: 0.36 }, this.scene);
    crest.position.set(0, 2.13, -0.01);
    add(crest).material = m.accent;

    const visor = MeshBuilder.CreateBox('visor', { width: 0.38, height: 0.14, depth: 0.1 }, this.scene);
    visor.position.set(0, 1.96, 0.23);
    add(visor).material = m.glass;

    const pack = MeshBuilder.CreateBox('backpack', { width: 0.62, height: 0.58, depth: 0.3 }, this.scene);
    pack.position.set(0, 1.42, -0.42);
    add(pack).material = m.dark;
    for (const side of [-1, 1]) {
      const tank = MeshBuilder.CreateCylinder(`airtank_${side}`, { diameter: 0.18, height: 0.42, tessellation: 8 }, this.scene);
      tank.position.set(0.18 * side, 1.72, -0.45);
      add(tank).material = m.steel;
    }

    // руки
    const arms = [];
    for (const side of [-1, 1]) {
      const arm = new TransformNode(`arm_${side}`, this.scene);
      arm.parent = root;
      arm.position.set(0.58 * side, 1.62, 0);
      const upper = MeshBuilder.CreateBox(`upperarm_${side}`, { width: 0.22, height: 0.48, depth: 0.26 }, this.scene);
      upper.position.y = -0.23;
      add(upper, arm).material = m.panel;
      const hand = MeshBuilder.CreateBox(`hand_${side}`, { width: 0.22, height: 0.22, depth: 0.26 }, this.scene);
      hand.position.set(0, -0.52, 0.06);
      add(hand, arm).material = m.dark;
      arms.push(arm);
    }

    // оружие в правой руке
    const gun = MeshBuilder.CreateBox('gun', { width: 0.2, height: 0.24, depth: 0.95 }, this.scene);
    gun.position.set(0, -0.55, 0.55);
    add(gun, arms[1]).material = m.dark;
    const gunGlow = MeshBuilder.CreateBox('gunglow', { width: 0.08, height: 0.08, depth: 0.5 }, this.scene);
    gunGlow.position.set(0, -0.43, 0.5);
    add(gunGlow, arms[1]).material = m.accent;
    const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: 0.1, height: 0.5, tessellation: 8 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, -0.55, 1.15);
    add(barrel, arms[1]).material = m.steel;

    const muzzle = new TransformNode('muzzle', this.scene);
    muzzle.parent = arms[1];
    muzzle.position.set(0, -0.55, 1.45);

    parts.hips = hips;
    parts.arms = arms;
    parts.muzzle = muzzle;
    parts.gun = gun;
    parts.height = 2.35;
    return { root, parts, height: 2.35 };
  }

  // ---------------------------------------------------------------- UNIT: SCOUT
  buildScout(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`scout_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    const chassis = MeshBuilder.CreateBox('chassis', { width: 1.7, height: 0.32, depth: 2.5 }, this.scene);
    chassis.position.y = 0.58;
    add(chassis).material = m.hull;

    const nose = MeshBuilder.CreateBox('nose', { width: 1.5, height: 0.28, depth: 0.8 }, this.scene);
    nose.position.set(0, 0.64, 1.45);
    nose.rotation.x = 0.28;
    add(nose).material = m.panel;

    const stripe = MeshBuilder.CreateBox('sidestripe', { width: 1.76, height: 0.08, depth: 1.1 }, this.scene);
    stripe.position.set(0, 0.6, 0);
    add(stripe).material = m.accent;

    // колёса
    const wheels = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const axle = new TransformNode(`axle_${sx}_${sz}`, this.scene);
        axle.parent = root;
        axle.position.set(0.92 * sx, 0.42, 0.82 * sz);
        axle.rotation.z = Math.PI / 2;
        const wheel = MeshBuilder.CreateCylinder(`wheel_${sx}_${sz}`, { diameter: 0.86, height: 0.36, tessellation: 12 }, this.scene);
        add(wheel, axle).material = m.rubber;
        const hub = MeshBuilder.CreateCylinder(`hub_${sx}_${sz}`, { diameter: 0.3, height: 0.38, tessellation: 8 }, this.scene);
        add(hub, axle).material = m.trim;
        wheels.push(wheel, hub);
      }
    }

    // рама и водитель
    const seat = MeshBuilder.CreateBox('seat', { width: 0.6, height: 0.3, depth: 0.7 }, this.scene);
    seat.position.set(0, 0.9, -0.15);
    add(seat).material = m.dark;

    const rider = MeshBuilder.CreateBox('rider', { width: 0.5, height: 0.65, depth: 0.4 }, this.scene);
    rider.position.set(0, 1.22, -0.05);
    add(rider).material = m.panel;

    const head = MeshBuilder.CreateSphere('riderhead', { diameter: 0.38, segments: 8 }, this.scene);
    head.position.set(0, 1.64, 0.02);
    add(head).material = m.panel;

    const crest = MeshBuilder.CreateBox('ridercrest', { width: 0.08, height: 0.07, depth: 0.3 }, this.scene);
    crest.position.set(0, 1.84, -0.02);
    add(crest).material = m.accent;

    const visor = MeshBuilder.CreateBox('ridervisor', { width: 0.32, height: 0.12, depth: 0.1 }, this.scene);
    visor.position.set(0, 1.65, 0.19);
    add(visor).material = m.glass;

    for (const side of [-1, 1]) {
      const bar = MeshBuilder.CreateBox(`cage_${side}`, { width: 0.09, height: 1.15, depth: 0.09 }, this.scene);
      bar.position.set(0.5 * side, 1.15, -0.45);
      bar.rotation.x = -0.2;
      add(bar).material = m.dark;
    }
    const cageTop = MeshBuilder.CreateBox('cagetop', { width: 1.1, height: 0.09, depth: 0.09 }, this.scene);
    cageTop.position.set(0, 1.68, -0.57);
    add(cageTop).material = m.dark;

    // двигатель и выхлоп
    const engine = MeshBuilder.CreateBox('engine', { width: 1.1, height: 0.5, depth: 0.7 }, this.scene);
    engine.position.set(0, 0.85, -1.2);
    add(engine).material = m.dark;
    for (const side of [-1, 1]) {
      const pipe = MeshBuilder.CreateCylinder(`exhaust_${side}`, { diameter: 0.14, height: 0.55, tessellation: 6 }, this.scene);
      pipe.position.set(0.38 * side, 1.1, -1.45);
      pipe.rotation.x = 0.35;
      add(pipe).material = m.steel;
    }

    // спаренные бластеры
    const muzzles = [];
    for (const side of [-1, 1]) {
      const gun = MeshBuilder.CreateCylinder(`scoutgun_${side}`, { diameter: 0.14, height: 1.1, tessellation: 8 }, this.scene);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(0.4 * side, 0.92, 1.55);
      add(gun).material = m.steel;
      const tip = MeshBuilder.CreateCylinder(`scouttip_${side}`, { diameter: 0.2, height: 0.18, tessellation: 8 }, this.scene);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(0.4 * side, 0.92, 2.1);
      add(tip).material = m.accent;
      const muzzle = new TransformNode(`scoutmuzzle_${side}`, this.scene);
      muzzle.parent = root;
      muzzle.position.set(0.4 * side, 0.92, 2.25);
      muzzles.push(muzzle);
    }

    const headlight = MeshBuilder.CreateSphere('headlight', { diameter: 0.18, segments: 6 }, this.scene);
    headlight.position.set(0, 0.72, 2.05);
    add(headlight).material = m.glow;

    parts.wheels = wheels;
    parts.muzzles = muzzles;
    parts.height = 1.9;
    return { root, parts, height: 1.9 };
  }

  // ---------------------------------------------------------------- UNIT: TANK
  buildTank(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`tank_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    const hull = MeshBuilder.CreateBox('hull', { width: 3.05, height: 0.72, depth: 2.2 }, this.scene);
    hull.position.y = 0.88;
    add(hull).material = m.hull;

    const glacis = MeshBuilder.CreateBox('glacis', { width: 2.95, height: 0.5, depth: 1.0 }, this.scene);
    glacis.position.set(0, 1.02, 1.28);
    glacis.rotation.x = 0.38;
    add(glacis).material = m.panel;

    const rear = MeshBuilder.CreateBox('rear', { width: 2.7, height: 0.55, depth: 0.5 }, this.scene);
    rear.position.set(0, 0.9, -1.25);
    add(rear).material = m.dark;

    for (const side of [-1, 1]) {
      const track = MeshBuilder.CreateBox(`track_${side}`, { width: 0.72, height: 0.72, depth: 2.95 }, this.scene);
      track.position.set(1.45 * side, 0.48, 0);
      add(track).material = m.rubber;

      const fender = MeshBuilder.CreateBox(`fender_${side}`, { width: 0.86, height: 0.14, depth: 3.1 }, this.scene);
      fender.position.set(1.45 * side, 0.9, 0);
      add(fender).material = m.panel;

      for (let i = 0; i < 5; i++) {
        const wheel = MeshBuilder.CreateCylinder(`roadwheel_${side}_${i}`, { diameter: 0.54, height: 0.76, tessellation: 10 }, this.scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(1.45 * side, 0.42, -1.05 + i * 0.52);
        add(wheel).material = m.dark;
      }

      const stripe = MeshBuilder.CreateBox(`tankstripe_${side}`, { width: 0.06, height: 0.18, depth: 1.5 }, this.scene);
      stripe.position.set(1.54 * side, 0.98, 0.1);
      add(stripe).material = m.accent;
    }

    // башня
    const turret = new TransformNode('turret', this.scene);
    turret.parent = root;
    turret.position.y = 1.22;

    const turretBase = MeshBuilder.CreateCylinder('turretbase', { diameter: 2.15, height: 0.5, tessellation: 8 }, this.scene);
    turretBase.position.y = 0.25;
    add(turretBase, turret).material = m.dark;

    const turretBody = MeshBuilder.CreateBox('turretbody', { width: 1.85, height: 0.62, depth: 1.95 }, this.scene);
    turretBody.position.set(0, 0.6, -0.06);
    add(turretBody, turret).material = m.hull;

    const turretFront = MeshBuilder.CreateBox('turretfront', { width: 1.7, height: 0.5, depth: 0.55 }, this.scene);
    turretFront.position.set(0, 0.6, 1.05);
    turretFront.rotation.x = 0.3;
    add(turretFront, turret).material = m.panel;

    const hatch = MeshBuilder.CreateCylinder('hatch', { diameter: 0.62, height: 0.16, tessellation: 10 }, this.scene);
    hatch.position.set(-0.42, 0.98, -0.35);
    add(hatch, turret).material = m.steel;

    const antenna = MeshBuilder.CreateCylinder('antenna', { diameter: 0.035, height: 1.25, tessellation: 4 }, this.scene);
    antenna.position.set(0.66, 1.35, -0.5);
    antenna.rotation.z = -0.12;
    add(antenna, turret).material = m.dark;

    const turretStripe = MeshBuilder.CreateBox('turretstripe', { width: 1.86, height: 0.07, depth: 0.12 }, this.scene);
    turretStripe.position.set(0, 0.88, -0.62);
    add(turretStripe, turret).material = m.accent;

    // ствол
    const barrelGroup = new TransformNode('barrelgroup', this.scene);
    barrelGroup.parent = turret;
    barrelGroup.position.set(0, 0.62, 0.6);
    const barrel = MeshBuilder.CreateCylinder('tankbarrel', { diameter: 0.22, height: 2.5, tessellation: 10 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 1.15;
    add(barrel, barrelGroup).material = m.steel;
    const mantle = MeshBuilder.CreateBox('mantlet', { width: 0.5, height: 0.45, depth: 0.5 }, this.scene);
    mantle.position.z = 0.15;
    add(mantle, barrelGroup).material = m.dark;
    const brake = MeshBuilder.CreateBox('muzzlebrake', { width: 0.3, height: 0.28, depth: 0.5 }, this.scene);
    brake.position.z = 2.3;
    add(brake, barrelGroup).material = m.dark;
    const muzzle = new TransformNode('muzzle', this.scene);
    muzzle.parent = barrelGroup;
    muzzle.position.set(0, 0, 2.62);

    parts.turret = turret;
    parts.barrelGroup = barrelGroup;
    parts.barrel = barrel;
    parts.muzzle = muzzle;
    parts.height = 2.9;
    return { root, parts, height: 2.9 };
  }

  // -------------------------------------------------------------- UNIT: ARTILLERY
  buildArtillery(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`artillery_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      return mesh;
    };

    // Шасси: длинный шестиколёсный грузовик.
    const chassis = MeshBuilder.CreateBox('artchassis', { width: 2.45, height: 0.52, depth: 4.5 }, this.scene);
    chassis.position.y = 0.98;
    add(chassis).material = m.hull;

    const underbody = MeshBuilder.CreateBox('artunder', { width: 2.2, height: 0.32, depth: 3.9 }, this.scene);
    underbody.position.y = 0.6;
    add(underbody).material = m.dark;

    const cab = MeshBuilder.CreateBox('artcab', { width: 2.35, height: 0.95, depth: 1.25 }, this.scene);
    cab.position.set(0, 1.68, 1.55);
    add(cab).material = m.panel;

    const windshield = MeshBuilder.CreateBox('artglass', { width: 1.9, height: 0.48, depth: 0.08 }, this.scene);
    windshield.position.set(0, 1.88, 2.2);
    windshield.rotation.x = 0.12;
    add(windshield).material = m.glass;

    const bumper = MeshBuilder.CreateBox('artbumper', { width: 2.5, height: 0.3, depth: 0.3 }, this.scene);
    bumper.position.set(0, 0.78, 2.32);
    add(bumper).material = m.steel;

    for (const side of [-1, 1]) {
      const headlight = MeshBuilder.CreateSphere(`artlight_${side}`, { diameter: 0.2, segments: 6 }, this.scene);
      headlight.position.set(0.78 * side, 1.36, 2.26);
      add(headlight).material = m.glow;
    }

    const wheels = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wheel = MeshBuilder.CreateCylinder(`artwheel_${side}_${i}`, {
          diameter: 0.92,
          height: 0.58,
          tessellation: 12,
        }, this.scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(1.3 * side, 0.5, -1.45 + i * 1.45);
        add(wheel).material = m.rubber;

        const hub = MeshBuilder.CreateCylinder(`arthub_${side}_${i}`, {
          diameter: 0.34,
          height: 0.62,
          tessellation: 8,
        }, this.scene);
        hub.rotation.z = Math.PI / 2;
        hub.position.set(1.3 * side, 0.5, -1.45 + i * 1.45);
        add(hub).material = m.steel;
        wheels.push(wheel);
      }

      const stripe = MeshBuilder.CreateBox(`artstripe_${side}`, { width: 0.06, height: 0.16, depth: 2.7 }, this.scene);
      stripe.position.set(1.24 * side, 1.08, -0.35);
      add(stripe).material = m.accent;

      const jack = MeshBuilder.CreateBox(`artjack_${side}`, { width: 0.22, height: 0.9, depth: 0.22 }, this.scene);
      jack.position.set(1.02 * side, 0.55, -1.95);
      jack.rotation.x = -0.25;
      add(jack).material = m.steel;
    }

    const bed = MeshBuilder.CreateBox('artbed', { width: 2.2, height: 0.18, depth: 2.5 }, this.scene);
    bed.position.set(0, 1.3, -0.85);
    add(bed).material = m.dark;

    // Пусковая установка: поворотная платформа с пакетом направляющих.
    const launcher = new TransformNode('artlauncher', this.scene);
    launcher.parent = root;
    launcher.position.set(0, 1.45, -0.75);

    const base = MeshBuilder.CreateCylinder('artbase', { diameter: 2.15, height: 0.26, tessellation: 10 }, this.scene);
    base.position.y = 0.13;
    add(base, launcher).material = m.dark;

    const rack = new TransformNode('artrack', this.scene);
    rack.parent = launcher;
    rack.position.y = 0.28;
    rack.rotation.x = -0.38;

    const rackBody = MeshBuilder.CreateBox('artrackbody', { width: 2.05, height: 0.3, depth: 2.3 }, this.scene);
    add(rackBody, rack).material = m.panel;

    const backPlate = MeshBuilder.CreateBox('artbackplate', { width: 2.0, height: 0.85, depth: 0.16 }, this.scene);
    backPlate.position.set(0, 0.32, -1.04);
    add(backPlate, rack).material = m.hull;

    const muzzles = [];
    let tubeIndex = 0;
    for (let row = 0; row < 2; row++) {
      for (const x of [-0.62, 0, 0.62]) {
        const tube = MeshBuilder.CreateCylinder(`arttube_${tubeIndex}`, {
          diameter: 0.24,
          height: 2.15,
          tessellation: 8,
        }, this.scene);
        tube.rotation.x = Math.PI / 2;
        tube.position.set(x, 0.34 + row * 0.4, 0.28);
        add(tube, rack).material = m.steel;

        const band = MeshBuilder.CreateCylinder(`artband_${tubeIndex}`, {
          diameter: 0.29,
          height: 0.08,
          tessellation: 8,
        }, this.scene);
        band.rotation.x = Math.PI / 2;
        band.position.set(x, 0.34 + row * 0.4, 1.28);
        add(band, rack).material = m.accent;

        const muzzle = new TransformNode(`artmuzzle_${tubeIndex}`, this.scene);
        muzzle.parent = rack;
        muzzle.position.set(x, 0.34 + row * 0.4, 1.52);
        muzzles.push(muzzle);
        tubeIndex++;
      }
    }

    const rackStripe = MeshBuilder.CreateBox('artrackstripe', { width: 1.98, height: 0.06, depth: 0.1 }, this.scene);
    rackStripe.position.set(0, 0.47, 0.9);
    add(rackStripe, rack).material = m.accent;

    parts.wheels = wheels;
    parts.turret = launcher;
    parts.barrelGroup = rack;
    parts.muzzles = muzzles;
    parts.height = 3.2;
    return { root, parts, height: 3.2 };
  }

  // ---------------------------------------------------------------- BUILDING: HQ
  buildHQ(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`hq_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root, shadow = true) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = shadow;
      return mesh;
    };

    const pad = MeshBuilder.CreateCylinder('pad', { diameter: 11.4, height: 0.35, tessellation: 24 }, this.scene);
    pad.position.y = 0.17;
    add(pad, root, false).material = m.concrete;

    const padRing = MeshBuilder.CreateTorus('padring', { diameter: 10.7, thickness: 0.16, tessellation: 48 }, this.scene);
    padRing.position.y = 0.38;
    add(padRing, root, false).material = m.accent;

    const base = MeshBuilder.CreateBox('base', { width: 8.4, height: 0.7, depth: 8.4 }, this.scene);
    base.position.y = 0.6;
    add(base).material = m.dark;

    const tier1 = MeshBuilder.CreateBox('tier1', { width: 7.2, height: 1.5, depth: 7.2 }, this.scene);
    tier1.position.y = 1.7;
    add(tier1).material = m.panel;

    const tier2 = MeshBuilder.CreateBox('tier2', { width: 6.1, height: 1.6, depth: 6.1 }, this.scene);
    tier2.position.y = 3.2;
    add(tier2).material = m.hull;

    const tier3 = MeshBuilder.CreateBox('tier3', { width: 4.7, height: 1.25, depth: 4.7 }, this.scene);
    tier3.position.y = 4.6;
    add(tier3).material = m.panel;

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pylon = MeshBuilder.CreateBox(`pylon_${sx}_${sz}`, { width: 0.5, height: 3.2, depth: 0.5 }, this.scene);
        pylon.position.set(3.55 * sx, 2.7, 3.55 * sz);
        add(pylon).material = m.dark;
        const light = MeshBuilder.CreateBox(`pylonlight_${sx}_${sz}`, { width: 0.2, height: 0.2, depth: 0.2 }, this.scene);
        light.position.set(3.55 * sx, 4.35, 3.55 * sz);
        add(light, root, false).material = m.accent;
      }
    }

    for (const side of [-1, 1]) {
      const stripX = MeshBuilder.CreateBox(`stripX_${side}`, { width: 3.8, height: 0.12, depth: 0.08 }, this.scene);
      stripX.position.set(0, 2.65, 3.07 * side);
      add(stripX, root, false).material = m.accent;
      const stripZ = MeshBuilder.CreateBox(`stripZ_${side}`, { width: 0.08, height: 0.12, depth: 3.8 }, this.scene);
      stripZ.position.set(3.07 * side, 2.65, 0);
      add(stripZ, root, false).material = m.accent;
    }

    // окна командного уровня
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const win = MeshBuilder.CreateBox(`hqwindowX_${side}_${i}`, { width: 0.62, height: 0.3, depth: 0.07 }, this.scene);
        win.position.set(i * 1.45, 3.35, 3.06 * side);
        add(win, root, false).material = m.glass;
        const winZ = MeshBuilder.CreateBox(`hqwindowZ_${side}_${i}`, { width: 0.07, height: 0.3, depth: 0.62 }, this.scene);
        winZ.position.set(3.06 * side, 3.35, i * 1.45);
        add(winZ, root, false).material = m.glass;
      }
    }

    const drum = MeshBuilder.CreateCylinder('drum', { diameter: 3.2, height: 2.3, tessellation: 16 }, this.scene);
    drum.position.y = 5.95;
    add(drum).material = m.hull;

    const glass = MeshBuilder.CreateCylinder('glass', { diameter: 3.35, height: 0.6, tessellation: 16 }, this.scene);
    glass.position.y = 6.25;
    add(glass, root, false).material = m.glass;

    const roof = MeshBuilder.CreateCylinder('roof', { diameter: 3.9, height: 0.35, tessellation: 16 }, this.scene);
    roof.position.y = 7.3;
    add(roof).material = m.dark;

    const roofRing = MeshBuilder.CreateTorus('roofring', { diameter: 3.5, thickness: 0.1, tessellation: 32 }, this.scene);
    roofRing.position.y = 7.52;
    add(roofRing, root, false).material = m.accent;

    // радар
    const radar = new TransformNode('radar', this.scene);
    radar.parent = root;
    radar.position.y = 7.5;
    const mast = MeshBuilder.CreateCylinder('mast', { diameter: 0.12, height: 1.9, tessellation: 6 }, this.scene);
    mast.position.y = 0.95;
    add(mast, radar, false).material = m.steel;
    const dishArm = MeshBuilder.CreateBox('disharm', { width: 0.1, height: 0.1, depth: 0.8 }, this.scene);
    dishArm.position.set(0, 1.7, 0.2);
    dishArm.rotation.x = -0.45;
    add(dishArm, radar, false).material = m.dark;
    const dish = MeshBuilder.CreateCylinder('dish', { diameter: 1.7, height: 0.1, tessellation: 18 }, this.scene);
    dish.position.set(0, 1.85, 0.38);
    dish.rotation.x = 0.85;
    add(dish, radar, false).material = m.panel;
    const dishRim = MeshBuilder.CreateTorus('dishrim', { diameter: 1.72, thickness: 0.055, tessellation: 24 }, this.scene);
    dishRim.position.set(0, 1.85, 0.38);
    dishRim.rotation.x = 0.85;
    add(dishRim, radar, false).material = m.accent;
    const feed = MeshBuilder.CreateSphere('feed', { diameter: 0.24, segments: 6 }, this.scene);
    feed.position.set(0, 2.08, 0.72);
    add(feed, radar, false).material = m.accent;

    // антенны
    for (const side of [-1, 1]) {
      const ant = MeshBuilder.CreateCylinder(`antenna_${side}`, { diameter: 0.06, height: 2.0, tessellation: 4 }, this.scene);
      ant.position.set(2.1 * side, 8.6, -2.4);
      add(ant, root, false).material = m.dark;
      const tip = MeshBuilder.CreateSphere(`antennatip_${side}`, { diameter: 0.18, segments: 5 }, this.scene);
      tip.position.set(2.1 * side, 9.65, -2.4);
      add(tip, root, false).material = m.warn;
    }

    // флаг
    const pole = MeshBuilder.CreateCylinder('flagpole', { diameter: 0.06, height: 2.8, tessellation: 4 }, this.scene);
    pole.position.set(-2.4, 8.7, 2.4);
    add(pole, root, false).material = m.steel;
    const flag = MeshBuilder.CreatePlane('flag', { width: 1.5, height: 0.8, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    flag.position.set(-3.15, 9.6, 2.4);
    flag.rotation.y = Math.PI / 2;
    add(flag, root, false).material = m.accent;

    // площадка и контейнеры
    const padSide = MeshBuilder.CreateBox('sidepad', { width: 3.4, height: 0.25, depth: 4.2 }, this.scene);
    padSide.position.set(5.2, 0.3, 3.0);
    add(padSide, root, false).material = m.concrete;
    const crate1 = MeshBuilder.CreateBox('crate1', { width: 1.2, height: 1.1, depth: 1.2 }, this.scene);
    crate1.position.set(5.4, 1.0, 3.4);
    crate1.rotation.y = 0.3;
    add(crate1).material = m.rust;
    const crate2 = MeshBuilder.CreateBox('crate2', { width: 0.8, height: 0.7, depth: 1.0 }, this.scene);
    crate2.position.set(4.4, 0.8, 2.2);
    crate2.rotation.y = -0.2;
    add(crate2).material = m.trim;

    const tank1 = MeshBuilder.CreateCylinder('fueltank1', { diameter: 1.3, height: 2.1, tessellation: 12 }, this.scene);
    tank1.position.set(-4.9, 1.15, 2.8);
    add(tank1).material = m.rust;
    const tank2 = MeshBuilder.CreateCylinder('fueltank2', { diameter: 1.3, height: 2.1, tessellation: 12 }, this.scene);
    tank2.position.set(-4.9, 1.15, 4.3);
    add(tank2).material = m.rust;

    const door = MeshBuilder.CreateBox('hqdoor', { width: 2.2, height: 1.7, depth: 0.14 }, this.scene);
    door.position.set(0, 1.65, 4.22);
    add(door, root, false).material = m.dark;
    const doorGlow = MeshBuilder.CreateBox('hqdoorglow', { width: 2.4, height: 0.08, depth: 0.08 }, this.scene);
    doorGlow.position.set(0, 2.55, 4.24);
    add(doorGlow, root, false).material = m.accent;

    parts.radar = radar;
    parts.flag = flag;
    parts.height = 10.2;
    return { root, parts, height: 10.2 };
  }

  // ---------------------------------------------------------------- BUILDING: POWER
  buildPower(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`power_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root, shadow = true) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = shadow;
      return mesh;
    };

    const pad = MeshBuilder.CreateCylinder('pad', { diameter: 9.6, height: 0.3, tessellation: 20 }, this.scene);
    pad.position.y = 0.15;
    add(pad, root, false).material = m.concrete;

    const padRing = MeshBuilder.CreateTorus('padring', { diameter: 8.9, thickness: 0.13, tessellation: 40 }, this.scene);
    padRing.position.y = 0.33;
    add(padRing, root, false).material = m.accent;

    const base = MeshBuilder.CreateCylinder('base', { diameter: 4.9, height: 0.9, tessellation: 16 }, this.scene);
    base.position.y = 0.75;
    add(base).material = m.dark;

    const core = MeshBuilder.CreateCylinder('core', { diameter: 1.7, height: 2.5, tessellation: 12 }, this.scene);
    core.position.y = 2.3;
    add(core, root, false).material = m.glow;

    const coreShell = MeshBuilder.CreateCylinder('coreshell', { diameter: 2.5, height: 2.8, tessellation: 12 }, this.scene);
    coreShell.position.y = 2.35;
    add(coreShell, root, false).material = m.glass;

    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const strut = MeshBuilder.CreateBox(`strut_${i}`, { width: 0.18, height: 2.8, depth: 0.18 }, this.scene);
      strut.position.set(Math.cos(a) * 1.55, 2.35, Math.sin(a) * 1.55);
      add(strut, root, false).material = m.steel;
    }

    const collar = MeshBuilder.CreateCylinder('collar', { diameter: 3.4, height: 0.35, tessellation: 16 }, this.scene);
    collar.position.y = 3.9;
    add(collar).material = m.panel;

    // вращающееся энергокольцо
    const vortex = new TransformNode('vortex', this.scene);
    vortex.parent = root;
    vortex.position.y = 4.28;
    const ring = MeshBuilder.CreateTorus('vring', { diameter: 3.2, thickness: 0.13, tessellation: 32 }, this.scene);
    add(ring, vortex, false).material = m.accent;
    for (let i = 0; i < 4; i++) {
      const spoke = MeshBuilder.CreateBox(`spoke_${i}`, { width: 1.4, height: 0.1, depth: 0.1 }, this.scene);
      spoke.position.set(Math.cos((i / 4) * Math.PI * 2) * 0.8, 0.05, Math.sin((i / 4) * Math.PI * 2) * 0.8);
      spoke.rotation.y = -(i / 4) * Math.PI * 2;
      add(spoke, vortex, false).material = m.glow;
    }

    const cap = MeshBuilder.CreateCylinder('cap', { diameter: 3.7, height: 0.35, tessellation: 16 }, this.scene);
    cap.position.y = 4.55;
    add(cap).material = m.dark;

    // градирни
    for (const side of [-1, 1]) {
      const tower = MeshBuilder.CreateCylinder(`tower_${side}`, {
        diameterTop: 2.3,
        diameterBottom: 3.2,
        height: 3.9,
        tessellation: 14,
      }, this.scene);
      tower.position.set(3.35 * side, 2.25, -1.15);
      add(tower).material = m.concrete;

      const rim = MeshBuilder.CreateTorus(`rim_${side}`, { diameter: 2.35, thickness: 0.13, tessellation: 24 }, this.scene);
      rim.position.set(3.35 * side, 4.2, -1.15);
      add(rim, root, false).material = m.accent;

      const throat = MeshBuilder.CreateCylinder(`throat_${side}`, { diameter: 2.05, height: 0.12, tessellation: 14 }, this.scene);
      throat.position.set(3.35 * side, 4.12, -1.15);
      add(throat, root, false).material = m.dark;

      const pipe = MeshBuilder.CreateCylinder(`pipe_${side}`, { diameter: 0.32, height: 2.1, tessellation: 8 }, this.scene);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(1.55 * side, 1.15, -1.15);
      add(pipe).material = m.steel;

      const band = MeshBuilder.CreateCylinder(`band_${side}`, { diameter: 3.0, height: 0.18, tessellation: 14 }, this.scene);
      band.position.set(3.35 * side, 1.0, -1.15);
      add(band, root, false).material = m.warn;
    }

    const transformer = MeshBuilder.CreateBox('transformer', { width: 2.0, height: 1.1, depth: 1.4 }, this.scene);
    transformer.position.set(0, 0.85, 3.55);
    add(transformer).material = m.steel;
    for (let i = 0; i < 3; i++) {
      const insulator = MeshBuilder.CreateCylinder(`insulator_${i}`, { diameter: 0.18, height: 0.55, tessellation: 6 }, this.scene);
      insulator.position.set(-0.55 + i * 0.55, 1.65, 3.55);
      add(insulator, root, false).material = m.dark;
      const spark = MeshBuilder.CreateSphere(`spark_${i}`, { diameter: 0.12, segments: 5 }, this.scene);
      spark.position.set(-0.55 + i * 0.55, 1.95, 3.55);
      add(spark, root, false).material = m.glow;
    }

    const cable = MeshBuilder.CreateCylinder('cable', { diameter: 0.1, height: 2.1, tessellation: 5 }, this.scene);
    cable.position.set(0.9, 0.7, 4.4);
    cable.rotation.z = 0.5;
    add(cable, root, false).material = m.dark;

    parts.vortex = vortex;
    parts.height = 6.8;
    return { root, parts, height: 6.8 };
  }

  // ---------------------------------------------------------------- BUILDING: BARRACKS
  buildBarracks(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`barracks_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root, shadow = true) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = shadow;
      return mesh;
    };

    const pad = MeshBuilder.CreateBox('pad', { width: 8.8, height: 0.22, depth: 7.4 }, this.scene);
    pad.position.y = 0.11;
    add(pad, root, false).material = m.concrete;

    const padStripe = MeshBuilder.CreateBox('padstripe', { width: 8.5, height: 0.06, depth: 0.18 }, this.scene);
    padStripe.position.set(0, 0.24, 3.55);
    add(padStripe, root, false).material = m.accent;

    const hall = MeshBuilder.CreateBox('hall', { width: 7.0, height: 2.5, depth: 5.0 }, this.scene);
    hall.position.set(0, 1.45, -0.35);
    add(hall).material = m.panel;

    const band = MeshBuilder.CreateBox('band', { width: 7.05, height: 0.28, depth: 5.05 }, this.scene);
    band.position.set(0, 2.15, -0.35);
    add(band, root, false).material = m.dark;

    const roof = MeshBuilder.CreateBox('roof', { width: 7.6, height: 0.28, depth: 5.6 }, this.scene);
    roof.position.set(0, 2.85, -0.35);
    add(roof).material = m.dark;

    const roofWalk = MeshBuilder.CreateBox('roofwalk', { width: 3.0, height: 0.06, depth: 1.15 }, this.scene);
    roofWalk.position.set(0, 3.01, -0.5);
    add(roofWalk, root, false).material = m.dark;

    for (const side of [-1, 1]) {
      const trimX = MeshBuilder.CreateBox(`rooftrimX_${side}`, { width: 7.7, height: 0.06, depth: 0.12 }, this.scene);
      trimX.position.set(0, 3.01, -0.35 + 2.75 * side);
      add(trimX, root, false).material = m.accent;
      const trimZ = MeshBuilder.CreateBox(`rooftrimZ_${side}`, { width: 0.12, height: 0.06, depth: 5.5 }, this.scene);
      trimZ.position.set(3.75 * side, 3.01, -0.35);
      add(trimZ, root, false).material = m.accent;
    }

    const roofSlope = MeshBuilder.CreateBox('roofslope', { width: 7.5, height: 0.22, depth: 1.8 }, this.scene);
    roofSlope.position.set(0, 3.0, 2.1);
    roofSlope.rotation.x = 0.38;
    add(roofSlope).material = m.panel;

    const skylight = MeshBuilder.CreateBox('skylight', { width: 2.0, height: 0.07, depth: 0.55 }, this.scene);
    skylight.position.set(0.3, 3.02, -1.15);
    add(skylight, root, false).material = m.panel;
    const skylightGlow = MeshBuilder.CreateBox('skylightglow', { width: 1.8, height: 0.03, depth: 0.1 }, this.scene);
    skylightGlow.position.set(0.3, 3.065, -1.15);
    add(skylightGlow, root, false).material = m.accent;

    const annex = MeshBuilder.CreateBox('annex', { width: 3.2, height: 2.0, depth: 2.2 }, this.scene);
    annex.position.set(-2.6, 1.1, -3.4);
    add(annex).material = m.hull;

    const front = MeshBuilder.CreateBox('frontblock', { width: 4.6, height: 2.2, depth: 2.0 }, this.scene);
    front.position.set(0, 1.2, 3.2);
    add(front).material = m.panel;

    const doorFrame = MeshBuilder.CreateBox('doorframe', { width: 3.0, height: 2.15, depth: 0.22 }, this.scene);
    doorFrame.position.set(0, 1.15, 4.22);
    add(doorFrame, root, false).material = m.dark;

    const door = MeshBuilder.CreateBox('door', { width: 2.5, height: 1.85, depth: 0.16 }, this.scene);
    door.position.set(0, 1.02, 4.35);
    add(door, root, false).material = m.steel;
    parts.door = door;
    parts.doorBaseY = 1.02;

    for (const side of [-1, 1]) {
      const glow = MeshBuilder.CreateBox(`doorglow_${side}`, { width: 0.1, height: 1.9, depth: 0.1 }, this.scene);
      glow.position.set(1.38 * side, 1.05, 4.38);
      add(glow, root, false).material = m.accent;
    }

    const header = MeshBuilder.CreateBox('header', { width: 2.9, height: 0.16, depth: 0.2 }, this.scene);
    header.position.set(0, 2.15, 4.3);
    add(header, root, false).material = m.accent;

    // задний вход: казармы выглядят живыми с любой стороны
    const backFrame = MeshBuilder.CreateBox('backframe', { width: 3.0, height: 2.1, depth: 0.18 }, this.scene);
    backFrame.position.set(1.4, 1.05, -2.9);
    add(backFrame, root, false).material = m.dark;

    const backDoor = MeshBuilder.CreateBox('backdoor', { width: 2.35, height: 1.8, depth: 0.12 }, this.scene);
    backDoor.position.set(1.4, 0.95, -3.0);
    add(backDoor, root, false).material = m.panel;

    for (const side of [-1, 1]) {
      const glow = MeshBuilder.CreateBox(`backglow_${side}`, { width: 0.1, height: 1.85, depth: 0.1 }, this.scene);
      glow.position.set(1.4 + 1.28 * side, 0.98, -3.04);
      add(glow, root, false).material = m.accent;
    }

    const backHeader = MeshBuilder.CreateBox('backheader', { width: 2.9, height: 0.16, depth: 0.16 }, this.scene);
    backHeader.position.set(1.4, 2.0, -3.02);
    add(backHeader, root, false).material = m.accent;

    const emblem = MeshBuilder.CreateBox('emblem', { width: 2.2, height: 0.5, depth: 0.08 }, this.scene);
    emblem.position.set(1.4, 2.48, -2.94);
    add(emblem, root, false).material = m.glass;

    const ramp = MeshBuilder.CreateBox('ramp', { width: 3.1, height: 0.15, depth: 1.2 }, this.scene);
    ramp.position.set(1.4, 0.1, -3.75);
    ramp.rotation.x = -0.12;
    add(ramp, root, false).material = m.concrete;

    for (let i = -1; i <= 1; i++) {
      const light = MeshBuilder.CreateBox(`backlight_${i}`, { width: 0.16, height: 0.05, depth: 0.4 }, this.scene);
      light.position.set(1.4 + i * 1.3, 0.05, -4.15);
      add(light, root, false).material = m.accent;
    }

    for (let i = 0; i < 3; i++) {
      const win = MeshBuilder.CreateBox(`window_${i}`, { width: 0.8, height: 0.45, depth: 0.1 }, this.scene);
      win.position.set(-2.6 + i * 1.5, 1.8, 2.2);
      add(win, root, false).material = m.glass;
    }

    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const sideWindow = MeshBuilder.CreateBox(`sidewindow_${side}_${i}`, { width: 0.08, height: 0.42, depth: 1.15 }, this.scene);
        sideWindow.position.set(3.53 * side, 1.8, -1.5 + i * 2.2);
        add(sideWindow, root, false).material = m.glass;
      }
    }

    const sideStripe = MeshBuilder.CreateBox('sidestripe', { width: 0.08, height: 0.3, depth: 4.0 }, this.scene);
    sideStripe.position.set(3.53, 1.6, -0.35);
    add(sideStripe, root, false).material = m.accent;

    // крыша: вентиляция, антенна, флаг
    for (let i = 0; i < 2; i++) {
      const vent = MeshBuilder.CreateCylinder(`vent_${i}`, { diameter: 0.55, height: 0.5, tessellation: 8 }, this.scene);
      vent.position.set(-1.4 + i * 2.6, 3.25, -1.5);
      add(vent).material = m.dark;
    }

    const fanBase = MeshBuilder.CreateCylinder('fanbase', { diameter: 1.35, height: 0.22, tessellation: 12 }, this.scene);
    fanBase.position.set(2.05, 3.12, -0.9);
    add(fanBase).material = m.steel;
    for (let i = 0; i < 4; i++) {
      const blade = MeshBuilder.CreateBox(`fanblade_${i}`, { width: 1.1, height: 0.06, depth: 0.24 }, this.scene);
      blade.position.set(2.05, 3.26, -0.9);
      blade.rotation.y = (i / 4) * Math.PI * 2;
      add(blade, root, false).material = m.accent;
    }

    const mast = MeshBuilder.CreateCylinder('mast', { diameter: 0.08, height: 2.0, tessellation: 4 }, this.scene);
    mast.position.set(2.4, 4.0, 0.5);
    add(mast, root, false).material = m.steel;
    const flag = MeshBuilder.CreatePlane('flag', { width: 1.1, height: 0.6, sideOrientation: Mesh.DOUBLESIDE }, this.scene);
    flag.position.set(2.95, 4.75, 0.5);
    flag.rotation.y = Math.PI / 2;
    add(flag, root, false).material = m.accent;

    for (let i = 0; i < 3; i++) {
      const crate = MeshBuilder.CreateBox(`crate_${i}`, { width: 0.8, height: 0.8, depth: 0.8 }, this.scene);
      crate.position.set(-3.8 + i * 0.9, 0.55, 3.5);
      crate.rotation.y = i * 0.4;
      add(crate, root, false).material = i === 1 ? m.rust : m.dark;
    }
    const barrel = MeshBuilder.CreateCylinder('barrel', { diameter: 0.7, height: 0.9, tessellation: 10 }, this.scene);
    barrel.position.set(3.6, 0.55, 2.2);
    add(barrel).material = m.rust;

    parts.height = 5.4;
    return { root, parts, height: 5.4 };
  }

  // ---------------------------------------------------------------- BUILDING: DERRICK
  buildDerrick(faction) {
    const m = this.baseMaterials(faction);
    const root = new TransformNode(`derrick_${faction}`, this.scene);
    const parts = {};
    const add = (mesh, parent = root, shadow = true) => {
      mesh.parent = parent;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = shadow;
      return mesh;
    };

    const base = MeshBuilder.CreateBox('base', { width: 4.6, height: 0.28, depth: 4.6 }, this.scene);
    base.position.y = 0.14;
    add(base, root, false).material = m.concrete;

    // четыре опоры, наклонённые внутрь
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = MeshBuilder.CreateBox(`leg_${sx}_${sz}`, { width: 0.18, height: 5.2, depth: 0.18 }, this.scene);
        leg.position.set(1.55 * sx, 2.6, 1.55 * sz);
        leg.rotation.z = 0.17 * sx;
        leg.rotation.x = -0.17 * sz;
        add(leg).material = m.steel;
      }
    }

    for (let i = 0; i < 2; i++) {
      const y = 1.5 + i * 1.7;
      const w = 2.9 - i * 0.55;
      for (const sz of [-1, 1]) {
        const brace = MeshBuilder.CreateBox(`bracez_${i}_${sz}`, { width: w, height: 0.1, depth: 0.1 }, this.scene);
        brace.position.set(0, y, 1.55 * sz - 0.05 * sz);
        add(brace, root, false).material = m.dark;
      }
      for (const sx of [-1, 1]) {
        const brace = MeshBuilder.CreateBox(`bracex_${i}_${sx}`, { width: 0.1, height: 0.1, depth: w }, this.scene);
        brace.position.set(1.55 * sx - 0.05 * sx, y, 0);
        add(brace, root, false).material = m.dark;
      }
    }

    const platform = MeshBuilder.CreateBox('platform', { width: 3.7, height: 0.26, depth: 3.7 }, this.scene);
    platform.position.y = 5.05;
    add(platform).material = m.dark;

    const railing = MeshBuilder.CreateBox('railing', { width: 3.7, height: 0.5, depth: 0.06 }, this.scene);
    railing.position.set(0, 5.4, 1.85);
    add(railing, root, false).material = m.accent;

    // A-образная рама
    for (const side of [-1, 1]) {
      const aframe = MeshBuilder.CreateBox(`aframe_${side}`, { width: 0.18, height: 3.0, depth: 0.18 }, this.scene);
      aframe.position.set(0.95 * side, 6.6, 0);
      aframe.rotation.z = 0.32 * side;
      add(aframe).material = m.steel;
    }

    // качалка
    const pump = new TransformNode('pump', this.scene);
    pump.parent = root;
    pump.position.set(0, 7.35, 0);
    pump.rotation.z = -0.13;
    const beam = MeshBuilder.CreateBox('beam', { width: 5.2, height: 0.36, depth: 0.5 }, this.scene);
    add(beam, pump).material = m.rust;
    const horsehead = MeshBuilder.CreateBox('horsehead', { width: 0.45, height: 1.1, depth: 0.55 }, this.scene);
    horsehead.position.set(-2.45, -0.55, 0);
    add(horsehead, pump).material = m.hull;
    const cable = MeshBuilder.CreateCylinder('cable', { diameter: 0.07, height: 4.0, tessellation: 4 }, this.scene);
    cable.position.set(-2.45, -3.1, 0);
    add(cable, pump, false).material = m.dark;
    const counterweight = MeshBuilder.CreateBox('counterweight', { width: 1.0, height: 0.9, depth: 0.7 }, this.scene);
    counterweight.position.set(2.3, -0.35, 0);
    add(counterweight, pump).material = m.dark;

    // маховик
    const crankAxle = new TransformNode('crankaxle', this.scene);
    crankAxle.parent = root;
    crankAxle.position.set(1.1, 6.1, 0.85);
    crankAxle.rotation.x = Math.PI / 2;
    const crank = MeshBuilder.CreateCylinder('crank', { diameter: 0.75, height: 0.22, tessellation: 14 }, this.scene);
    add(crank, crankAxle).material = m.rust;
    const crankSpoke = MeshBuilder.CreateBox('crankspoke', { width: 0.16, height: 0.85, depth: 0.18 }, this.scene);
    add(crankSpoke, crankAxle).material = m.steel;

    // мотор и бак
    const motor = MeshBuilder.CreateBox('motor', { width: 1.5, height: 1.0, depth: 1.1 }, this.scene);
    motor.position.set(-1.8, 0.8, -1.9);
    add(motor).material = m.dark;
    const motorStripe = MeshBuilder.CreateBox('motorstripe', { width: 1.52, height: 0.1, depth: 0.12 }, this.scene);
    motorStripe.position.set(-1.8, 1.1, -1.34);
    add(motorStripe, root, false).material = m.accent;

    const storage = MeshBuilder.CreateCylinder('storage', { diameter: 2.4, height: 2.6, tessellation: 14 }, this.scene);
    storage.position.set(-2.7, 1.5, 1.7);
    add(storage).material = m.steel;
    const storageBand = MeshBuilder.CreateCylinder('storageband', { diameter: 2.45, height: 0.18, tessellation: 14 }, this.scene);
    storageBand.position.set(-2.7, 2.1, 1.7);
    add(storageBand, root, false).material = m.accent;
    const storageTop = MeshBuilder.CreateCylinder('storagetop', { diameter: 2.2, height: 0.18, tessellation: 14 }, this.scene);
    storageTop.position.set(-2.7, 2.85, 1.7);
    add(storageTop).material = m.dark;

    // факел
    const flarePipe = MeshBuilder.CreateCylinder('flarepipe', { diameter: 0.16, height: 3.2, tessellation: 6 }, this.scene);
    flarePipe.position.set(1.9, 1.7, -1.9);
    add(flarePipe).material = m.dark;
    const flare = MeshBuilder.CreateCylinder('flare', { diameterTop: 0.02, diameterBottom: 0.5, height: 1.1, tessellation: 8 }, this.scene);
    flare.position.set(1.9, 3.85, -1.9);
    add(flare, root, false).material = m.warn;

    // лампа на вышке
    const lamp = MeshBuilder.CreateSphere('lamp', { diameter: 0.26, segments: 6 }, this.scene);
    lamp.position.set(0, 7.6, 1.6);
    add(lamp, root, false).material = m.warn;

    parts.pump = pump;
    parts.pumpBase = -0.13;
    parts.crank = crankAxle;
    parts.flare = flare;
    parts.height = 8.4;
    return { root, parts, height: 8.4 };
  }

  // ---------------------------------------------------------------- DECOR
  buildOilPatch() {
    const scene = this.scene;
    const root = new TransformNode('oilpatch', scene);
    const oil = this.mat('oil', { color: '#0a0907', specular: 0.85, shininess: 140 });
    const rim = this.mat('oilrim', { color: '#211b13', specular: 0.15 });

    const pool1 = MeshBuilder.CreateDisc('pool1', { radius: 4.3, tessellation: 30 }, scene);
    pool1.rotation.x = Math.PI / 2;
    pool1.position.y = 0.035;
    pool1.scaling.z = 0.82;
    pool1.rotation.y = 0.3;
    pool1.material = oil;
    pool1.parent = root;

    const pool2 = MeshBuilder.CreateDisc('pool2', { radius: 3.1, tessellation: 24 }, scene);
    pool2.rotation.x = Math.PI / 2;
    pool2.position.set(1.1, 0.045, -0.7);
    pool2.scaling.x = 0.8;
    pool2.rotation.y = -0.6;
    pool2.material = oil;
    pool2.parent = root;

    const ring = MeshBuilder.CreateTorus('oilring', { diameter: 8.2, thickness: 0.07, tessellation: 40 }, scene);
    ring.position.y = 0.06;
    ring.material = this.mat('oilring', { color: '#7c5a2e', emissive: '#3a240c', specular: 0 });
    ring.parent = root;

    const rng = Math.random;
    for (let i = 0; i < 6; i++) {
      const bubble = MeshBuilder.CreateSphere(`bubble_${i}`, { diameter: rngRange(rng, 0.5, 1.1), segments: 6 }, scene);
      const a = rng() * Math.PI * 2;
      const r = rng() * 2.6;
      bubble.position.set(Math.cos(a) * r, 0.11, Math.sin(a) * r);
      bubble.scaling.y = 0.28;
      bubble.material = oil;
      bubble.parent = root;
    }

    for (let i = 0; i < 3; i++) {
      const marker = MeshBuilder.CreateCylinder(`oilmk_${i}`, { diameter: 0.16, height: 1.2, tessellation: 5 }, scene);
      const a = (i / 3) * Math.PI * 2 + 0.6;
      marker.position.set(Math.cos(a) * 4.0, 0.6, Math.sin(a) * 4.0);
      marker.material = this.mat('marker', { color: '#ffb02e', emissive: '#ff8a1e', unlit: true });
      marker.parent = root;
      const cap = MeshBuilder.CreateSphere(`oilcap_${i}`, { diameter: 0.22, segments: 5 }, scene);
      cap.position.set(Math.cos(a) * 4.0, 1.22, Math.sin(a) * 4.0);
      cap.material = this.mat('marker', { color: '#ffb02e', emissive: '#ff8a1e', unlit: true });
      cap.parent = root;
    }
    root.position.y = 0;
    return { root, height: 0.2 };
  }

  buildRock(rng = Math.random) {
    const mesh = MeshBuilder.CreateIcoSphere('rock', { radius: 1, subdivisions: 1 }, this.scene);
    mesh.convertToFlatShadedMesh();
    const size = rngRange(rng, 1.2, 3.4);
    mesh.scaling.set(size * rngRange(rng, 0.8, 1.3), size * rngRange(rng, 0.45, 0.8), size * rngRange(rng, 0.8, 1.3));
    mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    mesh.position.y = mesh.scaling.y * 0.35;
    const shade = rngRange(rng, 0, 1);
    const material = this.mat(`stone_${shade > 0.55 ? 'b' : shade > 0.25 ? 'a' : 'c'}`, {
      color: shade > 0.55 ? '#5b5044' : shade > 0.25 ? '#4a4138' : '#665949',
      specular: 0.05,
    });
    mesh.material = material;
    mesh.receiveShadows = true;
    mesh.castShadow = true;
    mesh.isPickable = false;
    mesh.metadata = { rock: true };
    return mesh;
  }

  buildCrystalCluster(rng = Math.random) {
    const root = new TransformNode('crystals', this.scene);
    const mat = this.mat('crystal', { color: '#5cd8ff', emissive: '#3ab8e8', unlit: false, specular: 0.8, shininess: 100 });
    const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const h = rngRange(rng, 1.0, 3.4);
      const crystal = MeshBuilder.CreateCylinder(`crystal_${i}`, {
        diameterTop: 0.06,
        diameterBottom: rngRange(rng, 0.35, 0.7),
        height: h,
        tessellation: 5,
      }, this.scene);
      const a = rng() * Math.PI * 2;
      const r = rng() * 1.1;
      crystal.position.set(Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r);
      crystal.rotation.z = rngRange(rng, -0.35, 0.35);
      crystal.rotation.x = rngRange(rng, -0.35, 0.35);
      crystal.material = mat;
      crystal.castShadow = true;
      crystal.isPickable = false;
      crystal.parent = root;
    }
    return root;
  }

  buildPerimeterPost() {
    const root = new TransformNode('post', this.scene);
    const mat = this.mat('post', { color: '#2e3a40', specular: 0.2 });
    const post = MeshBuilder.CreateCylinder('post', { diameter: 0.5, height: 2.2, tessellation: 6 }, this.scene);
    post.position.y = 1.1;
    post.material = mat;
    post.parent = root;
    const cap = MeshBuilder.CreateBox('postcap', { width: 0.7, height: 0.22, depth: 0.7 }, this.scene);
    cap.position.y = 2.25;
    cap.material = this.mat('postcap', { color: '#131a1f', specular: 0.2 });
    cap.parent = root;
    const light = MeshBuilder.CreateSphere('postlight', { diameter: 0.22, segments: 5 }, this.scene);
    light.position.y = 2.18;
    light.material = this.mat('postlight', { color: '#ff5a3c', emissive: '#ff3a1e', unlit: true });
    light.parent = root;
    root.getChildMeshes().forEach((mesh) => {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = true;
    });
    return root;
  }

  buildCrateProp(scale = 1) {
    const root = new TransformNode('crateprop', this.scene);
    const crate = MeshBuilder.CreateBox('crate', { width: 1.1 * scale, height: 1.0 * scale, depth: 1.1 * scale }, this.scene);
    crate.position.y = 0.5 * scale;
    crate.rotation.y = Math.random() * 0.6;
    crate.material = this.mat('crate', { color: '#4a443a', specular: 0.08 });
    crate.parent = root;
    const stripe = MeshBuilder.CreateBox('cratestripe', { width: 1.12 * scale, height: 0.12 * scale, depth: 0.18 * scale }, this.scene);
    stripe.position.y = 0.65 * scale;
    stripe.material = this.mat('cratestripe', { color: '#c8a04a', specular: 0.1 });
    stripe.parent = root;
    root.getChildMeshes().forEach((mesh) => {
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      mesh.castShadow = true;
    });
    return root;
  }
}
