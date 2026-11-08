// Planar Mirror Reflection Renderer for the Monkemon Ocean
// Renders the scene from a camera mirrored about the water plane (y = planeY) into a half-resolution
// HalfFloat target using an oblique near-plane projection so nothing below the surface leaks in.
// Only objects on `REFLECTION_LAYER` are drawn (terrain, trees, houses, sky dome, clouds, characters)
// so grass tufts, flowers, particles and label sprites never double the draw-call cost.

import * as THREE from 'three';

export const REFLECTION_LAYER = 1;

const _normal = new THREE.Vector3(0, 1, 0);
const _planePoint = new THREE.Vector3();
const _camWorldPos = new THREE.Vector3();
const _view = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rotation = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clipPlane = new THREE.Vector4();
const _q = new THREE.Vector4();

export class PlanarReflection {
  constructor(renderer, { width = 1280, height = 800, scale = 0.5, clipBias = 0.0035 } = {}) {
    this.renderer = renderer;
    this.scale = scale;
    this.clipBias = clipBias;
    this.renderTarget = new THREE.WebGLRenderTarget(
      Math.max(2, Math.round(width * scale)),
      Math.max(2, Math.round(height * scale)),
      { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false },
    );
    this.renderTarget.texture.name = 'MonkeOceanReflection';
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.virtualCamera.layers.set(REFLECTION_LAYER);
    this.textureMatrix = new THREE.Matrix4();
    this.enabled = true;
  }

  setSize(width, height) {
    this.renderTarget.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }

  /**
   * Renders the mirrored scene. Returns false when the camera is below the plane (nothing to reflect).
   */
  render(scene, camera, planeY, hiddenObjects = []) {
    if (!this.enabled) return false;
    _planePoint.set(0, planeY, 0);
    _camWorldPos.setFromMatrixPosition(camera.matrixWorld);
    _view.subVectors(_planePoint, _camWorldPos);
    if (_view.dot(_normal) > 0) return false; // camera underneath the water

    _view.reflect(_normal).negate();
    _view.add(_planePoint);

    _rotation.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rotation).add(_camWorldPos);
    _target.subVectors(_planePoint, _lookAt);
    _target.reflect(_normal).negate();
    _target.add(_planePoint);

    const vc = this.virtualCamera;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rotation).reflect(_normal);
    vc.lookAt(_target);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);

    // Oblique near-plane clipping (Lengyel) so geometry below the water never shows in the mirror
    _plane.setFromNormalAndCoplanarPoint(_normal, _planePoint);
    _plane.applyMatrix4(vc.matrixWorldInverse);
    _clipPlane.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix;
    _q.x = (Math.sign(_clipPlane.x) + pm.elements[8]) / pm.elements[0];
    _q.y = (Math.sign(_clipPlane.y) + pm.elements[9]) / pm.elements[5];
    _q.z = -1.0;
    _q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    _clipPlane.multiplyScalar(2.0 / _clipPlane.dot(_q));
    pm.elements[2] = _clipPlane.x;
    pm.elements[6] = _clipPlane.y;
    pm.elements[10] = _clipPlane.z + 1.0 - this.clipBias;
    pm.elements[14] = _clipPlane.w;

    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevVisible = [];
    for (const obj of hiddenObjects) {
      if (obj) {
        prevVisible.push([obj, obj.visible]);
        obj.visible = false;
      }
    }
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.renderTarget);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, vc);
    renderer.xr.enabled = prevXr;
    renderer.setRenderTarget(prevTarget);
    for (const [obj, v] of prevVisible) obj.visible = v;
    return true;
  }

  dispose() {
    this.renderTarget.dispose();
  }
}

/** Marks an object subtree as visible to the mirror camera. */
export function markReflective(object) {
  if (!object) return object;
  object.traverse((o) => o.layers.enable(REFLECTION_LAYER));
  return object;
}
