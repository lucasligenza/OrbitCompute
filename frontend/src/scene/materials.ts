import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/**
 * Screen-space fat line (Line2) whose alpha fades with |t_segment − now|: bright trail behind the
 * spacecraft, dim path ahead. Requires per-instance attributes `instanceTStart`/`instanceTEnd`
 * (seconds) on the LineGeometry. Patched into three's LineMaterial shader.
 */
export function timeFadeFatLine(color: string, widthPx: number, pastS: number, futureS: number, futureAlpha = 0.3) {
  const uniforms = {
    uNow: { value: 0 },
    uPast: { value: pastS },
    uFuture: { value: futureS },
    uFutureAlpha: { value: futureAlpha },
  };
  const m = new LineMaterial({
    color: new THREE.Color(color).getHex(),
    linewidth: widthPx,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    worldUnits: false,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      "attribute float instanceTStart;\nattribute float instanceTEnd;\nvarying float vT;\nvoid main() {\n  vT = ( position.y < 0.5 ) ? instanceTStart : instanceTEnd;",
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        "uniform float uNow; uniform float uPast; uniform float uFuture; uniform float uFutureAlpha;\nvarying float vT;\nvoid main() {",
      )
      .replace(
        "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
        `float d = vT - uNow;
         float fade = d < 0.0 ? (1.0 + d / uPast) : (1.0 - d / uFuture) * uFutureAlpha;
         fade = clamp(fade, 0.0, 1.0);
         fade = fade * fade * (3.0 - 2.0 * fade);
         if (fade < 0.003) discard;
         gl_FragColor = vec4( diffuseColor.rgb, alpha * fade );`,
      );
  };
  m.customProgramCacheKey = () => "timeFadeFatLine";
  return { material: m, uniforms };
}
