"use client";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { useUi } from "@/state/ui";

/** Post-processing (High quality only). Only emissive / toneMapped=false elements exceed the
 * bloom threshold: the Sun, link beams, status lights, active stations, hot radiators. */
export default function Effects() {
  const quality = useUi((s) => s.quality);
  if (quality !== "high") return null;
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.85} luminanceSmoothing={0.2} radius={0.7} />
      <Vignette eskil={false} offset={0.25} darkness={0.55} />
    </EffectComposer>
  );
}
