// Точка входа: движок, сцена, камера и игровой цикл.

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Color4,
  GlowLayer,
} from './babylon.js';
import { START, CAMERA } from './config.js';
import { ModelFactory } from './models.js';
import { World } from './world.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Input } from './input.js';

function fatal(err) {
  console.error(err);
  const card = document.querySelector('#overlayCard');
  if (card) {
    card.innerHTML = `
      <div class="overlay-top">
        <div class="eyebrow"><i></i> СБОЙ СИСТЕМЫ</div>
        <h1>НЕТ СИГНАЛА</h1>
        <p class="tagline">Не удалось инициализировать 3D-движок. Проверьте, что браузер поддерживает WebGL2 и файлы игры загружены через локальный сервер.</p>
      </div>
      <div class="end-note">${String(err?.message ?? err)}</div>
      <div class="overlay-actions">
        <button class="btn-primary" onclick="location.reload()">ПЕРЕЗАГРУЗИТЬ</button>
      </div>`;
  }
}

function boot() {
  const canvas = document.querySelector('#scene');
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
    powerPreference: 'high-performance',
  }, false);
  engine.setHardwareScalingLevel(1);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.015, 0.03, 0.045, 1);
  scene.autoClear = true;
  scene.skipPointerMovePicking = true;
  scene.setRenderingAutoClearDepthStencil(1, true);
  scene.fogEnabled = true;

  const [hx, hz] = START.player.hq;
  const camera = new ArcRotateCamera(
    'camera',
    2.35,
    0.93,
    64,
    new Vector3(hx - 9, 0, hz + 8),
    scene,
  );
  camera.lowerRadiusLimit = CAMERA.minRadius;
  camera.upperRadiusLimit = CAMERA.maxRadius;
  camera.lowerBetaLimit = CAMERA.minBeta - 0.1;
  camera.upperBetaLimit = CAMERA.maxBeta + 0.1;
  camera.minZ = 0.4;
  camera.maxZ = 900;
  camera.fov = 0.78;
  camera.inertia = 0;
  camera.panningSensibility = 0;
  camera.wheelDeltaPercentage = 0;

  const glow = new GlowLayer('glow', scene, {
    blurKernelSize: 30,
    mainTextureFixedSize: 512,
    mainTextureRatio: 0.7,
  });
  glow.intensity = 0.42;

  const factory = new ModelFactory(scene);
  const world = new World(scene, factory);
  if (world.sky) glow.addExcludedMesh(world.sky);
  const fx = new Effects(scene);

  const game = new Game({ scene, camera, factory, world, fx });
  const ui = new UI(game);
  const input = new Input(game);

  // Разное упрощение: солнце следует за камерой, тени не считаются за картой.
  world.update(0, camera);

  const resize = () => engine.resize();
  window.addEventListener('resize', resize);

  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    if (game.started && !game.paused && !game.over) game.update(dt);
    input.update(dt);
    world.update(dt, camera);
    ui.tick(dt);
    scene.render();

    if (!window.__READY__) window.__READY__ = true;
  });

  // Отладочные инструменты доступны только с ?debug и не мешают обычной игре.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__GAME__ = { engine, scene, camera, game, ui, input, world, fx, factory };
    window.game = game;
    window.__advance = (seconds = 1) => {
      const wasPaused = game.paused;
      game.paused = false;
      const steps = Math.min(600, Math.round(seconds * 30));
      for (let i = 0; i < steps; i++) game.update(1 / 30);
      game.paused = wasPaused;
      ui.tick(1);
    };
    window.__spawn = (type, x, z, faction = 'player') => game.spawnUnit(faction, type, x, z);
    window.__build = (type, x, z) => game.tryBuild(type, x, z);
    window.__select = (predicate = 'player') => {
      if (predicate === 'hq') game.selectOnly(game.playerBuildings().filter((b) => b.type === 'hq'));
      else game.selectOnly(game.playerUnits());
    };
  }
}

try {
  boot();
} catch (err) {
  fatal(err);
}

