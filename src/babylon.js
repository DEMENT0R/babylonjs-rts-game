// Babylon.js подключается как UMD-бандл в index.html и доступен глобально.
// Здесь собираем нужные классы в одном месте.

import { t } from './i18n/index.js';

const B = globalThis.BABYLON;
if (!B) {
  throw new Error(t('fatal.babylon'));
}

export { B };
export const {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Quaternion,
  Color3,
  Color4,
  Matrix,
  Ray,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Mesh,
  LinesMesh,
  HemisphericLight,
  DirectionalLight,
  PointLight,
  ShadowGenerator,
  GlowLayer,
  ParticleSystem,
  Texture,
  DynamicTexture,
  ShaderMaterial,
  Tools,
} = B;
