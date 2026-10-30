// Babylon.js подключается как UMD-бандл в index.html и доступен глобально.
// Здесь собираем нужные классы в одном месте.

const B = globalThis.BABYLON;
if (!B) {
  throw new Error('Babylon.js не загружен. Проверьте vendor/babylon.js в index.html.');
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
