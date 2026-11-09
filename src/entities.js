// Юниты и здания: движение, бой, строительство и производство.

import {
  MeshBuilder,
  Mesh,
  StandardMaterial,
  TransformNode,
  Vector3,
  Color3,
} from './babylon.js';
import { UNITS, BUILDINGS, UPGRADES, FACTIONS, MAP, MESSAGES, FIELD_SUPPORT, CONSTRUCTION, VISION } from './config.js';
import { clamp, dist, turnTowards, damp, angleDiff } from './utils.js';
import { segmentDistance } from './nav.js';

let nextId = 1;

const yawTo = (dx, dz) => Math.atan2(dx, dz);

function createBar(factory, faction, width) {
  const scene = factory.scene;
  const group = new TransformNode('healthbar', scene);
  const bgMat = factory.mat('barBg', {
    color: '#102832',
    emissive: '#0a1c24',
    unlit: true,
    fog: false,
    backFaceCulling: false,
  });
  const hpMat = factory.mat(`barHp_${faction}`, {
    color: FACTIONS[faction].hp,
    emissive: FACTIONS[faction].hp,
    unlit: true,
    fog: false,
    backFaceCulling: false,
  });
  const progMat = factory.mat('barProg', {
    color: '#ffc766',
    emissive: '#ffae3d',
    unlit: true,
    fog: false,
    backFaceCulling: false,
  });
  const progBgMat = factory.mat('barProgBg', {
    color: '#1a1308',
    emissive: '#1a1308',
    unlit: true,
    fog: false,
    backFaceCulling: false,
  });

  const plane = (parent, w, h, mat, z) => {
    const mesh = MeshBuilder.CreatePlane('barpart', { width: w, height: h }, scene);
    mesh.material = mat;
    mesh.parent = parent;
    mesh.position.z = z;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.renderingGroupId = 1;
    mesh.applyFog = false;
    return mesh;
  };

  const bg = plane(group, width + 0.12, 0.38, bgMat, 0);
  const hp = plane(group, width, 0.25, hpMat, 0.012);

  const progress = new TransformNode('barprogress', scene);
  progress.parent = group;
  progress.position.y = -0.3;
  const pBg = plane(progress, width, 0.12, progBgMat, 0.014);
  const pFill = plane(progress, width - 0.02, 0.075, progMat, 0.02);
  progress.setEnabled(false);

  group.setEnabled(false);
  return { group, width, hp, hpWidth: width, progress, pFill, pWidth: width - 0.04, bg };
}

export class Entity {
  constructor(game, faction, type, def, x, z, isBuilding = false) {
    this.id = nextId++;
    this.game = game;
    this.faction = faction;
    this.type = type;
    this.def = def;
    this.isBuilding = isBuilding;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.radius = def.radius;
    this.armor = def.armor ?? 0;
    this.position = new Vector3(x, 0, z);
    this.alive = true;
    this.selected = false;
    this.forceBar = false;
    this.root = null;
    this.parts = null;
    this.model = null;
    this.bar = null;
    this.ring = null;
    this.barVisible = false;
    this.fogState = null;
    this.lastHitAt = -99;
    this.lastAttacker = null;
  }

  setupVisual() {
    const game = this.game;
    const factory = game.factory;
    this.root.position.set(this.position.x, 0, this.position.z);
    this.root.getChildMeshes(false).forEach((mesh) => {
      mesh.isPickable = true;
      mesh.metadata = { entity: this };
      mesh.receiveShadows = true;
    });

    const ringMat = factory.mat(`selRing_${this.faction}`, {
      color: FACTIONS[this.faction].accent,
      emissive: FACTIONS[this.faction].accent,
      unlit: true,
      alpha: 0.9,
      fog: false,
      backFaceCulling: false,
    });
    const ring = MeshBuilder.CreateTorus(`sel_${this.id}`, {
      diameter: Math.max(1.9, this.radius * 2.55),
      thickness: 0.1,
      tessellation: 36,
    }, game.scene);
    ring.material = ringMat;
    ring.parent = this.root;
    ring.position.y = this.isBuilding ? (this.def.key === 'hq' ? 0.55 : 0.38) : 0.08;
    ring.isPickable = false;
    ring.receiveShadows = false;
    ring.setEnabled(false);
    this.ring = ring;

    const barWidth = this.isBuilding
      ? clamp(this.radius * 1.25, 2.2, 4.4)
      : clamp(this.radius * 1.35, 1.2, 2.0);
    this.bar = createBar(factory, this.faction, barWidth);
    this.barY = this.isBuilding ? this.def.height + 0.7 : this.def.height + 0.45;
    game.world.addCaster(this.root, this.isBuilding ? 8 : 3);

    // Свечение юнитов и интерфейсных элементов не пускаем в bloom:
    // при больших армиях это главный источник лишних проходов.
    const glow = game.scene.getGlowLayerByName?.('glow');
    if (glow?.addExcludedMesh) {
      glow.addExcludedMesh(ring);
      this.bar.group.getChildMeshes(false).forEach((mesh) => glow.addExcludedMesh(mesh));
      if (!this.isBuilding) {
        this.root.getChildMeshes(false).forEach((mesh) => glow.addExcludedMesh(mesh));
      }
    }
  }

  setSelected(value) {
    this.selected = value;
    if (this.ring) this.ring.setEnabled(value && this.alive);
    if (this.isBuilding) this.updateRallyVisual?.();
  }

  /**
   * Видимость для игрока: visible — видно сейчас, hidden — не видно совсем.
   * У зданий есть ещё ghost — известная по прошлой разведке постройка.
   */
  setFogState(state) {
    this.fogState = state;
    this.fogVisible = state === 'visible';
    this.root?.setEnabled(this.fogVisible);
    this.updateBar?.();
  }

  takeDamage(amount, source) {
    if (!this.alive || this.game.over) return;
    const armor = Math.max(0, (this.armor ?? this.def.armor ?? 0) - (source?.pierce ?? 0));
    const dmg = Math.max(1, amount - armor);
    // Опыт и статистика считают реально снятые HP, а не избыточный урон.
    const applied = Math.min(dmg, Math.max(0, this.hp));
    this.hp -= dmg;
    this.lastHitAt = this.game.elapsed;
    // Своя РСЗО не становится «атакующим»: иначе юнит развернулся бы
    // против своих, а ИИ записал бы братоубийство на счёт игрока.
    if (source?.alive && source.faction !== this.faction) this.lastAttacker = source;
    this.game.onEntityDamaged(this, source, applied);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(source);
    }
    if (this instanceof Unit && this.alive && source?.alive
      && source.faction !== this.faction && this.canFight) {
      const busyBuilding = this.def.builder
        && this.assistBuilding
        && this.assistBuilding.alive
        && !this.assistBuilding.complete;
      // Юнит отвечает на огонь с любой дистанции, с которой его достали:
      // артиллерия не должна безнаказанно расстреливать отряд с 30+ единиц.
      const d = dist(this.position.x, this.position.z, source.position.x, source.position.z);
      const leash = Math.max(this.aggro, this.range) + 30;
      const explicitAttack = this.order?.type === 'attack' && this.order.target !== source;
      // Явный приказ на перемещение важнее ответного огня: отряд идёт в
      // указанную точку, даже если по нему стреляют. Разворачивается он уже
      // после прибытия или когда игрок сам отдаст приказ атаковать.
      const explicitMove = this.order?.type === 'move';
      if (!busyBuilding && !explicitAttack && !explicitMove && d <= leash) {
        this.target = source;
        this.retaliateTimer = 6;
      }
    }
  }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    this.game.onEntityDeath(this, source);
    this.disposeVisual();
  }

  disposeVisual() {
    if (this.bar) {
      this.bar.group.getChildMeshes(false).forEach((m) => m.dispose());
      this.bar.group.dispose();
      this.bar = null;
    }
    if (this.root) {
      this.game.world.removeCaster(this.root);
      this.root.getChildMeshes(false).forEach((m) => m.dispose());
      this.root.dispose();
      this.root = null;
    }
  }

  updateBar() {
    if (!this.bar) return;
    // Полоска здоровья чужого юнита не должна висеть в тумане войны.
    const show = this.fogVisible !== false
      && (this.selected || this.forceBar || this.hp < this.maxHp - 0.01);
    this.barVisible = show;
    this.bar.group.setEnabled(show);
    if (!show) return;
    const camera = this.game.camera;
    if (!camera) return;
    this.bar.group.position.set(this.position.x, this.barY, this.position.z);
    this.bar.group.lookAt(camera.position);

    const frac = clamp(this.hp / this.maxHp, 0, 1);
    this.bar.hp.scaling.x = Math.max(0.001, frac);
    this.bar.hp.position.x = -(this.bar.hpWidth * (1 - frac)) / 2;
  }

  update() {}
}

