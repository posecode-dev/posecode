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

/** Body parts a prop face can block (sampled as capsules by the contact pass). */
export type BlockedPart = "torso" | "head" | "thigh" | "shin" | "arm";

/**
 * A solid, one-sided face of a prop: a bounded plane the body may not cross.
 * Solidity is per-face rather than per-volume because contact intent differs
 * by surface: a chair's backrest blocks the torso, but its seat TOP is a
 * support the thighs rest on (owned by pins/reaches), so only the surfaces
 * that should push back are declared.
 */
export interface FaceCollider {
  /** A point on the face (its centre), world space. */
  point: THREE.Vector3;
  /** Outward unit normal: the side of the face the body must stay on. */
  normal: THREE.Vector3;
  /** Unit tangents spanning the face, with the patch half-extent along each. */
  tangentU: THREE.Vector3;
  halfU: number;
  tangentV: THREE.Vector3;
  halfV: number;
  /**
   * How far BEHIND the face a sample is still owned by it (metres). Must
   * exceed the prop's thickness so a body that fully passed through (the
   * wall-sit pelvis) is recaptured and pushed back out the declared side.
   */
  captureDepth: number;
  /** Which body parts this face blocks. */
  blocks: readonly BlockedPart[];
  /**
   * How penetration is resolved: `"body"` translates the whole figure along
   * the normal (you step away from a wall); `"limb"` bends the offending
   * limb's proximal joint (you lift your leg over a box edge).
   */
  resolve: "body" | "limb";
}

export interface PropScene {
  /** All prop meshes; add this to the scene. */
  group: THREE.Group;
  /** Anchor name → world-space contact point, merged into reach/ground-lock. */
  anchors: Map<string, THREE.Vector3>;
  /** Solid faces the body cannot pass through (see resolvePropContacts). */
  colliders: FaceCollider[];
}

/** Build the declared props (`chair | wall | bar | box | dip-bars`). Unknown types are ignored. */
export function buildProps(types: string[], material?: THREE.Material): PropScene {
  const group = new THREE.Group();
  group.name = "posecode-props";
  const anchors = new Map<string, THREE.Vector3>();
  const colliders: FaceCollider[] = [];
  // All built-in props are axis-aligned, so faces are declared by their axis.
  const face = (
    cx: number, cy: number, cz: number,
    normal: [number, number, number],
    tangentU: [number, number, number], halfU: number,
    tangentV: [number, number, number], halfV: number,
    captureDepth: number,
    blocks: readonly BlockedPart[],
    resolve: "body" | "limb",
  ): FaceCollider => ({
    point: new THREE.Vector3(cx, cy, cz),
    normal: new THREE.Vector3(...normal),
    tangentU: new THREE.Vector3(...tangentU),
    halfU,
    tangentV: new THREE.Vector3(...tangentV),
    halfV,
    captureDepth,
    blocks,
    resolve,
  });
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
      // Backrest front face: sitting back is stopped by the backrest instead
      // of the torso sinking through it (sit-to-stand, box-squat).
      colliders.push(
        face(0, seatH + 0.28, -0.31, [0, 0, 1], [1, 0, 0], 0.21, [0, 1, 0], 0.25, 0.4, ["torso", "head"], "body"),
        // Seat front edge: a standing figure's calves can't occupy the seat
        // slab. Blocks shins only — seated THIGHS legitimately rest across
        // this plane on the seat top, which stays a contact surface.
        face(0, seatH - 0.03, 0.05, [0, 0, 1], [1, 0, 0], 0.21, [0, 1, 0], 0.03, 0.42, ["shin"], "body"),
      );
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
      // Centre anchor (back-compat) plus two shoulder-width grip points so a
      // `grip: hands bar` lands each hand on its own spot instead of both at
      // centre. GRIP_HALF ≈ half a shoulder width.
      const GRIP_HALF = 0.18;
      anchors.set("bar", new THREE.Vector3(0, barH, 0));
      anchors.set("bar_left", new THREE.Vector3(GRIP_HALF, barH, 0));
      anchors.set("bar_right", new THREE.Vector3(-GRIP_HALF, barH, 0));
    } else if (type === "wall") {
      const wall = box(2.2, 2.6, 0.1, mat);
      wall.position.set(0, 1.3, -0.34);
      group.add(wall);
      anchors.set("wall", new THREE.Vector3(0, 0.9, -0.29));
      // The whole front surface is solid: a wall-sit slides DOWN the wall
      // (the body translates forward until the back rests on the plane)
      // instead of the torso hinging through it. Deep capture recovers a
      // body that FK placed entirely beyond the 0.1m slab.
      colliders.push(
        face(0, 1.3, -0.29, [0, 0, 1], [1, 0, 0], 1.1, [0, 1, 0], 1.3, 0.8, ["torso", "head", "thigh", "shin", "arm"], "body"),
      );
    } else if (type === "dip-bars") {
      // Parallel dip bars either side of the figure, rails running along Z.
      // Rail height is set so a straight-arm support holds the feet clear of
      // the floor. The single `bars` grip anchor sits at the midpoint between
      // the rails at grip height: pins translate the BODY so the average hand
      // position meets the anchor, which leaves each authored hand over its
      // own rail. Side-specific anchors are required because grouped grips are
      // resolved to `bars_left` / `bars_right`; falling back to the centre
      // collapses both hands onto one point and twists the shoulders together.
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
      anchors.set("bars_left", new THREE.Vector3(halfSpan, railH, 0));
      anchors.set("bars_right", new THREE.Vector3(-halfSpan, railH, 0));
    } else if (type === "box") {
      // A low step/plateau placed IN FRONT of the figure (+Z): the lead foot
      // steps forward and up onto it. Top surface at ~0.30 m; `box` anchor sits
      // on top where the foot lands.
      const topH = 0.3;
      const plat = box(0.5, topH, 0.42, mat);
      plat.position.set(0, topH / 2, 0.32);
      group.add(plat);
      anchors.set("box", new THREE.Vector3(0, topH, 0.3));
      // Near face (toward the figure): a swinging shin clears the box edge by
      // bending at the hip (step OVER it) rather than sweeping through it.
      // Limb-resolved so the pinned lead foot on the box top is undisturbed.
      colliders.push(
        face(0, topH / 2, 0.11, [0, 0, -1], [1, 0, 0], 0.25, [0, 1, 0], topH / 2, 0.42, ["shin"], "limb"),
      );
    }
  }

  return { group, anchors, colliders };
}

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function leg(mat: THREE.Material, x: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), mat);
  m.position.set(x, 0.25, z);
  return m;
}
