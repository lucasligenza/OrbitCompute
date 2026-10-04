import * as THREE from "three";

/** Line whose opacity fades with |t_vertex - now|: bright trail behind, dim path ahead. */
export function timeFadeLineMaterial(color: string, pastS: number, futureS: number, futureAlpha = 0.35) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uNow: { value: 0 },
      uPast: { value: pastS },
      uFuture: { value: futureS },
      uFutureAlpha: { value: futureAlpha },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aTime;
      uniform float uNow; uniform float uPast; uniform float uFuture; uniform float uFutureAlpha;
      varying float vAlpha;
      void main() {
        float d = aTime - uNow;
        float a = d < 0.0 ? (1.0 + d / uPast) * 0.95 : (1.0 - d / uFuture) * uFutureAlpha;
        vAlpha = clamp(a, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
      void main() { if (vAlpha <= 0.002) discard; gl_FragColor = vec4(uColor, vAlpha * uOpacity); }`,
  });
}

/** Two-point link line with animated dashes flowing from start (a=0) to end (a=1). */
export function flowLineMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uLen: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.85 },
    },
    vertexShader: /* glsl */ `
      attribute float aT; varying float vT;
      void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uLen; uniform vec3 uColor; uniform float uOpacity; varying float vT;
      void main() {
        float s = vT * uLen - uTime * 2.5;
        float dash = step(0.45, fract(s / 0.6));
        float a = mix(0.25, 1.0, dash) * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }`,
  });
}