export class Unit extends Entity {
  constructor(game, faction, type, x, z, opts = {}) {
    const def = UNITS[type];
    super(game, faction, type, def, x, z, false);
    this.speed = def.speed;
    this.range = def.range;
    this.damage = def.damage;
    this.aggro = def.aggro;
    this.order = null;
    this.target = null;
    this.attackCd = 0.25 + Math.random() * 0.3;
    this.moving = false;
    this.walkPhase = Math.random() * 10;
    this.recoil = 0;
    this.muzzleIndex = 0;
    this.pendingVolley = [];
    this.retaliateTimer = 0;
    this.workTimer = 0;
    this.assistBuilding = null;
    this.stuckTime = 0;
    this.detourTimer = 0;
    this.detourSign = Math.random() < 0.5 ? -1 : 1;
    this.lastDirX = 0;
    this.lastDirZ = 1;
    this.path = null;
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.pathGoal = null;
    this.repathDelay = 0;
    // Полевая поддержка: медик лечит пехоту, инженер ремонтирует технику.
    this.supportTarget = null;
    this.supportFx = 0;

    this.model = game.factory.unit(type, faction);
    this.root = this.model.root;
    this.parts = this.model.parts;
    this.height = this.model.height;
    this.root.rotation.y = opts.rotation ?? yawTo(-x, -z);
    this.setupVisual();
    this.applyUpgrades();
    this.updateBar();
  }

  get isUnit() {
    return true;
  }

  /** Есть ли у юнита оружие: медики безоружны и не выбирают цели. */
  get canFight() {
    return (this.def.damage ?? 0) > 0;
  }

  isSupportTarget(candidate) {
    if (!candidate || !candidate.alive || candidate.faction !== this.faction) return false;
    return this.def.healer ? Boolean(candidate.def.infantry) : Boolean(candidate.def.vehicle);
  }

  supportRange() {
    return this.def.healer ? this.healRange : FIELD_SUPPORT.engineerRange;
  }

  /** Раненый пехотинец или повреждённая машина поблизости. */
  findSupportTarget() {
    if (!this.def.healer && !this.def.repairer) return null;
    // Инженер на активной стройплощадке занят строительством.
    if (
      this.def.builder
      && this.assistBuilding
      && this.assistBuilding.alive
      && !this.assistBuilding.complete
    ) {
      return null;
    }
    // Под обстрелом инженер сначала отвечает, а не подставляет спину.
    if (
      this.def.repairer
      && this.canFight
      && (this.retaliateTimer > 0 || this.acquireTarget(this.range))
    ) {
      return null;
    }
    const seek = this.def.healer ? this.healSeek : FIELD_SUPPORT.engineerSeekRadius;
    let best = null;
    let bestScore = Infinity;
    for (const unit of this.game.units) {
      if (!this.isSupportTarget(unit)) continue;
      if (unit === this) continue;
      if (unit.hp >= unit.maxHp - 0.5) continue;
      const d = dist(this.position.x, this.position.z, unit.position.x, unit.position.z);
      if (d - unit.radius > seek) continue;
      // Сначала добираем самых тяжёлых: они нужнее в строю.
      const score = d + (unit.hp / unit.maxHp) * 6;
      if (score < bestScore) {
        bestScore = score;
        best = unit;
      }
    }
    return best;
  }

  supportStopDistance(target) {
    return Math.max(
      0.5,
      target.radius + this.radius + this.supportRange() - 0.35,
    );
  }

  supportInRange(target) {
    const d = dist(this.position.x, this.position.z, target.position.x, target.position.z);
    return d - target.radius - this.radius <= this.supportRange();
  }

