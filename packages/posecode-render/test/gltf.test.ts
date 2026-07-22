import { describe, expect, it, beforeAll } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { parse } from "posecode-parser";
import { exportGLTF, buildAnimatedRig } from "../src/gltf.js";

// GLTFExporter serializes buffers via FileReader, which browsers provide but
// Node does not. Polyfill it faithfully over Node's global Blob so the headless
// round-trip mirrors the browser export the playground actually runs.
beforeAll(() => {
  if (typeof (globalThis as { FileReader?: unknown }).FileReader !== "undefined") return;
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    readAsArrayBuffer(blob: Blob): void {
      blob.arrayBuffer().then(
        (buf) => {
          this.result = buf;
          this.onloadend?.();
        },
        (err) => this.onerror?.(err),
      );
    }
    readAsDataURL(blob: Blob): void {
      blob.arrayBuffer().then(
        (buf) => {
          const b64 = Buffer.from(buf).toString("base64");
          this.result = `data:${blob.type || "application/octet-stream"};base64,${b64}`;
          this.onloadend?.();
        },
        (err) => this.onerror?.(err),
      );
    }
  }
  (globalThis as { FileReader?: unknown }).FileReader = NodeFileReader;
});

const BICEPS = `posecode exercise "Biceps curl"
  rig humanoid
  pose start = standing

  step "Curl" 1.1s settle:
    elbows: flex 135
  step "Lower" 1.4s settle:
    elbows: flex 15
  repeat 2
`;

function loadGlb(buffer: ArrayBuffer): Promise<THREE.Object3D & { animations: THREE.AnimationClip[] }> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      "",
      (gltf) => resolve(Object.assign(gltf.scene, { animations: gltf.animations })),
      reject,
    );
  });
}

describe("exportGLTF", () => {
  it("builds a rig plus a baked clip with the expected tracks", () => {
    const { ir } = parse(BICEPS);
    expect(ir).toBeTruthy();
    const { root, clip } = buildAnimatedRig(ir!, { fps: 30 });

    expect(root.name).toBe("posecode_root");
    // Root gets a position + quaternion track; each joint gets a quaternion track.
    expect(clip.tracks.some((t) => t.name === "posecode_root.position")).toBe(true);
    expect(clip.tracks.some((t) => t.name === "elbow_left.quaternion")).toBe(true);
    expect(clip.duration).toBeGreaterThan(0);
    // The elbow actually moves: some frame differs from the first keyframe.
    const elbow = clip.tracks.find((t) => t.name === "elbow_left.quaternion")!;
    const vals = elbow.values;
    const frames = vals.length / 4;
    let moved = false;
    for (let i = 1; i < frames && !moved; i++) {
      for (let k = 0; k < 4; k++) {
        if (Math.abs(vals[i * 4 + k]! - vals[k]!) > 1e-3) moved = true;
      }
    }
    expect(moved).toBe(true);
  });

  it("exports a GLB that reloads through GLTFLoader with its animation", async () => {
    const { ir } = parse(BICEPS);
    const glb = await exportGLTF(ir!, { fps: 24, binary: true });
    expect(glb).toBeInstanceOf(ArrayBuffer);

    const scene = await loadGlb(glb as ArrayBuffer);
    // The rig survived the round-trip.
    expect(scene.getObjectByName("elbow_left")).toBeTruthy();
    // Exactly one baked animation clip, and it drives the elbow joint.
    expect(scene.animations).toHaveLength(1);
    const clip = scene.animations[0]!;
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.tracks.some((t) => /elbow_left\.quaternion$/.test(t.name))).toBe(true);

    // The clip can be bound to a mixer and advanced without error (plays).
    const mixer = new THREE.AnimationMixer(scene);
    const action = mixer.clipAction(clip);
    action.play();
    expect(() => mixer.update(0.5)).not.toThrow();
  });

  it("can emit a glTF JSON object instead of GLB", async () => {
    const { ir } = parse(BICEPS);
    const gltf = (await exportGLTF(ir!, { binary: false })) as Record<string, unknown>;
    expect(gltf).toMatchObject({ asset: expect.anything() });
    expect(Array.isArray(gltf.animations)).toBe(true);
    expect((gltf.animations as unknown[]).length).toBe(1);
  });
});
