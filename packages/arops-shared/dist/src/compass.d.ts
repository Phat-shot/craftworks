export interface Vec3 {
    x: number;
    y: number;
    z: number;
}
/** Device's top-edge direction — meaningful when held flat (map reading). */
export declare const TOP_EDGE_AXIS: Vec3;
/** Back camera's viewing direction — meaningful when held upright (AR/shooting). */
export declare const CAMERA_FORWARD_AXIS: Vec3;
/**
 * Tilt-compensated compass heading (degrees, 0-360, 0 = magnetic north) of
 * `axis` (a direction fixed in device-local coordinates), given raw
 * accelerometer and magnetometer readings in the same device-local frame.
 * Returns null if the inputs are degenerate or `axis` is too close to the
 * accelerometer's own direction to yield a stable heading.
 */
export declare function tiltCompensatedHeadingDeg(accel: Vec3, mag: Vec3, axis: Vec3): number | null;
