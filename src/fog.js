// Туман войны: что сторона уже видела и что видит прямо сейчас.
//
// Сетка клеток покрывает игровое поле. Каждый юнит и здание «подсвечивают»
// клетки вокруг себя: они становятся видимыми, а всё, что было видно раньше,
// остаётся исследованным. По этой сетке строятся и туман на земле, и затемнение
// тактической карты, и правила наведения: нельзя стрелять по тому, чего не
// видно.

import {
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  Texture,
  Vector3,
} from './babylon.js';
import { MAP, VISION } from './config.js';

const CELL = 3;
const SIZE = Math.ceil((MAP.half * 2) / CELL);
// Насколько плотно закрыт туман: неисследованное — почти чёрное, исследованное
// без обзора — полупрозрачная дымка, наблюдаемое — прозрачно.
const FOG_RGB = [7, 11, 16];
const ALPHA_UNSEEN = 255;
const ALPHA_EXPLORED = 138;

export class FogOfWar {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.timer = 0;
    this.grids = {
      player: { visible: new Uint8Array(SIZE * SIZE), explored: new Uint8Array(SIZE * SIZE) },
      enemy: { visible: new Uint8Array(SIZE * SIZE), explored: new Uint8Array(SIZE * SIZE) },
    };
    // Постройки, которые сторона видела хотя бы раз. В отличие от клеток,
    // память привязана к конкретному зданию: новое здание в уже разведанной
    // области не появится, пока его снова не увидят.
    this.knownBuildings = {
      player: new Set(),
      enemy: new Set(),
    };
    this._buildTerrain();
    this.refresh();
    this.applyVisibility();
    this.drawTerrain();
  }

  // ------------------------------------------------------------- сетка
  cellOf(x, z) {
    const cx = Math.floor((x + MAP.half) / CELL);
    const cz = Math.floor((z + MAP.half) / CELL);
    return {
      cx: Math.min(SIZE - 1, Math.max(0, cx)),
      cz: Math.min(SIZE - 1, Math.max(0, cz)),
    };
  }

  /** Радиус обзора сущности в мировых единицах. */
  visionOf(entity) {
    if (entity.vision) return entity.vision;
    if (entity.isBuilding) {
      return entity.type === 'hq' ? VISION.hq : VISION.building;
    }
    return VISION.unit;
  }

  reveal(grid, x, z, radius) {
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor((x - radius + MAP.half) / CELL));
    const maxX = Math.min(SIZE - 1, Math.floor((x + radius + MAP.half) / CELL));
    const minZ = Math.max(0, Math.floor((z - radius + MAP.half) / CELL));
    const maxZ = Math.min(SIZE - 1, Math.floor((z + radius + MAP.half) / CELL));
    for (let cz = minZ; cz <= maxZ; cz++) {
      const wz = (cz + 0.5) * CELL - MAP.half;
      const dz = wz - z;
      for (let cx = minX; cx <= maxX; cx++) {
        const wx = (cx + 0.5) * CELL - MAP.half;
        const dx = wx - x;
        if (dx * dx + dz * dz > r2) continue;
        const index = cz * SIZE + cx;
        grid.visible[index] = 1;
        grid.explored[index] = 1;
      }
    }
  }

  /** Пересобирает обзор обеих сторон по всем живым юнитам и зданиям. */
  refresh() {
    const grids = this.grids;
    for (const faction of ['player', 'enemy']) {
      grids[faction].visible.fill(0);
    }
    for (const entity of this.game.entities) {
      if (!entity.alive) continue;
      const grid = grids[entity.faction];
      if (!grid) continue;
      this.reveal(grid, entity.position.x, entity.position.z, this.visionOf(entity));
    }
    this.rememberBuildings();
  }

  /**
   * Запоминает чужие постройки, попавшие в текущий обзор. Юниты не
   * запоминаются: они двигаются, и память о них превратила бы туман в
   * угадайку. Здания, наоборот, неподвижны — их полезно помнить.
   */
  rememberBuildings() {
    for (const entity of this.game.entities) {
      if (!entity.alive || !entity.isBuilding) continue;
      const observer = entity.faction === 'player' ? 'enemy' : 'player';
      const grid = this.grids[observer];
      if (!grid) continue;
      const { cx, cz } = this.cellOf(entity.position.x, entity.position.z);
      if (grid.visible[cz * SIZE + cx] === 1) {
        this.knownBuildings[observer].add(entity.id);
      }
    }
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    this.refresh();
    this.applyVisibility();
    this.game.world.applyFogVisibility(this);
    this.drawTerrain();
  }

  // ------------------------------------------------------------- запросы
  isVisible(faction, x, z) {
    const grid = this.grids[faction];
    if (!grid) return true;
    const { cx, cz } = this.cellOf(x, z);
    return grid.visible[cz * SIZE + cx] === 1;
  }

  isExplored(faction, x, z) {
    const grid = this.grids[faction];
    if (!grid) return true;
    const { cx, cz } = this.cellOf(x, z);
    return grid.explored[cz * SIZE + cx] === 1;
  }

  isEntityVisible(faction, entity) {
    if (!entity) return true;
    if (entity.faction === faction) return true;
    return this.isVisible(faction, entity.position.x, entity.position.z);
  }

  /** Известна ли стороне эта постройка — сейчас или по прошлой разведке. */
  isBuildingKnown(faction, building) {
    if (!building) return false;
    if (building.faction === faction) return true;
    return this.knownBuildings[faction]?.has(building.id) ?? false;
  }

  /** Забыть постройку: уничтожена или снесена. */
  forgetBuilding(building) {
    if (!building) return;
    this.knownBuildings.player.delete(building.id);
    this.knownBuildings.enemy.delete(building.id);
  }

  /**
   * Чужие юниты в тумане не рисуются, а постройки имеют три состояния:
   * видима сейчас, известна по прошлой разведке (приглушённый силуэт) или
   * неизвестна вовсе. Свои объекты видны всегда.
   */
  applyVisibility() {
    for (const entity of this.game.entities) {
      if (!entity.alive || !entity.root) continue;
      let state = 'visible';
      if (entity.faction !== 'player') {
        const visible = this.isVisible('player', entity.position.x, entity.position.z);
        if (!visible) {
          state = entity.isBuilding && this.isBuildingKnown('player', entity)
            ? 'ghost'
            : 'hidden';
        }
      }
      if (entity.fogState === state) continue;
      entity.setFogState?.(state);
    }
  }

  // ------------------------------------------------------------- отрисовка
  _buildTerrain() {
    const tex = new DynamicTexture('fogTexture', { width: SIZE, height: SIZE }, this.scene, true);
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    tex.updateSamplingMode(Texture.BILINEAR_SAMPLINGMODE);
    // Без этого флага материал рисует туман непрозрачным и накрывает всю карту.
    tex.hasAlpha = true;
    this.texture = tex;
    this.image = tex.getContext().createImageData(SIZE, SIZE);

    const mat = new StandardMaterial('fogMat', this.scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = Color3.Black();
    mat.emissiveColor = Color3.Black();
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;

    const size = MAP.half * 2;
    this.mesh = MeshBuilder.CreateGround('fog', { width: size, height: size }, this.scene);
    this.mesh.material = mat;
    // Чуть выше земли, чтобы не спорить с ней за глубину, но ниже юнитов:
    // юниты перекрывают туман, а не наоборот.
    this.mesh.position.y = 0.14;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { fog: true };
    // Полупрозрачная плоскость рисуется после непрозрачных объектов.
    this.mesh.renderingGroupId = 0;

    // Отдельное полотно для тактической карты: так туман поворачивается
    // вместе с ней и стоит один drawImage на кадр.
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = 512;
    this.minimapCanvas.height = 512;
    this.minimapCtx = this.minimapCanvas.getContext('2d');
  }

  drawTerrain() {
    const grid = this.grids.player;
    const data = this.image.data;
    for (let i = 0; i < grid.visible.length; i++) {
      const alpha = grid.visible[i]
        ? 0
        : grid.explored[i]
          ? ALPHA_EXPLORED
          : ALPHA_UNSEEN;
      const p = i * 4;
      data[p] = FOG_RGB[0];
      data[p + 1] = FOG_RGB[1];
      data[p + 2] = FOG_RGB[2];
      data[p + 3] = alpha;
    }
    const ctx = this.texture.getContext();
    ctx.putImageData(this.image, 0, 0);
    this.texture.update(false);

    // Тактическая карта: точка 0,0 полотна — левый верхний угол поля.
    const scale = (512 - 20) / (MAP.half * 2);
    const offset = 256 - MAP.half * scale;
    this.minimapCtx.clearRect(0, 0, 512, 512);
    this.minimapCtx.imageSmoothingEnabled = true;
    this.minimapCtx.drawImage(
      ctx.canvas,
      offset,
      offset,
      MAP.half * 2 * scale,
      MAP.half * 2 * scale,
    );
  }

  /**
   * Находит место, где ещё не ступала нога игрока — цель для разведки.
   * `penalty(x, z)` добавляет к расстоянию штраф в метрах: так ИИ обходит
   * клетки, к которым ведёт уже опасный маршрут.
   */
  nearestUnexplored(x, z, faction = 'player', penalty = null) {
    const grid = this.grids[faction];
    let best = null;
    let bestD = Infinity;
    for (let cz = 0; cz < SIZE; cz++) {
      for (let cx = 0; cx < SIZE; cx++) {
        if (grid.explored[cz * SIZE + cx]) continue;
        const wx = (cx + 0.5) * CELL - MAP.half;
        const wz = (cz + 0.5) * CELL - MAP.half;
        // Края поля интересны меньше: там только декор.
        if (Math.abs(wx) > MAP.half - 8 || Math.abs(wz) > MAP.half - 8) continue;
        const dx = wx - x;
        const dz = wz - z;
        const d = Math.sqrt(dx * dx + dz * dz) + (penalty ? penalty(wx, wz) : 0);
        if (d < bestD) {
          bestD = d;
          best = { x: wx, z: wz };
        }
      }
    }
    return best;
  }

  /** Доля исследованной карты — для статистики и подсказок. */
  exploredRatio(faction = 'player') {
    const grid = this.grids[faction];
    let n = 0;
    for (let i = 0; i < grid.explored.length; i++) n += grid.explored[i];
    return n / grid.explored.length;
  }
}
