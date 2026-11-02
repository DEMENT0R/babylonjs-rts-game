// Навигационная сетка и поиск пути A*.
//
// Модуль намеренно не зависит от Babylon.js: его можно проверять в Node и
// переиспользовать в генераторе карт. Карта разбивается на квадратные ячейки,
// препятствия помечают ячейки непроходимыми, а юниты получают сглаженный путь
// из центра стартовой ячейки к цели.

import { MAP } from './config.js';

const SQRT2 = Math.SQRT2;

/** Расстояние от точки до отрезка и самая близкая точка на нём. */
export function segmentDistance(px, pz, seg) {
  const dx = seg.x2 - seg.x1;
  const dz = seg.z2 - seg.z1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) {
    return {
      distance: Math.hypot(px - seg.x1, pz - seg.z1),
      x: seg.x1,
      z: seg.z1,
    };
  }
  let t = ((px - seg.x1) * dx + (pz - seg.z1) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = seg.x1 + dx * t;
  const z = seg.z1 + dz * t;
  return { distance: Math.hypot(px - x, pz - z), x, z };
}

class MinHeap {
  constructor() {
    this.items = [];
    this.priorities = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, priority) {
    let i = this.items.length;
    this.items.push(item);
    this.priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.items[i] = this.items[parent];
      this.priorities[i] = this.priorities[parent];
      i = parent;
    }
    this.items[i] = item;
    this.priorities[i] = priority;
  }

  pop() {
    const top = this.items[0];
    const lastItem = this.items.pop();
    const lastPriority = this.priorities.pop();
    if (this.items.length) {
      let i = 0;
      const n = this.items.length;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        let smallestPriority = lastPriority;
        if (left < n && this.priorities[left] < smallestPriority) {
          smallest = left;
          smallestPriority = this.priorities[left];
        }
        if (right < n && this.priorities[right] < smallestPriority) {
          smallest = right;
          smallestPriority = this.priorities[right];
        }
        if (smallest === i) break;
        this.items[i] = this.items[smallest];
        this.priorities[i] = this.priorities[smallest];
        i = smallest;
      }
      this.items[i] = lastItem;
      this.priorities[i] = lastPriority;
    }
    return top;
  }
}

export class NavGrid {
  /**
   * @param {object} options
   * @param {number} options.half половина игрового поля
   * @param {number} options.cell размер ячейки
   * @param {number} options.margin запас вокруг препятствий
   */
  constructor({ half = MAP.half, cell = 2, margin = 1.0 } = {}) {
    this.half = half;
    this.cell = cell;
    this.margin = margin;
    this.cols = Math.ceil((half * 2) / cell);
    this.blocked = new Uint8Array(this.cols * this.cols);
    this.circles = [];
    this.segments = [];
    this.version = 0;
  }

  get length() {
    return this.cols * this.cols;
  }

  setBlockers(circles = [], segments = []) {
    this.circles = circles.filter((c) => c && c.radius > 0);
    this.segments = segments.filter((s) => s && s.radius > 0);
    this.rebuild();
  }

  rebuild() {
    this.blocked.fill(0);
    const { cols, cell, half, margin } = this;
    const maxIndex = cols - 1;

    const markCircle = (circle) => {
      const r = circle.radius + margin;
      const minX = Math.max(0, Math.floor((circle.x - r + half) / cell));
      const maxX = Math.min(maxIndex, Math.floor((circle.x + r + half) / cell));
      const minZ = Math.max(0, Math.floor((circle.z - r + half) / cell));
      const maxZ = Math.min(maxIndex, Math.floor((circle.z + r + half) / cell));
      const r2 = r * r;
      for (let iz = minZ; iz <= maxZ; iz++) {
        const cz = -half + (iz + 0.5) * cell;
        for (let ix = minX; ix <= maxX; ix++) {
          const cx = -half + (ix + 0.5) * cell;
          const dx = cx - circle.x;
          const dz = cz - circle.z;
          if (dx * dx + dz * dz <= r2) this.blocked[iz * cols + ix] = 1;
        }
      }
    };

    const markSegment = (segment) => {
      const r = segment.radius + margin;
      const minX = Math.max(0, Math.floor((Math.min(segment.x1, segment.x2) - r + half) / cell));
      const maxX = Math.min(maxIndex, Math.floor((Math.max(segment.x1, segment.x2) + r + half) / cell));
      const minZ = Math.max(0, Math.floor((Math.min(segment.z1, segment.z2) - r + half) / cell));
      const maxZ = Math.min(maxIndex, Math.floor((Math.max(segment.z1, segment.z2) + r + half) / cell));
      for (let iz = minZ; iz <= maxZ; iz++) {
        const cz = -half + (iz + 0.5) * cell;
        for (let ix = minX; ix <= maxX; ix++) {
          const cx = -half + (ix + 0.5) * cell;
          if (segmentDistance(cx, cz, segment).distance <= r) this.blocked[iz * cols + ix] = 1;
        }
      }
    };

    for (const circle of this.circles) markCircle(circle);
    for (const segment of this.segments) markSegment(segment);
    this.version++;
  }

