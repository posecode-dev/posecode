/**
 * Scene props — objects the figure sits on, leans against, or grips.
 *
 * A prop is a simple low-poly mesh at a fixed default transform plus named
 * **anchors**: world-space contact points the movement can reference from a
 * `reach:` line (e.g. `reach: hand_left bar`). Props are NOT parented to the
 * mannequin — they live in the world and the figure moves to meet them.
 *
 * Default placement is chosen so each prop sits where its movements need it and
 * distinct props don't collide: the chair is just behind the figure, the wall
 * behind that, the pull-up bar overhead.
 */

import * as THREE from "three";

export interface PropScene {
  /** All prop meshes; add this to the scene. */
  group: THREE.Group;
  /** Anchor name → world-space contact point, merged into reach/ground-lock. */
  anchors: Map<string, THREE.Vector3>;
}

/** Build the declared props (`chair | wall | bar`). Unknown types are ignored. */
export function buildProps(types: string[], material?: THREE.Material): PropScene {
  const group = new THREE.Group();
  group.name = "movit-props";
  const anchors = new Map<string, THREE.Vector3>();
  const mat =
    material ??
    new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.8, metalness: 0.05 });

  for (const type of types) {
    if (type === "chair") {
      const seatH = 0.5;
      const seat = box(0.42, 0.06, 0.42, mat);
      seat.position.set(0, seatH, -0.16);
      const back = box(0.42, 0.5, 0.06, mat);
      back.position.set(0, seatH + 0.28, -0.34);
      group.add(seat, back, leg(mat, 0.18, -0.0), leg(mat, -0.18, -0.0), leg(mat, 0.18, -0.32), leg(mat, -0.18, -0.32));
      anchors.set("seat", new THREE.Vector3(0, seatH + 0.03, -0.12));
    } else if (type === "bar") {
      const barH = 1.95;
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 1.2, 12),
        mat,
      );
      bar.rotation.z = Math.PI / 2; // horizontal, along X
      bar.position.set(0, barH, 0);
      group.add(bar);
      anchors.set("bar", new THREE.Vector3(0, barH, 0));
    } else if (type === "wall") {
      const wall = box(2.2, 2.6, 0.1, mat);
      wall.position.set(0, 1.3, -0.34);
      group.add(wall);
      anchors.set("wall", new THREE.Vector3(0, 0.9, -0.29));
    }
  }

  return { group, anchors };
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function leg(mat: THREE.Material, x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat);
  m.position.set(x, 0.25, z);
  return m;
}