  applySupport(dt, target) {
    if (!target || !target.alive || this.game.over) {
      this.supportTarget = null;
      return;
    }
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    this.root.rotation.y = turnTowards(this.root.rotation.y, yawTo(dx, dz), dt * 6);
    this.moving = false;
    this.workTimer = 0.22;
    this.supportTarget = target;
    this.supportFx -= dt;
    if (this.def.healer) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + this.healRate * dt);
      if (this.supportFx <= 0) {
        this.supportFx = 0.35 + Math.random() * 0.2;
        this.game.fx.healSparks(target.position, 0.9);
      }
      if (target.hp !== before) target.updateBar?.();
    } else if (this.def.repairer) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + this.repairRate * dt);
      if (this.supportFx <= 0) {
        this.supportFx = 0.22 + Math.random() * 0.16;
        this.game.fx.repairSparks(target.position, Math.min(1.5, 0.55 + target.radius * 0.25));
      }
      if (target.hp !== before) target.updateBar?.();
    }
  }

  /** Пересчитывает характеристики с учётом изученных улучшений фракции. */
  applyUpgrades(heal = false) {
    const mods = this.game.unitModifiers?.(this.faction, this.type);
    if (!mods) return;
    const previousMax = this.maxHp;
    this.maxHp = Math.max(1, Math.round(this.def.hp * mods.hp));
    this.hp = heal
      ? Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - previousMax))
      : this.maxHp;
    this.armor = (this.def.armor ?? 0) + mods.armor;
    this.damage = this.def.damage * mods.damage;
    this.range = this.def.range * mods.range;
    // Обзор растёт вместе с дальностью: иначе юнит не замечает цель
    // на новой дистанции и улучшение дальности почти бесполезно.
    this.aggro = Math.max(this.def.aggro * Math.max(1, mods.range), this.range + 4);
    this.speed = this.def.speed * mods.speed;
    this.pierce = mods.pierce;
    this.vision = (this.def.vision ?? VISION.unit) + mods.visionAdd;
    this.cooldown = this.def.cooldown * mods.cooldown;
    this.splash = (this.def.splash ?? 0) * mods.splash;
    this.salvo = (this.def.salvo ?? 1) + mods.salvoAdd;
    this.healRate = FIELD_SUPPORT.medicRate * mods.healRate;
    this.healSeek = FIELD_SUPPORT.medicSeekRadius * mods.healRadius;
    this.healRange = FIELD_SUPPORT.medicRange * mods.healRadius;
    this.repairRate = FIELD_SUPPORT.engineerRate * mods.repairRate;
    this.buildSpeed = mods.buildSpeed;
    this.updateBar?.();
  }

  resetPath() {
    this.path = null;
    this.pathIndex = 0;
    this.pathTimer = 0;
    this.pathGoal = null;
    this.repathDelay = 0;
  }

  issueMove(x, z) {
    this.order = { type: 'move', x, z };
    this.target = null;
    this.stuckTime = 0;
    this.resetPath();
  }

  issueAttack(target) {
    if (!target || !target.alive) return;
    // Безоружный медик не идёт в атаку: он остаётся на месте и лечит тех,
    // кто уже рядом, вместо того чтобы бежать за врагом без оружия.
    if (!this.canFight) {
      this.issueHold();
      return;
    }
    this.order = { type: 'attack', target };
    this.target = target;
    this.stuckTime = 0;
    this.resetPath();
  }

  issueAttackMove(x, z) {
    this.order = { type: 'attackMove', x, z };
    this.target = null;
    this.stuckTime = 0;
    this.resetPath();
  }

  /**
   * Сопровождение отряда: идти к точке, лечить и чинить по пути, но не искать
   * бой самостоятельно. Огонь — только ответный или по врагу в своей
   * дистанции: догонять его поддержка не должна.
   */
  issueEscort(x, z) {
    this.order = { type: 'escort', x, z };
    this.target = null;
    this.stuckTime = 0;
    this.resetPath();
  }

  /**
   * Занять позицию: стрелять по целям в радиусе, но не преследовать их.
   * Без координат юнит держит текущее место; с координатами сначала идёт
   * к указанной точке, а потом уже держит её.
   */
  issueHold(x = null, z = null) {
    this.order = { type: 'hold', x, z };
    this.target = null;
    this.moving = false;
    this.stuckTime = 0;
    this.resetPath();
  }

  stop() {
    this.order = null;
    this.target = null;
    this.moving = false;
    this.resetPath();
  }

  acquireTarget(range) {
    if (!this.canFight) return null;
    // Инженер на активной стройплощадке не отвлекается на случайные цели:
    // иначе он уходит в бой и стройка останавливается.
    if (
      this.def.builder
      && this.assistBuilding
      && this.assistBuilding.alive
      && !this.assistBuilding.complete
    ) {
      return null;
    }
    let best = null;
    let bestScore = Infinity;
    for (const e of this.game.entities) {
      if (!e.alive || e.faction === this.faction) continue;
      if (!(e instanceof Unit) && !(e instanceof Building)) continue;
      // Стрелять по тому, чего не видно, нельзя — ни игроку, ни противнику.
      if (!this.game.isEntityVisibleTo(this.faction, e)) continue;
      const d = dist(this.position.x, this.position.z, e.position.x, e.position.z);
      if (d - e.radius > range) continue;
      if (Math.abs(e.position.x) > MAP.half + MAP.edge || Math.abs(e.position.z) > MAP.half + MAP.edge) continue;
      const score = d + (e.isBuilding ? 9 : 0) - (e.type === 'derrick' ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  update(dt) {
    if (!this.alive) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.updateVolley(dt);
    if (this.workTimer > 0) this.workTimer -= dt;
    if (this.retaliateTimer > 0) this.retaliateTimer -= dt;

    const order = this.order;
    let desired = null;
    let moveX = null;
    let moveZ = null;
    let support = null;
    const holdPosition = order?.type === 'hold';

    if (order && order.type === 'attack') {
      if (order.target && order.target.alive) desired = order.target;
      else this.order = null;
    } else if (order && order.type === 'attackMove') {
      if (this.target && this.target.alive) {
        const d = dist(this.position.x, this.position.z, this.target.position.x, this.target.position.z);
        const hold = this.retaliateTimer > 0
          ? Math.max(this.aggro, this.range) + 30
          : this.aggro + this.radius + 4;
        if (d < hold) desired = this.target;
        else this.target = null;
      }
      if (!desired) {
        const acquired = this.acquireTarget(this.aggro);
        if (acquired) {
          desired = acquired;
          this.target = acquired;
        } else {
          moveX = order.x;
          moveZ = order.z;
          // Медик в наступающем отряде не бросает раненых: по пути он
          // останавливается, чтобы подлечить пехоту, а потом идёт дальше.
          support = this.findSupportTarget();
        }
      }
    } else if (order && order.type === 'escort') {
      // Сопровождение не ищет бой само: поддержка идёт за отрядом и лечит
      // или чинит то, что встретит по пути. Стреляет она только в ответ
      // тому, кто уже попал по ней (это выставляет takeDamage), либо по
      // врагу в собственном радиусе — догонять его она не должна.
      const attacker = this.target;
      const inReach = attacker?.alive
        && dist(this.position.x, this.position.z, attacker.position.x, attacker.position.z)
          - attacker.radius <= Math.max(this.aggro, this.range);
      if (inReach && this.retaliateTimer > 0) {
        desired = attacker;
      } else if (this.canFight) {
        this.target = this.acquireTarget(this.range);
        desired = this.target;
      } else {
        this.target = null;
      }
      if (!desired) {
        moveX = order.x;
        moveZ = order.z;
        support = this.findSupportTarget();
      }
    } else if (order && order.type === 'move') {
      moveX = order.x;
      moveZ = order.z;
    } else if (holdPosition) {
      // Держать позицию: только огонь по цели, которая уже в радиусе.
      // Догонять убегающего врага нельзя, иначе приказ теряет смысл.
      if (order.x != null && order.z != null) {
        const stop = 0.55 + this.radius * 0.35;
        const d = dist(this.position.x, this.position.z, order.x, order.z);
        if (d > stop) {
          moveX = order.x;
          moveZ = order.z;
        } else {
          order.x = null;
          order.z = null;
        }
      }
      if (this.canFight) {
        const reach = Math.max(this.aggro, this.range);
        if (!this.target || !this.target.alive) {
          this.target = this.acquireTarget(reach);
        }
        if (this.target && this.target.alive) {
          const d = dist(this.position.x, this.position.z, this.target.position.x, this.target.position.z);
          if (d > reach + 8) {
            this.target = null;
          } else {
            const targetRadius = Math.min(this.target.radius, 2.6);
            if (d - targetRadius - this.radius <= this.range) desired = this.target;
          }
        }
      }
      if (!desired) support = this.findSupportTarget();
    } else {
      // Свободный юнит: сначала полевая поддержка, потом поиск цели.
      support = this.findSupportTarget();
      if (!support) {
        if (!this.target || !this.target.alive) {
          this.target = this.acquireTarget(this.aggro);
        }
        if (this.target && this.target.alive) desired = this.target;
        else this.target = null;
      }
    }

    // не гнаться за целью бесконечно далеко, если приказ не был явным
    if (desired && !(order && order.type === 'attack')) {
      const d = dist(this.position.x, this.position.z, desired.position.x, desired.position.z);
      const leash = this.retaliateTimer > 0
        ? Math.max(this.aggro, this.range) + 30
        : this.aggro + 9;
      if (d > leash) {
        this.target = null;
        desired = null;
        if (order && (order.type === 'attackMove' || order.type === 'escort')) {
          moveX = order.x;
          moveZ = order.z;
        } else {
          this.order = null;
        }
      }
    }

    if (desired) {
      this.target = desired;
      this.supportTarget = null;
      const d = dist(this.position.x, this.position.z, desired.position.x, desired.position.z);
      const targetRadius = Math.min(desired.radius, 2.6);
      const inRange = d - targetRadius - this.radius <= this.range;
      if (!this.isBuilding) {
        this.aimAt(desired, dt);
      }
      if (inRange) {
        this.moving = false;
        // Танк стреляет только когда башня действительно довернулась на цель:
        // иначе снаряд визуально уходил в сторону от ствола.
        if (this.attackCd <= 0 && this.canFireAt(desired)) this.fire(desired);
      } else {
        const stop = this.range + targetRadius + this.radius - 0.35;
        this.navigateTo(desired.position.x, desired.position.z, dt, stop);
      }
    } else if (support && !holdPosition) {
      this.supportTarget = support;
      const stop = this.supportStopDistance(support);
      const arrived = this.navigateTo(support.position.x, support.position.z, dt, stop);
      if (arrived || this.supportInRange(support)) this.applySupport(dt, support);
    } else if (support && this.supportInRange(support)) {
      // На позиции поддержка работает, но не подходит к цели.
      this.supportTarget = support;
      this.applySupport(dt, support);
    } else if (moveX !== null) {
      this.supportTarget = null;
      const arrived = this.navigateTo(moveX, moveZ, dt, 0.55 + this.radius * 0.35);
      if (arrived) {
        // Дойдя до якоря, гарнизон остаётся на позиции, а не становится
        // свободным юнитом: иначе он снова уйдёт в погоню за врагом.
        if (this.order?.type === 'hold') {
          this.order.x = null;
          this.order.z = null;
        } else {
          this.order = null;
        }
        this.moving = false;
      }
    } else {
      this.supportTarget = null;
      this.moving = false;
    }

    this.animate(dt);
    this.updateBar();
  }

  aimAt(target, dt) {
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    if (this.type !== 'tank' && this.type !== 'artillery' && !this.moving) {
      const desired = yawTo(dx, dz);
      this.root.rotation.y = turnTowards(this.root.rotation.y, desired, dt * 7);
    }
  }

  /** Насколько башня ещё не довёрнута на цель (радианы). */
  aimError(target) {
    if (!this.parts?.turret) return 0;
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const turretYaw = this.root.rotation.y + this.parts.turret.rotation.y;
    return Math.abs(angleDiff(turretYaw, yawTo(dx, dz)));
  }

  canFireAt(target) {
    if (this.type === 'tank') return this.aimError(target) < 0.16;
    if (this.type === 'artillery') return this.aimError(target) < 0.22;
    return true;
  }

  fire(target) {
    if (!this.alive || this.game.over || !this.canFight) return;
    this.attackCd = this.cooldown ?? this.def.cooldown;
    this.recoil = 1;

    const kind = this.def.projectile ?? 'bullet';
    if (kind === 'rocket') {
      this.startVolley(target);
      return;
    }

    const muzzle = this.getMuzzle();
    const targetPoint = new Vector3(
      target.position.x,
      Math.min(target.def.height * 0.55, 4),
      target.position.z,
    );
    const faction = this.faction;
    this.game.fx.muzzle(muzzle, faction, this.type === 'tank' ? 1.7 : 1);
    this.game.fx.casing(
      muzzle,
      this.root.rotation.y,
      kind === 'shell' ? 'shell' : 'rifle',
      this.def.casing,
    );
    this.game.audio?.shot(this.type, muzzle);

    const speed = kind === 'shell' ? 54 : 94;
    const shotDistance = dist(this.position.x, this.position.z, target.position.x, target.position.z);

    if (kind === 'shell') {
      this.game.fx.fireProjectile({
        from: muzzle,
        to: targetPoint,
        kind,
        faction,
        speed,
        arc: Math.min(1.8, shotDistance * 0.06),
        onImpact: (impact) => {
          if (this.game.over) return;
          this.game.splashDamage(impact, this.splash ?? this.def.splash, this.damage, this);
          this.game.fx.explode(impact, 0.8, { scorch: true });
          this.game.audio?.explosion(impact, 0.8);
        },
      });
      return;
    }

    this.game.fx.fireProjectile({
      from: muzzle,
      to: targetPoint,
      kind: 'bullet',
      faction,
      speed,
      onImpact: () => {
        if (this.game.over) return;
        this.game.dealDamage(target, this.damage, this);
        this.game.fx.hit(targetPoint, target.faction, 0.7);
        this.game.audio?.impact(targetPoint);
      },
    });
  }

  /** РСЗО выпускает ракеты очередью, а не одним залпом в один кадр. */
  startVolley(target) {
    const count = this.salvo ?? this.def.salvo ?? 1;
    const delay = this.def.salvoDelay ?? 0.14;
    const spread = this.def.salvoSpread ?? 2.5;
    const impactY = Math.min(target.def.height * 0.55, 4);
    this.pendingVolley = [];
    for (let i = 0; i < count; i++) {
      this.pendingVolley.push({
        delay: i * delay,
        x: target.position.x + (Math.random() - 0.5) * spread * 2,
        y: impactY,
        z: target.position.z + (Math.random() - 0.5) * spread * 2,
      });
    }
  }

  updateVolley(dt) {
    if (!this.pendingVolley.length) return;
    const next = this.pendingVolley[0];
    next.delay -= dt;
    if (next.delay > 0) return;
    this.pendingVolley.shift();
    if (this.game.over) {
      this.pendingVolley = [];
      return;
    }
    const muzzle = this.getMuzzle();
    const point = new Vector3(next.x, next.y, next.z);
    const shotDistance = dist(this.position.x, this.position.z, point.x, point.z);
    this.game.fx.muzzle(muzzle, this.faction, 1.35);
    this.game.audio?.shot('artillery', muzzle);
    this.recoil = Math.max(this.recoil, 0.65);
    this.game.fx.fireProjectile({
      from: muzzle,
      to: point,
      kind: 'rocket',
      faction: this.faction,
      speed: 38,
      arc: Math.min(5, shotDistance * 0.16),
      onImpact: (impact) => {
        if (this.game.over) return;
        this.game.splashDamage(impact, this.splash ?? this.def.splash, this.damage, this);
        this.game.fx.explode(impact, 0.72, { scorch: true });
        this.game.fx.impactDust(impact, 1.1);
        this.game.audio?.explosion(impact, 0.72);
      },
    });
  }

  getMuzzle() {
    const parts = this.parts;
    if (Array.isArray(parts.muzzles) && parts.muzzles.length) {
      const node = parts.muzzles[this.muzzleIndex % parts.muzzles.length];
      this.muzzleIndex++;
      return node.getAbsolutePosition();
    }
    if (parts.muzzle) {
      this.root.computeWorldMatrix(true);
      return parts.muzzle.getAbsolutePosition();
    }
    return new Vector3(this.position.x, this.def.height * 0.6, this.position.z);
  }

  /**
   * Движение по навигационной сетке: юнит запрашивает путь A*, идёт по
   * сглаженным точкам и перестраивает маршрут, если цель сместилась или
   * путь заблокировали новой постройкой.
   */
  navigateTo(tx, tz, dt, stopDist) {
    const pos = this.position;
    const goalDist = Math.hypot(tx - pos.x, tz - pos.z);
    if (goalDist <= stopDist) {
      this.moving = false;
      this.path = null;
      this.pathIndex = 0;
      return true;
    }

    const nav = this.game.nav;
    if (!nav) return this.moveToward(tx, tz, dt, stopDist);

    this.pathTimer = Math.max(0, this.pathTimer - dt);
    this.repathDelay = Math.max(0, this.repathDelay - dt);
    const goalMoved = !this.pathGoal
      || Math.hypot(tx - this.pathGoal.x, tz - this.pathGoal.z) > 1.5;
    const needsPath = !this.path
      || this.pathTimer <= 0
      || (goalMoved && this.repathDelay <= 0);

    if (needsPath) {
      this.path = nav.findPath(pos.x, pos.z, tx, tz, this.radius + 0.55);
      this.pathIndex = 0;
      this.pathGoal = { x: tx, z: tz };
      this.pathTimer = 0.85 + Math.random() * 0.35;
      this.repathDelay = 0.45;
    }

    let wx = tx;
    let wz = tz;
    let waypointStop = Math.max(0.5, Math.min(1.0, stopDist));
    const hasWaypoints = this.path && this.path.length > 0;
    if (hasWaypoints) {
      while (this.pathIndex < this.path.length - 1) {
        const point = this.path[this.pathIndex];
        if (Math.hypot(point.x - pos.x, point.z - pos.z) > 0.7) break;
        this.pathIndex++;
      }
      const point = this.path[this.pathIndex];
      wx = point.x;
      wz = point.z;
      if (this.pathIndex < this.path.length - 1) {
        waypointStop = Math.max(0.45, Math.min(0.8, this.radius * 0.5));
      }
    }

    const arrived = this.moveToward(wx, wz, dt, waypointStop);
    if (arrived) {
      if (hasWaypoints && this.pathIndex < this.path.length - 1) {
        this.pathIndex++;
        return false;
      }
      this.path = null;
      this.pathIndex = 0;
      return true;
    }
    return false;
  }

  moveToward(tx, tz, dt, stopDist) {
    const pos = this.position;
    let dx = tx - pos.x;
    let dz = tz - pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stopDist) {
      this.moving = false;
      return true;
    }
    let dirX = dx / d;
    let dirZ = dz / d;

    let sx = 0;
    let sz = 0;
    for (const other of this.game.units) {
      if (other === this || !other.alive) continue;
      const ox = pos.x - other.position.x;
      const oz = pos.z - other.position.z;
      const min = this.radius + other.radius + 0.35;
      const dd = Math.hypot(ox, oz);
      if (dd < min && dd > 0.0001) {
        const w = (min - dd) / min;
        sx += (ox / dd) * w;
        sz += (oz / dd) * w;
      }
    }

    let ax = 0;
    let az = 0;
    const obstacles = this.game.getObstaclesNear(pos.x, pos.z, 8);
    for (const o of obstacles) {
      const ox = pos.x - o.x;
      const oz = pos.z - o.z;
      const dObs = Math.hypot(ox, oz);
      const clear = o.radius + this.radius + 1.05;
      if (dObs < clear + 4.5 && dObs > 0.0001) {
        const nx = ox / dObs;
        const nz = oz / dObs;
        const ahead = -(nx * dirX + nz * dirZ);
        const proximity = 1 - clamp((dObs - clear) / 4.5, 0, 1);
        const weight = proximity * (1.4 + Math.max(0, ahead) * 2.4);
        ax += nx * weight;
        az += nz * weight;
        const txv = -nz;
        const tzv = nx;
        const side = txv * dirX + tzv * dirZ >= 0 ? 1 : -1;
        ax += txv * side * weight * 0.9;
        az += tzv * side * weight * 0.9;
      }
    }

    // Стены — отрезки, поэтому их обходим отдельно от круглых препятствий.
    for (const wall of this.game.getWallsNear(pos.x, pos.z, this.radius + 3.5)) {
      const hit = segmentDistance(pos.x, pos.z, wall);
      if (hit.distance > 0.0001 && hit.distance < wall.radius + this.radius + 2.5) {
        const nx = (pos.x - hit.x) / hit.distance;
        const nz = (pos.z - hit.z) / hit.distance;
        const weight = 1 - clamp((hit.distance - wall.radius - this.radius) / 2.5, 0, 1);
        ax += nx * weight * 1.6;
        az += nz * weight * 1.6;
      }
    }

    if (this.detourTimer > 0) {
      this.detourTimer -= dt;
      ax += -dirZ * this.detourSign * 2.0;
      az += dirX * this.detourSign * 2.0;
    }

    // Если маршрут уже проложен, статические препятствия объезжает A*.
    // Сильное локальное отталкивание оставляем только для движения напрямую,
    // иначе юнит «залипает» в локальном минимуме у угла здания.
    const obstacleWeight = this.path && this.path.length ? 0.18 : 0.85;
    let vx = dirX + sx * 1.15 + ax * obstacleWeight;
    let vz = dirZ + sz * 1.15 + az * obstacleWeight;
    const len = Math.hypot(vx, vz);
    if (len > 0.001) {
      vx = (vx / len) * this.speed;
      vz = (vz / len) * this.speed;
    } else {
      vx = dirX * this.speed;
      vz = dirZ * this.speed;
    }

    const beforeX = pos.x;
    const beforeZ = pos.z;
    pos.x = clamp(pos.x + vx * dt, -MAP.clamp, MAP.clamp);
    pos.z = clamp(pos.z + vz * dt, -MAP.clamp, MAP.clamp);

    // выталкивание из статических препятствий
    for (const o of obstacles) {
      const ox = pos.x - o.x;
      const oz = pos.z - o.z;
      const dd = Math.hypot(ox, oz);
      const clear = o.radius + this.radius;
      if (dd < clear && dd > 0.0001) {
        pos.x = o.x + (ox / dd) * clear;
        pos.z = o.z + (oz / dd) * clear;
      }
    }
    for (const wall of this.game.getWallsNear(pos.x, pos.z, this.radius + 1.2)) {
      const hit = segmentDistance(pos.x, pos.z, wall);
      const clear = wall.radius + this.radius;
      if (hit.distance < clear) {
        let nx;
        let nz;
        if (hit.distance > 0.0001) {
          nx = (pos.x - hit.x) / hit.distance;
          nz = (pos.z - hit.z) / hit.distance;
        } else {
          nx = -this.lastDirZ;
          nz = this.lastDirX;
        }
        pos.x = hit.x + nx * clear;
        pos.z = hit.z + nz * clear;
      }
    }
    pos.x = clamp(pos.x, -MAP.clamp, MAP.clamp);
    pos.z = clamp(pos.z, -MAP.clamp, MAP.clamp);

    const moved = Math.hypot(pos.x - beforeX, pos.z - beforeZ);
    if (moved < this.speed * dt * 0.16) {
      this.stuckTime += dt;
      if (this.stuckTime > 0.7) {
        this.detourTimer = 0.8;
        this.detourSign = Math.random() < 0.5 ? -1 : 1;
        this.stuckTime = 0;
        // Маршрут мог устареть: перестроим его при следующем кадре.
        this.path = null;
        this.pathTimer = 0;
      }
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    }

    if (moved > 0.0001) {
      this.lastDirX = (pos.x - beforeX) / moved;
      this.lastDirZ = (pos.z - beforeZ) / moved;
    }
    this.moving = true;
    return false;
  }

  animate(dt) {
    this.recoil = Math.max(0, this.recoil - dt * 7);
    const pos = this.position;
    this.root.position.x = pos.x;
    this.root.position.z = pos.z;
    const moving = this.moving;
    if (moving) {
      this.walkPhase += dt * (this.type === 'scout' ? 13 : this.type === 'tank' ? 5 : this.type === 'artillery' ? 6 : this.type === 'engineer' ? 10 : 9);
      const targetAngle = yawTo(this.lastDirX, this.lastDirZ);
      this.root.rotation.y = turnTowards(this.root.rotation.y, targetAngle, dt * 5.5);
    }
    const bob = moving && this.type !== 'tank' && this.type !== 'artillery'
      ? Math.abs(Math.sin(this.walkPhase * 0.9)) * 0.05
      : 0;
    this.root.position.y = bob;

    if (this.type === 'marine') {
      const swing = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
      this.parts.hips[0].rotation.x = damp(this.parts.hips[0].rotation.x, swing, 12, dt);
      this.parts.hips[1].rotation.x = damp(this.parts.hips[1].rotation.x, -swing, 12, dt);
      this.parts.arms[0].rotation.x = damp(this.parts.arms[0].rotation.x, -swing * 0.5, 10, dt);
      this.parts.arms[1].rotation.x = damp(this.parts.arms[1].rotation.x, swing * 0.35 - 0.05, 10, dt);
      if (this.parts.gun) this.parts.gun.position.z = 0.55 - this.recoil * 0.12;
    } else if (this.type === 'engineer') {
      const swing = moving ? Math.sin(this.walkPhase) * 0.5 : 0;
      this.parts.hips[0].rotation.x = damp(this.parts.hips[0].rotation.x, swing, 12, dt);
      this.parts.hips[1].rotation.x = damp(this.parts.hips[1].rotation.x, -swing, 12, dt);
      if (this.workTimer > 0) {
        const work = this.game.elapsed * 15;
        this.parts.arms[1].rotation.x = -0.85 + Math.sin(work) * 0.5;
        this.parts.arms[0].rotation.x = -0.35 + Math.cos(work * 0.7) * 0.18;
        this.parts.wrench.rotation.z = Math.sin(work * 1.4) * 0.35;
      } else {
        this.parts.arms[0].rotation.x = damp(this.parts.arms[0].rotation.x, -swing * 0.45, 10, dt);
        this.parts.arms[1].rotation.x = damp(this.parts.arms[1].rotation.x, swing * 0.45 - 0.05, 10, dt);
        this.parts.wrench.rotation.z = damp(this.parts.wrench.rotation.z, 0, 8, dt);
      }
    } else if (this.type === 'medic') {
      const swing = moving ? Math.sin(this.walkPhase) * 0.48 : 0;
      this.parts.hips[0].rotation.x = damp(this.parts.hips[0].rotation.x, swing, 12, dt);
      this.parts.hips[1].rotation.x = damp(this.parts.hips[1].rotation.x, -swing, 12, dt);
      if (this.workTimer > 0) {
        const work = this.game.elapsed * 12;
        this.parts.arms[0].rotation.x = -1.05 + Math.sin(work) * 0.14;
        this.parts.arms[0].rotation.z = 0.14;
        this.parts.arms[1].rotation.x = -0.5 + Math.cos(work * 0.8) * 0.1;
        if (this.parts.medkit) this.parts.medkit.rotation.z = Math.sin(work * 1.3) * 0.16;
      } else {
        this.parts.arms[0].rotation.x = damp(this.parts.arms[0].rotation.x, -swing * 0.4, 10, dt);
        this.parts.arms[0].rotation.z = damp(this.parts.arms[0].rotation.z, 0, 8, dt);
        this.parts.arms[1].rotation.x = damp(this.parts.arms[1].rotation.x, swing * 0.4 - 0.05, 10, dt);
        if (this.parts.medkit) this.parts.medkit.rotation.z = damp(this.parts.medkit.rotation.z, 0, 8, dt);
      }
    } else if (this.type === 'scout') {
      const spin = moving ? 13 * dt : 0;
      for (const wheel of this.parts.wheels) wheel.rotation.y += spin;
      if (this.parts.muzzles) {
        // лёгкое покачивание корпуса
        this.root.rotation.z = Math.sin(this.walkPhase * 0.6) * (moving ? 0.025 : 0);
      }
    } else if (this.type === 'tank') {
      const desired = this.target && this.target.alive
        ? yawTo(this.target.position.x - pos.x, this.target.position.z - pos.z) - this.root.rotation.y
        : 0;
      this.parts.turret.rotation.y = turnTowards(this.parts.turret.rotation.y, desired, dt * 4.4);
      if (this.parts.barrelGroup) this.parts.barrelGroup.position.z = 0.6 - this.recoil * 0.3;
      this.root.position.y = 0;
    } else if (this.type === 'artillery') {
      const spin = moving ? 9 * dt : 0;
      for (const wheel of this.parts.wheels ?? []) wheel.rotation.y += spin;
      const desired = this.target && this.target.alive
        ? yawTo(this.target.position.x - pos.x, this.target.position.z - pos.z) - this.root.rotation.y
        : 0;
      this.parts.turret.rotation.y = turnTowards(this.parts.turret.rotation.y, desired, dt * 3.2);
      this.root.position.y = 0;
    }

    if (this.selected && this.ring) {
      const s = 1 + Math.sin(this.game.elapsed * 3) * 0.02;
      this.ring.scaling.set(s, 1, s);
    }
  }

  disposeVisual() {
    super.disposeVisual();
  }
}

export class Building extends Entity {
  constructor(game, faction, type, x, z, opts = {}) {
    const def = BUILDINGS[type];
    super(game, faction, type, def, x, z, true);
    this.complete = !!opts.complete;
    this.construction = this.complete ? 1 : 0;
    this.hpCap = this.maxHp;
    if (!this.complete) {
      // У только что заложенного здания есть лишь фундамент: полный запас
      // прочности появится вместе со стенами, а не мгновенно.
      this.hpCap = this.maxHp * CONSTRUCTION.minHpFraction;
      this.hp = this.hpCap;
    }
    this.queue = [];
    this.rally = null;
    this.rotation = opts.rotation ?? yawTo(-x, -z);
    this.door = 0;
    this.oilPatch = null;
    this.fxTimer = 1 + Math.random() * 2;
    this.forceBar = !this.complete;
    this.repairing = false;
    this.repairFx = 0;
    this.builderCount = 0;
    this.stalledTime = 0;
    this.buildFx = 0;
    this.attackCd = 0.3 + Math.random() * 0.4;
    this.defenseTarget = null;
    this.recoil = 0;

    this.model = game.factory.building(type, faction);
    this.root = this.model.root;
    this.parts = this.model.parts;
    this.height = this.model.height;
    this.fogGhost = null;
    this.root.rotation.y = this.rotation;
    this.setupVisual();
    this.applyUpgrades();

    if (!this.complete) {
      this.ghostMat = game.factory.mat('ghostCyan', {
        color: '#6ceaff',
        emissive: '#38c8ff',
        unlit: true,
        alpha: 0.32,
        fog: false,
        backFaceCulling: false,
      });
      this.originalMaterials = new Map();
      this.root.getChildMeshes(false).forEach((mesh) => {
        this.originalMaterials.set(mesh, mesh.material);
        mesh.material = this.ghostMat;
      });
      const buildRing = MeshBuilder.CreateTorus('buildRing', {
        diameter: this.radius * 2.5,
        thickness: 0.12,
        tessellation: 40,
      }, game.scene);
      buildRing.material = this.ghostMat;
      buildRing.position.set(x, 0.12, z);
      buildRing.isPickable = false;
      buildRing.receiveShadows = false;
      this.buildRing = buildRing;
      this.applyConstructionVisual();
    }

    this.rally = this.defaultRally();
    if (type === 'barracks') this.ensureRallyVisual();
    this.updateBar();
  }

  /**
   * Пересчитывает прочность и оборонные характеристики постройки с учётом
   * изученных улучшений. Для недостроенного здания сохраняется прогресс.
   */
  applyUpgrades(heal = false) {
    const mods = this.game.buildingModifiers?.(this.faction, this.type);
    if (!mods) return;
    const previousMax = this.maxHp;
    this.maxHp = Math.max(1, Math.round(this.def.hp * mods.hp));
    this.armor = (this.def.armor ?? 0) + (mods.armor ?? 0);
    if (this.complete) {
      this.hpCap = this.maxHp;
      this.hp = heal
        ? Math.min(this.maxHp, this.hp + Math.max(0, this.maxHp - previousMax))
        : this.maxHp;
    } else {
      // setConstruction пересчитает потолок прочности и добавит прирост
      // к текущим HP, поэтому урон, полученный на стройке, сохраняется.
      this.setConstruction(this.construction);
    }
    if (this.type === 'turret' && this.def.defense) {
      const d = this.def.defense;
      this.defense = {
        ...d,
        damage: d.damage * mods.damage,
        range: d.range * mods.range,
        cooldown: d.cooldown * mods.cooldown,
        aggro: d.aggro * Math.max(1, mods.range),
      };
    }
    this.updateBar?.();
  }

  setFogState(state) {
    super.setFogState(state);
    if (this.buildRing) this.buildRing.setEnabled(state === 'visible' && !this.complete);
    if (state === 'visible') {
      this.fogGhost?.setEnabled(false);
    } else if (state === 'ghost') {
      this.updateFogGhost();
      this.fogGhost?.setEnabled(true);
    } else {
      this.fogGhost?.setEnabled(false);
    }
  }

  /**
   * Приглушённый двойник постройки для серой зоны. Живую модель нельзя
   * просто оставить включённой: тогда в тумане были бы видны анимации,
   * ремонт и полоска прочности. Двойник — статичный и одноцветный.
   */
  ensureFogGhost() {
    if (this.fogGhost) return this.fogGhost;
    const model = this.game.factory.building(this.type, this.faction);
    const root = model.root;
    const material = this.game.factory.mat('fogGhost', {
      color: '#a9968e',
      emissive: '#4b3d38',
      unlit: true,
      alpha: 0.42,
      fog: false,
      backFaceCulling: false,
    });
    const glow = this.game.scene.getGlowLayerByName?.('glow');
    const meshes = root.getChildMeshes(false);
    meshes.forEach((mesh) => {
      mesh.material = material;
      mesh.metadata = { ghost: this };
      mesh.isPickable = true;
      mesh.castShadow = false;
      mesh.receiveShadows = false;
      mesh.applyFog = false;
      glow?.addExcludedMesh?.(mesh);
    });

    // Силуэт статичный, поэтому все детали можно склеить в один меш:
    // у больших зданий это десятки draw call'ов, которые в тумане не нужны.
    let visual = root;
    if (meshes.length > 1 && meshes.every((mesh) => mesh.getClassName?.() === 'Mesh')) {
      const merged = Mesh.MergeMeshes(meshes, false, true, undefined, false, false);
      if (merged) {
        merged.name = `fogGhost_${this.id}`;
        merged.material = material;
        merged.metadata = { ghost: this };
        merged.isPickable = true;
        merged.castShadow = false;
        merged.receiveShadows = false;
        merged.applyFog = false;
        merged.parent = null;
        merged.position.set(0, 0, 0);
        merged.rotation.set(0, 0, 0);
        merged.scaling.set(1, 1, 1);
        glow?.addExcludedMesh?.(merged);
        meshes.forEach((mesh) => {
          glow?.removeExcludedMesh?.(mesh);
          mesh.dispose();
        });
        root.dispose();
        visual = merged;
      }
    }

    // Контур у основания помогает читать даже низкие постройки — турели,
    // вышки и баррикады, которые иначе почти сливаются с землёй.
    const ring = MeshBuilder.CreateTorus('fogGhostRing', {
      diameter: Math.max(3.2, this.radius * 2.35),
      thickness: 0.07,
      tessellation: 28,
    }, this.game.scene);
    ring.material = material;
    ring.parent = visual;
    ring.position.y = 0.16;
    ring.isPickable = true;
    ring.metadata = { ghost: this };
    ring.castShadow = false;
    ring.receiveShadows = false;
    glow?.addExcludedMesh?.(ring);
    visual.setEnabled(false);
    this.fogGhost = visual;
    return visual;
  }

  updateFogGhost() {
    const ghost = this.fogGhost ?? this.ensureFogGhost();
    if (!ghost) return;
    ghost.position.set(this.position.x, 0, this.position.z);
    ghost.rotation.y = this.rotation;
    // Недостроенное здание запоминается недостроенным: это честнее, чем
    // показывать в тумане готовую постройку, которой игрок не видел.
    const progress = this.complete ? 1 : clamp(this.construction, 0, 1);
    ghost.scaling.set(1, 0.22 + 0.78 * progress, 1);
  }

  defaultRally() {
    const len = Math.hypot(this.position.x, this.position.z) || 1;
    const dx = -this.position.x / len;
    const dz = -this.position.z / len;
    return new Vector3(
      clamp(this.position.x + dx * (this.radius + 4.5), -MAP.clamp, MAP.clamp),
      0,
      clamp(this.position.z + dz * (this.radius + 4.5), -MAP.clamp, MAP.clamp),
    );
  }

  applyConstructionVisual() {
    const p = clamp(this.construction, 0, 1);
    this.root.scaling.y = 0.22 + 0.78 * p;
    const vis = 0.42 + 0.58 * p;
    this.root.getChildMeshes(false).forEach((mesh) => {
      mesh.visibility = vis;
    });
    if (this.buildRing) {
      this.buildRing.scaling.set(0.9 + p * 0.15, 1, 0.9 + p * 0.15);
      this.buildRing.visibility = 0.6 + p * 0.35;
    }
  }

  /**
   * Пересчитывает прочность по прогрессу стройки. Прирост «новых» HP
   * добавляется к текущим, поэтому уже полученный урон сохраняется: здание
   * не лечится само, когда достраивается.
   */
  setConstruction(value) {
    const previousCap = this.hpCap ?? this.maxHp;
    this.construction = clamp(value, 0, 1);
    this.hpCap = this.maxHp * (
      CONSTRUCTION.minHpFraction
      + (1 - CONSTRUCTION.minHpFraction) * this.construction
    );
    const gained = this.hpCap - previousCap;
    if (gained > 0) this.hp = Math.min(this.hpCap, this.hp + gained);
  }

  finishConstruction() {
    if (this.complete) return;
    this.setConstruction(1);
    this.complete = true;
    this.forceBar = false;
    this.root.scaling.set(1, 1, 1);
    if (this.originalMaterials) {
      this.root.getChildMeshes(false).forEach((mesh) => {
        const original = this.originalMaterials.get(mesh);
        if (original) mesh.material = original;
        mesh.visibility = 1;
      });
      this.originalMaterials = null;
    }
    if (this.buildRing) {
      this.buildRing.dispose();
      this.buildRing = null;
    }
    this.game.fx.buildDust(this.position, 1.2 + this.radius * 0.1);
    if (this.faction === 'player') {
      this.game.notify(`Строительство завершено: ${this.def.name}`, 'success', `done_${this.id}`);
    }
    this.builderCount = 0;
    this.game.recomputePower();
    this.updateBar();
  }

  cancelConstruction(refund = true) {
    if (this.complete) return;
    this.game.cancelBuilding(this, refund);
  }

  setRally(x, z) {
    this.rally = new Vector3(clamp(x, -MAP.clamp, MAP.clamp), 0, clamp(z, -MAP.clamp, MAP.clamp));
    this.updateRallyVisual();
    this.game.fx.orderMarker(this.rally, 'move');
  }

  ensureRallyVisual() {
    if (this.rallyVisual || this.def.key !== 'barracks') return;
    const scene = this.game.scene;
    const factory = this.game.factory;
    const group = new TransformNode('rallyVis', scene);
    const ring = MeshBuilder.CreateTorus('rallyRing', { diameter: 2.3, thickness: 0.07, tessellation: 30 }, scene);
    ring.material = factory.mat(`rallyRing_${this.faction}`, {
      color: FACTIONS[this.faction].accent,
      emissive: FACTIONS[this.faction].accent,
      unlit: true,
      alpha: 0.8,
      fog: false,
      backFaceCulling: false,
    });
    ring.parent = group;
    ring.position.y = 0.08;
    ring.isPickable = false;
    const pole = MeshBuilder.CreateCylinder('rallyPole', { diameter: 0.07, height: 1.6, tessellation: 5 }, scene);
    pole.material = factory.mat('rallyPole', { color: '#8a949c', specular: 0.3 });
    pole.parent = group;
    pole.position.y = 0.8;
    pole.isPickable = false;
    const flag = MeshBuilder.CreatePlane('rallyFlag', { width: 0.85, height: 0.5, sideOrientation: Mesh.DOUBLESIDE }, scene);
    flag.material = factory.mat(`rallyFlag_${this.faction}`, {
      color: FACTIONS[this.faction].accent,
      emissive: FACTIONS[this.faction].accent,
      unlit: true,
      alpha: 0.9,
      fog: false,
    });
    flag.parent = group;
    flag.position.set(0.45, 1.35, 0);
    flag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flag.isPickable = false;
    group.position.copyFrom(this.rally);
    group.setEnabled(false);
    this.rallyVisual = group;
    this.updateRallyVisual();
  }

  updateRallyVisual() {
    if (!this.rallyVisual || !this.rally) return;
    this.rallyVisual.position.set(this.rally.x, 0, this.rally.z);
    this.rallyVisual.setEnabled(this.selected && this.alive);
  }

  setSelected(value) {
    super.setSelected(value);
    this.updateRallyVisual();
  }

  enqueue(type) {
    const def = UNITS[type];
    const time = def.buildTime * (this.game.trainTimeMultiplier?.(this.faction) ?? 1);
    this.queue.push({ type, remaining: time, total: time });
    this.forceBar = true;
    return true;
  }

  /** Ставит в очередь исследование техцентра. */
  enqueueUpgrade(key) {
    const def = UPGRADES[key];
    if (!def) return false;
    this.queue.push({ upgrade: key, remaining: def.time, total: def.time });
    this.forceBar = true;
    return true;
  }

  cancelQueue(index) {
    if (index < 0 || index >= this.queue.length) return null;
    const [item] = this.queue.splice(index, 1);
    if (this.queue.length === 0) this.forceBar = !this.complete;
    return item;
  }

  get production() {
    return this.queue[0] ?? null;
  }

  // ------------------------------------------------------------- defense
  /** Ближайший вражеский юнит в радиусе обнаружения орудия. */
  acquireDefenseTarget(range) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.game.units) {
      if (!e.alive || e.faction === this.faction) continue;
      if (!(e instanceof Unit)) continue;
      if (!this.game.isEntityVisibleTo(this.faction, e)) continue;
      const d = dist(this.position.x, this.position.z, e.position.x, e.position.z);
      if (d - e.radius > range) continue;
      const score = d + (e.type === 'tank' ? -1.5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** Стационарное орудие: наводится, стреляет и не требует команд игрока. */
  updateDefense(dt) {
    const def = this.defense;
    if (!def) return;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    let target = this.defenseTarget;
    if (target && target.alive) {
      const d = dist(this.position.x, this.position.z, target.position.x, target.position.z);
      if (d > def.aggro * 1.5) target = null;
    } else {
      target = null;
    }
    if (!target) target = this.acquireDefenseTarget(def.aggro);
    this.defenseTarget = target;
    const head = this.parts?.head;
    if (!target) {
      if (head) head.rotation.y = turnTowards(head.rotation.y, 0, dt * 1.1);
      return;
    }
    const dx = target.position.x - this.position.x;
    const dz = target.position.z - this.position.z;
    const desired = yawTo(dx, dz) - this.root.rotation.y;
    if (head) head.rotation.y = turnTowards(head.rotation.y, desired, dt * 3.4);
    const aimError = Math.abs(angleDiff(this.root.rotation.y + (head?.rotation.y ?? 0), yawTo(dx, dz)));
    const d = Math.hypot(dx, dz);
    const inRange = d - target.radius - this.radius <= def.range;
    if (inRange && this.attackCd <= 0 && aimError < 0.2) this.fireDefense(target, def);
  }

  fireDefense(target, def) {
    if (!this.alive || this.game.over) return;
    this.attackCd = def.cooldown;
    this.recoil = 1;
    const muzzle = this.parts?.muzzle
      ? this.parts.muzzle.getAbsolutePosition()
      : new Vector3(this.position.x, def.muzzleHeight ?? 2.4, this.position.z);
    const targetPoint = new Vector3(
      target.position.x,
      Math.min(target.def.height * 0.55, 4),
      target.position.z,
    );
    this.game.fx.muzzle(muzzle, this.faction, 1.15);
    const aimYaw = Math.atan2(target.position.x - this.position.x, target.position.z - this.position.z);
    this.game.fx.casing(muzzle, aimYaw, 'turret', def.casing);
    this.game.audio?.shot('turret', muzzle);
    this.game.fx.fireProjectile({
      from: muzzle,
      to: targetPoint,
      kind: def.projectile ?? 'bullet',
      faction: this.faction,
      speed: 96,
      onImpact: (impact) => {
        if (this.game.over) return;
        this.game.dealDamage(target, def.damage, this);
        this.game.fx.hit(impact, target.faction, 0.65);
      },
    });
  }

  update(dt) {
    if (!this.alive) return;
    const game = this.game;

    if (!this.complete) {
      const builders = game.buildersNear(this);
      this.builderCount = builders.length;
      if (builders.length) {
        this.stalledTime = 0;
        const workers = Math.min(builders.length, 4);
        const engineerBoost = builders[0]?.buildSpeed ?? 1;
        const buildTime = this.def.buildTime * (game.buildTimeMultiplier?.(this.faction) ?? 1);
        this.setConstruction(this.construction + (dt / buildTime) * workers * engineerBoost);
        for (const unit of builders) unit.workTimer = 0.22;
        this.buildFx -= dt;
        if (this.buildFx <= 0) {
          this.buildFx = 0.24 + Math.random() * 0.18;
          game.fx.repairSparks(this.position, Math.min(2.4, 0.7 + this.radius * 0.3));
        }
        this.applyConstructionVisual();
        if (this.construction >= 1) this.finishConstruction();
      } else {
        this.stalledTime += dt;
        if (this.stalledTime > 1.5 && this.faction === 'player') {
          game.notify(MESSAGES.needEngineer, 'warn', `need_engineer_${this.id}`, 9, 5);
        }
      }
      this.updateBar();
      return;
    }

    if (this.repairing) game.repairTick(this, dt);
    this.updateDefense(dt);

    if (this.queue.length) {
      const item = this.queue[0];
      const speed = game.powerFactor(this.faction);
      item.remaining -= dt * speed;
      this.forceBar = true;
      if (item.remaining <= 0) {
        this.queue.shift();
        if (item.upgrade) game.completeUpgrade(this, item.upgrade);
        else game.spawnFromBuilding(this, item.type);
        if (this.queue.length === 0) this.forceBar = false;
        game.ui?.onQueueChanged(this);
      }
    } else {
      this.forceBar = false;
    }

    this.animate(dt);
    this.updateBar();
  }

  animate(dt) {
    const t = this.game.elapsed;
    const parts = this.parts;
    if (this.repairing) {
      this.repairFx -= dt;
      if (this.repairFx <= 0) {
        this.repairFx = 0.18 + Math.random() * 0.16;
        this.game.fx.repairSparks(this.position, Math.min(2.4, 0.7 + this.radius * 0.3));
      }
    } else {
      this.repairFx = 0;
    }
    if (this.type === 'hq' && parts.radar) {
      parts.radar.rotation.y = t * 0.55;
      if (parts.flag) parts.flag.rotation.y = Math.PI / 2 + Math.sin(t * 1.6) * 0.12;
    } else if (this.type === 'power' && parts.vortex) {
      parts.vortex.rotation.y = t * 2.2;
    } else if (this.type === 'derrick') {
      if (parts.pump) parts.pump.rotation.z = (parts.pumpBase ?? -0.13) + Math.sin(t * 2.1) * 0.15;
      if (parts.crank) parts.crank.rotation.y = t * 2.5;
      if (parts.flare) {
        const flick = 0.82 + Math.sin(t * 11) * 0.12 + Math.sin(t * 17 + 1) * 0.06;
        parts.flare.scaling.set(1, flick, 1);
      }
    } else if (this.type === 'barracks') {
      const target = this.queue.length ? 1 : 0;
      this.door = damp(this.door, target, 4, dt);
      if (parts.door) parts.door.position.y = (parts.doorBaseY ?? 1.02) + this.door * 1.5;
      if (parts.flag) parts.flag.rotation.y = Math.PI / 2 + Math.sin(t * 1.2) * 0.1;
    } else if (this.type === 'lab') {
      // Во время исследования тарелка вращается быстрее — здание «работает».
      if (parts.radar) parts.radar.rotation.y = t * (this.queue.length ? 1.5 : 0.45);
      if (parts.orb) {
        const pulse = 1 + Math.sin(t * 2.4) * (this.queue.length ? 0.16 : 0.07);
        parts.orb.scaling.set(pulse, pulse, pulse);
      }
    } else if (this.type === 'depot') {
      // Маяк жилого модуля медленно пульсирует, показывая, что лимит активен.
      if (parts.beacon) {
        const pulse = 1 + Math.sin(t * 2.1) * 0.22;
        parts.beacon.scaling.set(pulse, pulse, pulse);
      }
    } else if (this.type === 'turret') {
      // Откат спаренных стволов после выстрела.
      if (parts.barrels) parts.barrels.position.z = 0.8 - this.recoil * 0.22;
      if (parts.muzzle) parts.muzzle.position.z = 2.45 - this.recoil * 0.22;
    }

    // редкие атмосферные частицы
    this.fxTimer -= dt;
    if (this.fxTimer <= 0) {
      this.fxTimer = 2.2 + Math.random() * 2.4;
      if (this.type === 'power') {
        for (const side of [-1, 1]) {
          const px = Math.cos(this.rotation) * 3.35 * side - Math.sin(this.rotation) * -1.15 + this.position.x;
          const pz = -Math.sin(this.rotation) * 3.35 * side - Math.cos(this.rotation) * -1.15 + this.position.z;
          this.game.fx.puff('dust', new Vector3(px, 4.35, pz), {
            life: 2.4,
            size0: 0.7,
            size1: 2.8,
            fade: 0.3,
            alpha: 0.4,
            vel: new Vector3(0, 1.2, 0),
            buoyancy: 0.5,
            drag: 0.2,
          });
        }
      } else if (this.type === 'derrick') {
        const px = this.position.x + Math.cos(this.rotation) * 1.8 + Math.sin(this.rotation) * 1.8;
        const pz = this.position.z - Math.sin(this.rotation) * 1.8 + Math.cos(this.rotation) * 1.8;
        this.game.fx.puff('smokeDark', new Vector3(px, 4.6, pz), {
          life: 2.6,
          size0: 0.35,
          size1: 1.6,
          fade: 0.25,
          alpha: 0.4,
          vel: new Vector3(0.2, 1.1, 0.2),
          buoyancy: 0.3,
        });
      }
    }
  }

  updateBar() {
    this.forceBar = !this.complete || this.queue.length > 0;
    super.updateBar();
    if (!this.bar) return;
    const progressRoot = this.bar.progress;
    if (!this.barVisible) {
      progressRoot.setEnabled(false);
      return;
    }
    let progress = 0;
    let show = false;
    if (!this.complete) {
      progress = this.construction;
      show = true;
    } else if (this.queue.length) {
      const item = this.queue[0];
      progress = 1 - item.remaining / item.total;
      show = true;
    }
    progressRoot.setEnabled(show);
    if (show) {
      const frac = clamp(progress, 0, 1);
      this.bar.pFill.scaling.x = Math.max(0.001, frac);
      this.bar.pFill.position.x = -(this.bar.pWidth * (1 - frac)) / 2;
    }
  }

  disposeVisual() {
    if (this.fogGhost) {
      const glow = this.game.scene.getGlowLayerByName?.('glow');
      this.fogGhost.getChildMeshes(false).forEach((mesh) => {
        glow?.removeExcludedMesh?.(mesh);
        mesh.dispose();
      });
      glow?.removeExcludedMesh?.(this.fogGhost);
      this.fogGhost.dispose();
      this.fogGhost = null;
    }
    if (this.buildRing) {
      this.buildRing.dispose();
      this.buildRing = null;
    }
    if (this.rallyVisual) {
      this.rallyVisual.getChildMeshes(false).forEach((m) => m.dispose());
      this.rallyVisual.dispose();
      this.rallyVisual = null;
    }
    super.disposeVisual();
  }
}