  inBounds(ix, iz) {
    return ix >= 0 && iz >= 0 && ix < this.cols && iz < this.cols;
  }

  isBlocked(ix, iz) {
    return !this.inBounds(ix, iz) || this.blocked[iz * this.cols + ix] === 1;
  }

  cellCenter(ix, iz) {
    return {
      x: -this.half + (ix + 0.5) * this.cell,
      z: -this.half + (iz + 0.5) * this.cell,
    };
  }

  worldToCell(x, z) {
    return {
      ix: Math.max(0, Math.min(this.cols - 1, Math.floor((x + this.half) / this.cell))),
      iz: Math.max(0, Math.min(this.cols - 1, Math.floor((z + this.half) / this.cell))),
    };
  }

  /** Ближайшая свободная ячейка: спираль вокруг исходной. */
  nearestFree(ix, iz, maxRing = 16) {
    if (!this.isBlocked(ix, iz)) return { ix, iz };
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (!this.isBlocked(nx, nz)) return { ix: nx, iz: nz };
        }
      }
    }
    return null;
  }

  /** Точка внутри препятствия или за границей поля. */
  pointBlocked(x, z, clearance = this.margin) {
    if (Math.abs(x) > this.half || Math.abs(z) > this.half) return true;
    for (const circle of this.circles) {
      const r = circle.radius + clearance;
      const dx = x - circle.x;
      const dz = z - circle.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    for (const segment of this.segments) {
      if (segmentDistance(x, z, segment).distance < segment.radius + clearance) return true;
    }
    return false;
  }

  /** Свободен ли прямой отрезок: используется для сглаживания пути. */
  isDirectClear(ax, az, bx, bz, clearance = this.margin) {
    const distance = Math.hypot(bx - ax, bz - az);
    if (distance < 1e-4) return !this.pointBlocked(ax, az, clearance);
    const steps = Math.max(1, Math.ceil(distance / (this.cell * 0.45)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (this.pointBlocked(ax + (bx - ax) * t, az + (bz - az) * t, clearance)) return false;
    }
    return true;
  }

  /**
   * Путь от точки до точки. Возвращает массив точек (без стартовой) или [].
   * Если цель занята зданием, путь ведёт к ближайшей свободной ячейке.
   */
  findPath(sx, sz, tx, tz, clearance = this.margin) {
    const start = this.nearestFree(
      this.worldToCell(sx, sz).ix,
      this.worldToCell(sx, sz).iz,
    );
    if (!start) return [];
    if (this.isDirectClear(sx, sz, tx, tz, clearance)) return [{ x: tx, z: tz }];

    const goalCell = this.worldToCell(tx, tz);
    const goalFree = this.nearestFree(goalCell.ix, goalCell.iz);
    if (!goalFree) return [];
    const goalIndex = goalFree.iz * this.cols + goalFree.ix;
    const startIndex = start.iz * this.cols + start.ix;

    const total = this.length;
    const gScore = new Float32Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const open = new MinHeap();
    const heuristic = (index) => {
      const ix = index % this.cols;
      const iz = Math.floor(index / this.cols);
      const dx = Math.abs(ix - goalFree.ix);
      const dz = Math.abs(iz - goalFree.iz);
      return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
    };

    gScore[startIndex] = 0;
    open.push(startIndex, heuristic(startIndex));
    let found = false;
    let guard = 0;

    while (open.size && guard++ < total * 2) {
      const current = open.pop();
      if (current === goalIndex) {
        found = true;
        break;
      }
      if (closed[current]) continue;
      closed[current] = 1;
      const ix = current % this.cols;
      const iz = Math.floor(current / this.cols);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = ix + dx;
          const nz = iz + dz;
          if (this.isBlocked(nx, nz)) continue;
          // Диагональ разрешена только когда оба соседних ортогональных прохода свободны.
          if (dx && dz && (this.isBlocked(ix + dx, iz) || this.isBlocked(ix, iz + dz))) continue;
          const next = nz * this.cols + nx;
          if (closed[next]) continue;
          const step = dx && dz ? SQRT2 : 1;
          const tentative = gScore[current] + step;
          if (tentative >= gScore[next]) continue;
          gScore[next] = tentative;
          cameFrom[next] = current;
          open.push(next, tentative + heuristic(next));
        }
      }
    }

    if (!found) return [];

    const cells = [];
    let current = goalIndex;
    while (current !== -1 && current !== startIndex) {
      cells.push(current);
      current = cameFrom[current];
    }
    cells.reverse();

    const raw = [{ x: sx, z: sz }];
    for (const index of cells) {
      const ix = index % this.cols;
      const iz = Math.floor(index / this.cols);
      const point = this.cellCenter(ix, iz);
      raw.push(point);
    }
    const goalBlocked = this.pointBlocked(tx, tz, clearance);
    if (!goalBlocked) raw.push({ x: tx, z: tz });

    // Стягиваем путь: из текущей точки ищем самый дальний видимый узел.
    const smoothed = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !this.isDirectClear(raw[i].x, raw[i].z, raw[j].x, raw[j].z, clearance)) j--;
      smoothed.push(raw[j]);
      i = j;
    }
    return smoothed.slice(1);
  }
}
