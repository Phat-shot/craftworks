"use strict";
// ═══════════════════════════════════════════════════════════
//  AR OPS — tilt-compensated compass heading
//
//  expo-location's watchHeadingAsync reports the heading of the device's
//  TOP EDGE — a fine proxy for "which way you're facing" when the phone
//  lies flat (map reading), but meaningless when held upright for the
//  camera (the top edge then points near the zenith, not the horizon).
//  Shooting always happens through the camera, so the heading used for
//  aiming/hit-validation needs the heading of the BACK CAMERA's direction
//  instead, which only becomes well-defined once the phone stands upright.
//
//  Rather than track two different heading APIs, both cases are the same
//  underlying computation — the compass heading of an arbitrary device-local
//  axis — using the same algorithm Android's SensorManager.getRotationMatrix/
//  getOrientation uses internally, generalized to any axis:
//
//    east  = normalize(cross(magnetometer, accelerometer))
//    north = cross(accelerometer, east)          (already unit length)
//    heading(axis) = atan2(dot(east, axis), dot(north, axis))
//
//  Device-local coordinates follow the standard mobile convention: X runs
//  left→right, Y runs bottom→top (the "top edge" axis), Z runs out of the
//  screen towards the viewer (so the back camera points along -Z).
//
//  Degenerates (returns null) whenever `axis` is nearly parallel to the
//  accelerometer's own direction ("up") — there is no meaningful compass
//  heading for a vector pointing straight up or down. That's expected and
//  intentional here: TOP_EDGE_AXIS degenerates when the phone stands
//  upright, CAMERA_FORWARD_AXIS degenerates when it lies flat — callers
//  pick whichever axis matches how the phone is actually being held.
// ═══════════════════════════════════════════════════════════
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMERA_FORWARD_AXIS = exports.TOP_EDGE_AXIS = void 0;
exports.tiltCompensatedHeadingDeg = tiltCompensatedHeadingDeg;
/** Device's top-edge direction — meaningful when held flat (map reading). */
exports.TOP_EDGE_AXIS = { x: 0, y: 1, z: 0 };
/** Back camera's viewing direction — meaningful when held upright (AR/shooting). */
exports.CAMERA_FORWARD_AXIS = { x: 0, y: 0, z: -1 };
function length(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function normalize(v) {
    const len = length(v);
    if (len === 0)
        return { x: 0, y: 0, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}
function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
const RAD2DEG = 180 / Math.PI;
/** Below this, treat a vector as degenerate/zero-length. */
const EPS = 1e-6;
/**
 * Tilt-compensated compass heading (degrees, 0-360, 0 = magnetic north) of
 * `axis` (a direction fixed in device-local coordinates), given raw
 * accelerometer and magnetometer readings in the same device-local frame.
 * Returns null if the inputs are degenerate or `axis` is too close to the
 * accelerometer's own direction to yield a stable heading.
 */
function tiltCompensatedHeadingDeg(accel, mag, axis) {
    const a = normalize(accel);
    if (length(a) < EPS)
        return null;
    const east = normalize(cross(mag, a));
    if (length(east) < EPS)
        return null; // mag parallel to accel — no field to reference
    const north = cross(a, east); // unit length: a, east are unit and orthogonal
    const e = dot(east, axis);
    const n = dot(north, axis);
    if (Math.abs(e) < EPS && Math.abs(n) < EPS)
        return null; // axis ~parallel to "up"
    let heading = Math.atan2(e, n) * RAD2DEG;
    if (heading < 0)
        heading += 360;
    return heading;
}
