import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildMannequin } from "../src/mannequin.js";
import { buildProps } from "../src/props.js";
import { groundFigure } from "../src/groundlock.js";
import { resolvePropContacts, propContactExemptions } from "../src/propcontact.js";

const DEG = Math.PI / 180;
const WALL_FACE_Z = -0.29;
const BOX_FACE_Z = 0.11;

function torsoBackZ(m: ReturnType<typeof buildMannequin>): number {
  const pelvis = m.bones.get("pelvis")!.getWorldPosition(new THREE.Vector3());
  return pelvis.z - m.collision.torso;
}

describe("solid prop contact", () => {
  it("pushes a wall-sit body out of the wall until the back rests on its surface", () => {
    const m = buildMannequin();
    const { colliders } = buildProps(["wall"]);
    // The wall-sit deep pose: feet planted, hips/knees at 90 carry the pelvis
    // ~0.45m backward — historically straight through the wall slab.
    for (const side of ["left", "right"]) {
      m.bones.get(`hip_${side}`)!.rotation.set(-90 * DEG, 0, 0);
      m.bones.get(`knee_${side}`)!.rotation.set(90 * DEG, 0, 0);
    }
    m.root.updateMatrixWorld(true);
    groundFigure(m);
    m.root.position.z -= 0.45; // where ground-locked feet leave the pelvis
    m.root.updateMatrixWorld(true);
    expect(torsoBackZ(m)).toBeLessThan(WALL_FACE_Z - 0.1); // sanity: through the wall

    resolvePropContacts(m, colliders);
    // The back now rests ON the wall plane (small tolerance), not inside it.
    expect(torsoBackZ(m)).toBeGreaterThan(WALL_FACE_Z - 1e-3);
    expect(torsoBackZ(m)).toBeLessThan(WALL_FACE_Z + 0.02);
  });

  it("leaves a clear standing pose untouched", () => {
    const m = buildMannequin();
    const { colliders } = buildProps(["wall", "box"]);
    groundFigure(m);
    const before = m.root.position.clone();
    resolvePropContacts(m, colliders);
    expect(m.root.position.distanceTo(before)).toBeLessThan(1e-6);
  });

  it("steps a standing figure's calves clear of the chair's seat edge", () => {
    const m = buildMannequin();
    const { colliders } = buildProps(["chair"]);
    groundFigure(m);
    // Standing at the origin, the default chair placement overlaps the calves
    // with the seat slab; the body steps forward until they clear it.
    resolvePropContacts(m, colliders);
    const ankle = m.bones.get("ankle_left")!.getWorldPosition(new THREE.Vector3());
    expect(ankle.z - m.collision.shin).toBeGreaterThan(0.05 - 1e-3); // seat front edge
  });

  it("bends a swinging shin clear of the box edge without moving the root", () => {
    const m = buildMannequin();
    const { colliders } = buildProps(["box"]);
    groundFigure(m);
    // Swing the right leg forward so the shin sweeps into the box's near face.
    m.bones.get("hip_right")!.rotation.set(-40 * DEG, 0, 0);
    m.bones.get("knee_right")!.rotation.set(30 * DEG, 0, 0);
    m.root.updateMatrixWorld(true);
    const ankleZ = () => m.bones.get("ankle_right")!.getWorldPosition(new THREE.Vector3()).z;
    expect(ankleZ() + m.collision.shin).toBeGreaterThan(BOX_FACE_Z); // sanity: into the face
    const rootBefore = m.root.position.clone();

    resolvePropContacts(m, colliders);
    expect(m.root.position.distanceTo(rootBefore)).toBeLessThan(1e-6); // limb-resolved
    // The shin pulled back toward the face instead of sweeping through it.
    expect(ankleZ() + m.collision.shin).toBeLessThan(BOX_FACE_Z + 0.02);
  });

  it("exempts a leg pinned to a prop anchor from limb clearing", () => {
    const m = buildMannequin();
    const { colliders } = buildProps(["box"]);
    groundFigure(m);
    m.bones.get("hip_right")!.rotation.set(-40 * DEG, 0, 0);
    m.bones.get("knee_right")!.rotation.set(30 * DEG, 0, 0);
    m.root.updateMatrixWorld(true);
    const before = m.bones.get("ankle_right")!.getWorldPosition(new THREE.Vector3());

    const exempt = propContactExemptions([{ effector: "foot_right", anchor: "box" }]);
    resolvePropContacts(m, colliders, exempt);
    const after = m.bones.get("ankle_right")!.getWorldPosition(new THREE.Vector3());
    expect(after.distanceTo(before)).toBeLessThan(1e-6);
  });

  it("maps effector spellings and floor anchors correctly in propContactExemptions", () => {
    const e = propContactExemptions([
      { effector: "feet", anchor: "box" },
      { effector: "hand_left", anchor: "bar" },
      { effector: "foot_right", anchor: "floor" }, // floor: not a prop contact
    ]);
    expect([...e.legs].sort()).toEqual(["left", "right"]);
    expect([...e.arms]).toEqual(["left"]);
  });
});
