import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tiltCompensatedHeadingDeg, TOP_EDGE_AXIS, CAMERA_FORWARD_AXIS, Vec3,
} from '../src/compass';

// Reference orientation: phone flat, screen up. Accelerometer reads "up"
// along local Z (the standard mobile convention: Z points out of the
// screen). Magnetometer, idealized with zero inclination, reads pure north
// along local Y (the top edge) when the top edge points at magnetic north.
const FLAT_ACCEL: Vec3 = { x: 0, y: 0, z: 1 };

test('flat + top edge pointing north → top-edge heading is 0', () => {
  const mag: Vec3 = { x: 0, y: 1, z: 0 };
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, TOP_EDGE_AXIS);
  assert.ok(h !== null);
  assert.ok(Math.abs(h! - 0) < 1e-6);
});

test('flat + top edge pointing east → top-edge heading is 90', () => {
  // Right-handed device frame (X×Y=Z, the standard mobile sensor
  // convention): with Z=up, the magnetic field reads along -X (not +X) when
  // the top edge (Y) points east — X×Y=Z forces X to be the World-South
  // direction in this orientation, so North (the field itself) is -X.
  const mag: Vec3 = { x: -1, y: 0, z: 0 };
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, TOP_EDGE_AXIS);
  assert.ok(h !== null);
  assert.ok(Math.abs(h! - 90) < 1e-6);
});

test('flat + top edge pointing south → top-edge heading is 180', () => {
  const mag: Vec3 = { x: 0, y: -1, z: 0 };
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, TOP_EDGE_AXIS);
  assert.ok(h !== null);
  assert.ok(Math.abs(h! - 180) < 1e-6);
});

test('flat: camera-forward axis is degenerate (points straight down)', () => {
  const mag: Vec3 = { x: 0, y: 1, z: 0 };
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, CAMERA_FORWARD_AXIS);
  assert.equal(h, null);
});

test('degenerate: axis exactly parallel to accelerometer (up) → null', () => {
  const mag: Vec3 = { x: 0, y: 1, z: 0 };
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, { x: 0, y: 0, z: 1 });
  assert.equal(h, null);
});

test('degenerate: zero-length accelerometer → null', () => {
  const h = tiltCompensatedHeadingDeg({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, TOP_EDGE_AXIS);
  assert.equal(h, null);
});

test('degenerate: magnetometer parallel to accelerometer (no field to reference) → null', () => {
  const h = tiltCompensatedHeadingDeg(FLAT_ACCEL, { x: 0, y: 0, z: 5 }, TOP_EDGE_AXIS);
  assert.equal(h, null);
});

test('rotating the reference axis 90° in the horizontal plane shifts heading by 90°', () => {
  const mag: Vec3 = { x: 0, y: 1, z: 0 };
  const h1 = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, { x: 0, y: 1, z: 0 });
  const h2 = tiltCompensatedHeadingDeg(FLAT_ACCEL, mag, { x: 1, y: 0, z: 0 });
  assert.ok(h1 !== null && h2 !== null);
  const diff = ((h2! - h1! + 540) % 360) - 180;
  assert.ok(Math.abs(Math.abs(diff) - 90) < 1e-6);
});

test('upright (phone standing on its bottom edge, screen facing +Y): camera-forward is well-defined, top-edge degenerates', () => {
  // Physically tip the phone from flat to standing upright by rotating -90°
  // around the local X axis (left-right edge fixed): the old local Z (was
  // "up") becomes the new local Y ("up" edge now horizontal-ish... instead
  // we just directly construct the post-rotation accelerometer reading,
  // which is the actual API surface this function consumes) — accelerometer
  // now points along local Y (screen's "up" edge direction from the device's
  // own perspective is no longer relevant; what matters is that gravity now
  // registers on a different local axis).
  const accelUpright: Vec3 = { x: 0, y: -1, z: 0 };
  const mag: Vec3 = { x: 0, y: 0, z: 1 };
  const topEdge = tiltCompensatedHeadingDeg(accelUpright, mag, TOP_EDGE_AXIS);
  const camForward = tiltCompensatedHeadingDeg(accelUpright, mag, CAMERA_FORWARD_AXIS);
  assert.equal(topEdge, null); // top edge now points at the zenith/nadir — degenerate
  assert.ok(camForward !== null); // camera direction is now horizontal — well-defined
});
