// Проверка генератора симметричных карт: npm run verify:maps
//
// Скрипт не требует браузера: mapgen.js — чистый JavaScript и не импортирует
// Babylon.js. Проверяются детерминизм, симметрия всех объектов, корректность
// стартовых баз и разнообразие карт на большой выборке сидов.

import { createMap, formatSeed, normalizeSeed } from '../src/mapgen.js';

const fail = [];
const check = (condition, message) => {
  if (!condition) fail.push(message);
};

const key = (x, z) => `${(Math.round(x * 100) / 100 + 0).toFixed(2)},${(Math.round(z * 100) / 100 + 0).toFixed(2)}`;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const seeds = [];
for (let i = 0; i < 600; i++) seeds.push(i);
for (let i = 0; i < 400; i++) seeds.push((Math.random() * 0xffffffff) >>> 0);

const signatures = new Set();
const symmetryHits = new Map();
let totalOil = 0;
let totalRocks = 0;

for (const seed of seeds) {
  const map = createMap(seed);
  const again = createMap(seed);
  const label = `seed ${formatSeed(seed)}`;
  symmetryHits.set(map.symmetry.key, (symmetryHits.get(map.symmetry.key) ?? 0) + 1);
  check(map.signature === again.signature, `${label}: карта недетерминирована`);
  check(map.seed === normalizeSeed(seed), `${label}: потерян сид`);
  signatures.add(map.signature);

  const { symmetry } = map;
  const transform = (point) => {
    const [x, z] = symmetry.transform(point.x, point.z);
    return { x, z };
  };

  // --- месторождения
  const patchByKey = new Map();
  for (const patch of map.oilPatches) {
    const k = key(patch.x, patch.z);
    check(!patchByKey.has(k), `${label}: два месторождения в одной точке ${k}`);
    patchByKey.set(k, patch);
    check(Math.abs(patch.x) <= 60 && Math.abs(patch.z) <= 60, `${label}: месторождение за картой`);
  }
  totalOil += map.oilPatches.length;
  for (const patch of map.oilPatches) {
    const mirror = transform(patch);
    const twin = patchByKey.get(key(mirror.x, mirror.z));
    check(!!twin, `${label}: у месторождения ${patch.role} нет отражения`);
    if (twin) {
      check(twin.role === patch.role, `${label}: у отражения другой тип (${patch.role} / ${twin.role})`);
      if (patch.owner && patch.role === 'home') {
        const expected = patch.owner === 'player' ? 'enemy' : 'player';
        check(twin.owner === expected, `${label}: стартовые месторождения не зеркальны по владельцу`);
      } else {
        check(twin.owner === patch.owner, `${label}: нейтральные месторождения не зеркальны`);
      }
    }
  }
  check(map.oilPatches.length >= 6, `${label}: слишком мало месторождений (${map.oilPatches.length})`);

  // --- стартовые базы
  const { player, enemy } = map.spawn;
  const expectedEnemyHq = transform(player.hq);
  const expectedEnemyPower = transform(player.power);
  check(close(enemy.hq.x, expectedEnemyHq.x) && close(enemy.hq.z, expectedEnemyHq.z), `${label}: штаб врага не совпал с отражением`);
  check(close(enemy.power.x, expectedEnemyPower.x) && close(enemy.power.z, expectedEnemyPower.z), `${label}: электростанция врага не совпала с отражением`);
  check(Math.hypot(player.hq.x - enemy.hq.x, player.hq.z - enemy.hq.z) >= 60, `${label}: базы слишком близко`);
  for (const base of [player, enemy]) {
    check(Math.abs(base.hq.x) <= 56 && Math.abs(base.hq.z) <= 56, `${label}: штаб за пределами карты`);
    check(Math.abs(base.power.x) <= 56 && Math.abs(base.power.z) <= 56, `${label}: электростанция за пределами карты`);
    for (const marine of base.marines) {
      check(Math.abs(marine.x) <= 56 && Math.abs(marine.z) <= 56, `${label}: юнит за пределами карты`);
      check(Math.hypot(marine.x - base.hq.x, marine.z - base.hq.z) > 6, `${label}: юнит внутри штаба`);
    }
  }
  check(player.derricks.length === 1, `${label}: у игрока должна быть одна стартовая вышка`);
  check(enemy.derricks.length === 2, `${label}: у врага должны быть две стартовые вышки`);
  check(player.marines.length === 2, `${label}: у игрока должно быть два стартовых юнита`);
  check(enemy.marines.length === 3, `${label}: у врага должно быть три стартовых юнита`);
  check(!!enemy.barracks, `${label}: у врага нет казарм`);
  if (enemy.barracks) {
    const b = enemy.barracks;
    check(Math.abs(b.x) <= 56 && Math.abs(b.z) <= 56, `${label}: казармы за пределами карты`);
    check(Math.hypot(b.x - enemy.hq.x, b.z - enemy.hq.z) > 9, `${label}: казармы внутри штаба`);
    check(Math.hypot(b.x - enemy.power.x, b.z - enemy.power.z) > 8, `${label}: казармы внутри электростанции`);
    for (const patch of map.oilPatches) {
      check(Math.hypot(b.x - patch.x, b.z - patch.z) > 8, `${label}: казармы на месторождении`);
    }
  }
  for (const [faction, list] of [['player', player.derricks], ['enemy', enemy.derricks]]) {
    for (const derrick of list) {
      const patch = patchByKey.get(key(derrick.x, derrick.z));
      check(!!patch, `${label}: вышка ${faction} стоит не на месторождении`);
      if (patch) check(patch.owner === faction, `${label}: месторождение под вышкой ${faction} принадлежит ${patch.owner}`);
    }
  }
  const playerHome = player.derricks[0];
  const enemyHome = enemy.derricks[0];
  const mirroredHome = transform(playerHome);
  check(close(enemyHome.x, mirroredHome.x) && close(enemyHome.z, mirroredHome.z), `${label}: стартовые вышки не симметричны`);

  // --- декор
  const checkPairs = (list, labelPart, sameProps = []) => {
    const lookup = new Map();
    for (const item of list) lookup.set(key(item.x, item.z), item);
    for (const item of list) {
      const mirror = transform(item);
      const twin = lookup.get(key(mirror.x, mirror.z));
      check(!!twin, `${label}: у объекта ${labelPart} нет отражения`);
      if (!twin) continue;
      for (const prop of sameProps) {
        check(close(item[prop], twin[prop]), `${label}: у пары ${labelPart} различается ${prop}`);
      }
    }
  };
  const { rocks, crates, crystals, pebbles } = map.decor;
  check(rocks.length % 2 === 0, `${label}: непарное число камней`);
  check(map.decor.crates.length % 2 === 0, `${label}: непарное число ящиков`);
  check(map.decor.crystals.length % 2 === 0, `${label}: непарное число кристаллов`);
  check(map.decor.pebbles.length % 2 === 0, `${label}: непарное число камешков`);
  checkPairs(rocks, 'rock', ['source', 'scale', 'squash']);
  checkPairs(crates, 'crate', ['scale']);
  checkPairs(crystals, 'crystal', ['scaleX', 'scaleY', 'scaleZ']);
  checkPairs(pebbles, 'pebble', ['scale', 'stretchX', 'stretchZ']);
  totalRocks += rocks.length;

  // Пропсы отражённых камней должны быть зеркально повёрнуты.
  const rockLookup = new Map(rocks.map((r) => [key(r.x, r.z), r]));
  for (const rock of rocks) {
    const mirror = transform(rock);
    const twin = rockLookup.get(key(mirror.x, mirror.z));
    if (!twin) continue;
    check(angleDistance(twin.yaw, symmetry.mirrorYaw(rock.yaw)) < 1e-6, `${label}: камень повёрнут не зеркально`);
  }

  // --- геометрия
  check(rocks.length >= 16, `${label}: слишком мало камней (${rocks.length})`);
  for (const rock of rocks) {
    for (const base of [player, enemy]) {
      check(Math.hypot(rock.x - base.hq.x, rock.z - base.hq.z) > 12, `${label}: камень перекрывает базу`);
    }
  }
}

check(symmetryHits.size === 5, `использованы не все типы симметрии: ${[...symmetryHits.keys()].join(', ')}`);
check(signatures.size > seeds.length * 0.99, `карты недостаточно разнообразны: ${signatures.size} из ${seeds.length}`);

if (fail.length) {
  console.error(`\nПроверка карт провалена: ${fail.length} ошибок`);
  for (const message of fail.slice(0, 40)) console.error(`  ✗ ${message}`);
  if (fail.length > 40) console.error(`  … ещё ${fail.length - 40}`);
  process.exit(1);
}

const oilAverage = (totalOil / seeds.length).toFixed(1);
const rockAverage = (totalRocks / seeds.length).toFixed(1);
console.log(`Проверено карт: ${seeds.length}`);
console.log(`Уникальных компоновок: ${signatures.size}`);
console.log(`Симметрия: ${[...symmetryHits.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`);
console.log(`В среднем на карту: месторождений ${oilAverage}, камней ${rockAverage}`);
console.log('Все проверки пройдены.');
