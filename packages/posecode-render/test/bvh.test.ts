import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { parse } from "posecode-parser";
import { buildMannequin } from "../src/mannequin.js";
import { buildTimeline } from "../src/timeline.js";
import { exportBVH } from "../src/bvh.js";

const BICEPS = `posecode exercise "Biceps curl"
  rig humanoid
  pose start = standing

  step "Curl" 1.1s settle:
    elbows: flex 135
  step "Lower" 1.4s settle:
    elbows: flex 15
  repeat 3
`;

const GRAPEVINE = `posecode exercise "Grapevine"
  rig humanoid
  pose start = standing

  step "Left step side" 0.65s flow:
    hip_left: abduct 16
    travel: 0.3 0
  step "Return" 0.65s flow:
    hip_left: abduct 0
    travel: 0 0
  repeat 1
`;

/** Minimal BVH reader: joint names in DFS order + channel spans for a frame. */
interface ParsedBvh {
  joints: { name: string; channels: string[]; offset: number }[];
  frames: number[][];
  frameTime: number;
  channelCount: number;
}

function readBvh(text: string): ParsedBvh {
  const lines = text.split("\n");
  const joints: ParsedBvh["joints"] = [];
  let channelCount = 0;
  let i = 0;
  let current: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "MOTION") break;
    const jointMatch = /^(ROOT|JOINT)\s+(\S+)/.exec(line);
    if (jointMatch) current = jointMatch[2]!;
    const chanMatch = /^CHANNELS\s+(\d+)\s+(.*)$/.exec(line);
    if (chanMatch && current) {
      const channels = chanMatch[2]!.trim().split(/\s+/);
      joints.push({ name: current, channels, offset: channelCount });
      channelCount += channels.length;
    }
  }
  // MOTION block.
  const framesLine = lines[++i]!.trim();
  const frameCount = Number(/Frames:\s+(\d+)/.exec(framesLine)![1]);
  const frameTime = Number(/Frame Time:\s+([\d.eE+-]+)/.exec(lines[++i]!.trim())![1]);
  const frames: number[][] = [];
  for (let f = 0; f < frameCount; f++) {
    frames.push(lines[++i]!.trim().split(/\s+/).map(Number));
  }
  return { joints, frames, frameTime, channelCount };
}

/** Reconstruct a joint's local quaternion from its Z/X/Y rotation channels. */
function quatFromChannels(
  joint: ParsedBvh["joints"][number],
  row: number[],
): THREE.Quaternion {
  const DEG2RAD = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  joint.channels.forEach((chan, idx) => {
    const v = row[joint.offset + idx]! * DEG2RAD;
    if (chan === "Xrotation") x = v;
    if (chan === "Yrotation") y = v;
    if (chan === "Zrotation") z = v;
  });
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "ZXY"));
}

describe("exportBVH", () => {
  it("emits a well-formed hierarchy and matching frame data", () => {
    const { ir } = parse(BICEPS);
    expect(ir).toBeTruthy();
    const bvh = exportBVH(ir!, { fps: 30 });

    expect(bvh.startsWith("HIERARCHY")).toBe(true);
    expect(bvh).toContain("ROOT pelvis");
    expect(bvh).toContain("MOTION");
    // Root has 6 channels, and no fingers by default.
    expect(bvh).toContain(
      "CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation",
    );
    expect(bvh).not.toContain("thumb_left");

    const parsed = readBvh(bvh);
    // pelvis root + 4 spine/head + 6 arm + 6 leg = 17 joints, 6 + 16*3 = 54 channels.
    expect(parsed.joints[0]!.name).toBe("pelvis");
    expect(parsed.joints[0]!.channels).toHaveLength(6);
    // Every motion row carries exactly the declared channel count.
    for (const row of parsed.frames) {
      expect(row).toHaveLength(parsed.channelCount);
    }
    // The whole looped runtime (cycle incl. loop-reset wrap × reps) is baked,
    // one frame per 1/fps plus the closing frame.
    const tl = buildTimeline(ir!);
    const total = tl.duration * tl.repeat;
    expect(parsed.frameTime).toBeCloseTo(1 / 30, 6);
    expect(parsed.frames.length).toBe(Math.round(total * 30) + 1);
  });

  it("bakes joint rotations that reconstruct the sampled pose", () => {
    const { ir } = parse(BICEPS);
    const bvh = exportBVH(ir!, { fps: 30 });
    const parsed = readBvh(bvh);
    const elbow = parsed.joints.find((j) => j.name === "elbow_left")!;
    expect(elbow).toBeTruthy();

    // Independently sample the timeline at the same frame time and compare the
    // reconstructed elbow rotation against the live bone rotation.
    const mannequin = buildMannequin();
    const timeline = buildTimeline(ir!);
    const frameIndex = 15; // 0.5s in, mid-curl
    timeline.sample(frameIndex / 30, mannequin.bones);
    const expected = mannequin.bones.get("elbow_left")!.quaternion;

    const got = quatFromChannels(elbow, parsed.frames[frameIndex]!);
    expect(got.angleTo(expected)).toBeLessThan(1e-4);

    // The curl is a real motion: the elbow is clearly bent at mid-curl.
    expect(Math.abs(new THREE.Euler().setFromQuaternion(expected, "ZXY").x)).toBeGreaterThan(0.5);
  });

  it("preserves root translation for a travelling movement", () => {
    const { ir } = parse(GRAPEVINE);
    const bvh = exportBVH(ir!, { fps: 30 });
    const parsed = readBvh(bvh);
    // Root position lives in the first three channels (Xposition Yposition Zposition).
    const xs = parsed.frames.map((row) => row[0]!);
    const ys = parsed.frames.map((row) => row[1]!);
    // Travels +0.3m in X then back: peak X well above the start.
    expect(Math.max(...xs)).toBeGreaterThan(0.2);
    expect(xs[0]).toBeCloseTo(0, 3);
    // The pelvis height stays constant in authored export (no ground solve).
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0, 6);
  });

  it("can include finger joints on request", () => {
    const { ir } = parse(BICEPS);
    const withFingers = readBvh(exportBVH(ir!, { includeFingers: true }));
    const without = readBvh(exportBVH(ir!, { includeFingers: false }));
    expect(withFingers.joints.length).toBeGreaterThan(without.joints.length);
    expect(withFingers.joints.some((j) => j.name === "thumb_left")).toBe(true);
  });

  it("scales lengths when asked (metres → centimetres)", () => {
    const { ir } = parse(GRAPEVINE);
    const cm = readBvh(exportBVH(ir!, { scale: 100 }));
    const peakX = Math.max(...cm.frames.map((row) => row[0]!));
    // 0.3 m travel becomes ~30 cm.
    expect(peakX).toBeGreaterThan(20);
  });
});
