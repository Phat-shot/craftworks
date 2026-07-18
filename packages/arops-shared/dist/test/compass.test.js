"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const compass_1 = require("../src/compass");
// Reference orientation: phone flat, screen up. Accelerometer reads "up"
// along local Z (the standard mobile convention: Z points out of the
// screen). Magnetometer, idealized with zero inclination, reads pure north
// along local Y (the top edge) when the top edge points at magnetic north.
const FLAT_ACCEL = { x: 0, y: 0, z: 1 };
(0, node_test_1.test)('flat + top edge pointing north → top-edge heading is 0', () => {
    const mag = { x: 0, y: 1, z: 0 };
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, compass_1.TOP_EDGE_AXIS);
    strict_1.default.ok(h !== null);
    strict_1.default.ok(Math.abs(h - 0) < 1e-6);
});
(0, node_test_1.test)('flat + top edge pointing east → top-edge heading is 90', () => {
    // Right-handed device frame (X×Y=Z, the standard mobile sensor
    // convention): with Z=up, the magnetic field reads along -X (not +X) when
    // the top edge (Y) points east — X×Y=Z forces X to be the World-South
    // direction in this orientation, so North (the field itself) is -X.
    const mag = { x: -1, y: 0, z: 0 };
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, compass_1.TOP_EDGE_AXIS);
    strict_1.default.ok(h !== null);
    strict_1.default.ok(Math.abs(h - 90) < 1e-6);
});
(0, node_test_1.test)('flat + top edge pointing south → top-edge heading is 180', () => {
    const mag = { x: 0, y: -1, z: 0 };
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, compass_1.TOP_EDGE_AXIS);
    strict_1.default.ok(h !== null);
    strict_1.default.ok(Math.abs(h - 180) < 1e-6);
});
(0, node_test_1.test)('flat: camera-forward axis is degenerate (points straight down)', () => {
    const mag = { x: 0, y: 1, z: 0 };
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, compass_1.CAMERA_FORWARD_AXIS);
    strict_1.default.equal(h, null);
});
(0, node_test_1.test)('degenerate: axis exactly parallel to accelerometer (up) → null', () => {
    const mag = { x: 0, y: 1, z: 0 };
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, { x: 0, y: 0, z: 1 });
    strict_1.default.equal(h, null);
});
(0, node_test_1.test)('degenerate: zero-length accelerometer → null', () => {
    const h = (0, compass_1.tiltCompensatedHeadingDeg)({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, compass_1.TOP_EDGE_AXIS);
    strict_1.default.equal(h, null);
});
(0, node_test_1.test)('degenerate: magnetometer parallel to accelerometer (no field to reference) → null', () => {
    const h = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, { x: 0, y: 0, z: 5 }, compass_1.TOP_EDGE_AXIS);
    strict_1.default.equal(h, null);
});
(0, node_test_1.test)('rotating the reference axis 90° in the horizontal plane shifts heading by 90°', () => {
    const mag = { x: 0, y: 1, z: 0 };
    const h1 = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, { x: 0, y: 1, z: 0 });
    const h2 = (0, compass_1.tiltCompensatedHeadingDeg)(FLAT_ACCEL, mag, { x: 1, y: 0, z: 0 });
    strict_1.default.ok(h1 !== null && h2 !== null);
    const diff = ((h2 - h1 + 540) % 360) - 180;
    strict_1.default.ok(Math.abs(Math.abs(diff) - 90) < 1e-6);
});
(0, node_test_1.test)('upright (phone standing on its bottom edge, screen facing +Y): camera-forward is well-defined, top-edge degenerates', () => {
    // Physically tip the phone from flat to standing upright by rotating -90°
    // around the local X axis (left-right edge fixed): the old local Z (was
    // "up") becomes the new local Y ("up" edge now horizontal-ish... instead
    // we just directly construct the post-rotation accelerometer reading,
    // which is the actual API surface this function consumes) — accelerometer
    // now points along local Y (screen's "up" edge direction from the device's
    // own perspective is no longer relevant; what matters is that gravity now
    // registers on a different local axis).
    const accelUpright = { x: 0, y: -1, z: 0 };
    const mag = { x: 0, y: 0, z: 1 };
    const topEdge = (0, compass_1.tiltCompensatedHeadingDeg)(accelUpright, mag, compass_1.TOP_EDGE_AXIS);
    const camForward = (0, compass_1.tiltCompensatedHeadingDeg)(accelUpright, mag, compass_1.CAMERA_FORWARD_AXIS);
    strict_1.default.equal(topEdge, null); // top edge now points at the zenith/nadir — degenerate
    strict_1.default.ok(camForward !== null); // camera direction is now horizontal — well-defined
});
