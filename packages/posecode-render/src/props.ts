/**
 * Scene props: objects the figure sits on, leans against, or grips.
 *
 * A prop is a simple low-poly mesh at a fixed default transform plus named
 * **anchors**: world-space contact points the movement can reference from a
 * `reach:` line (e.g. `reach: hand_left bar`). Props are NOT parented to the
 * mannequin: they live in the world and the figure moves to meet them.
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
  /** Props rigidly attached to a driver bone (weapon/tool sockets). */
  attachments: PropAttachment[];
}

export interface PropAttachment {
  object: THREE.Object3D;
  bone: string;
  offset: THREE.Vector3;
  rotation: THREE.Quaternion;
}

/** Build the declared props (`chair | wall | bar | box | dip-bars`). Unknown types are ignored. */
export function buildProps(types: string[], material?: THREE.Material): PropScene {
  const group = new THREE.Group();
  group.name = "posecode-props";
  const anchors = new Map<string, THREE.Vector3>();
  const attachments: PropAttachment[] = [];
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
      // Above standing reach, so a pinned grip genuinely hangs the body below it.
      const barH = 2.3;
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 1.2, 12),
        mat,
      );
      bar.rotation.z = Math.PI / 2; // horizontal, along X
      bar.position.set(0, barH, 0);
      group.add(bar);
      // Posts down to the floor so the bar reads as a pull-up frame.
      for (const x of [-0.55, 0.55]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, barH, 10), mat);
        post.position.set(x, barH / 2, 0);
        group.add(post);
      }
      // The wrist joint belongs slightly below and in front of the cylinder;
      // placing the joint at the bar centre made the fingers close as a fist
      // above the rail instead of wrapping around it.
      const gripY = barH - 0.045;
      const gripZ = 0.025;
      const gripHalfSpan = 0.24;
      anchors.set("bar", new THREE.Vector3(0, gripY, gripZ));
      anchors.set("bar.left", new THREE.Vector3(gripHalfSpan, gripY, gripZ));
      anchors.set("bar.right", new THREE.Vector3(-gripHalfSpan, gripY, gripZ));
    } else if (type === "wall") {
      const wall = box(2.2, 2.6, 0.1, mat);
      wall.position.set(0, 1.3, -0.34);
      group.add(wall);
      anchors.set("wall", new THREE.Vector3(0, 0.9, -0.29));
    } else if (type === "dip-bars") {
      // Parallel dip bars either side of the figure, rails running along Z.
      // Rail height is set so a straight-arm support holds the feet clear of
      // the floor. The single `bars` grip anchor sits at the midpoint between
      // the rails at grip height: pins translate the BODY so the average hand
      // position meets the anchor, which leaves each authored hand over its
      // own rail.
      const railH = 1.1;
      const halfSpan = 0.22;
      for (const x of [-halfSpan, halfSpan]) {
        const rail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.022, 0.022, 0.9, 12),
          mat,
        );
        rail.rotation.x = Math.PI / 2; // horizontal, along Z
        rail.position.set(x, railH, 0);
        group.add(rail);
        for (const z of [-0.35, 0.35]) {
          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.026, 0.026, railH, 10),
            mat,
          );
          post.position.set(x, railH / 2, z);
          group.add(post);
        }
      }
      anchors.set("bars", new THREE.Vector3(0, railH, 0));
      anchors.set("bars.left", new THREE.Vector3(halfSpan, railH, 0));
      anchors.set("bars.right", new THREE.Vector3(-halfSpan, railH, 0));
    } else if (type === "box") {
      // A low step/plateau placed IN FRONT of the figure (+Z): the lead foot
      // steps forward and up onto it. Top surface at ~0.30 m; `box` anchor sits
      // on top where the foot lands.
      const topH = 0.3;
      const plat = box(0.5, topH, 0.42, mat);
      plat.position.set(0, topH / 2, 0.32);
      group.add(plat);
      anchors.set("box", new THREE.Vector3(0, topH, 0.3));
    } else if (type === "sword") {
      const weapon = new THREE.Group();
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 10), mat);
      const guard = box(0.16, 0.025, 0.035, mat);
      guard.position.y = -0.09;
      const blade = box(0.045, 0.72, 0.012, mat);
      blade.position.y = -0.46;
      weapon.add(grip, guard, blade);
      group.add(weapon);
      attachments.push({
        object: weapon,
        bone: "wrist_right",
        offset: new THREE.Vector3(0, -0.075, 0),
        rotation: new THREE.Quaternion(),
      });
    } else if (type === "gun") {
      const weapon = new THREE.Group();
      const body = box(0.055, 0.09, 0.28, mat);
      body.position.z = 0.12;
      const handle = box(0.05, 0.16, 0.07, mat);
      handle.position.set(0, -0.1, 0.02);
      weapon.add(body, handle);
      group.add(weapon);
      attachments.push({
        object: weapon,
        bone: "wrist_right",
        offset: new THREE.Vector3(0, -0.035, 0.04),
        rotation: new THREE.Quaternion(),
      });
    }
  }

  return { group, anchors, attachments };
}

/** Follow final solved driver-bone transforms with held props. */
export function syncPropAttachments(scene: PropScene, bones: Map<string, THREE.Object3D>): void {
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (const attachment of scene.attachments) {
    const bone = bones.get(attachment.bone);
    if (!bone) continue;
    bone.getWorldPosition(p);
    bone.getWorldQuaternion(q);
    attachment.object.position.copy(attachment.offset).applyQuaternion(q).add(p);
    attachment.object.quaternion.copy(q).multiply(attachment.rotation);
  }
  scene.group.updateMatrixWorld(true);
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function leg(mat: THREE.Material, x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat);
  m.position.set(x, 0.25, z);
  return m;
}
