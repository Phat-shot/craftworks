// expo-location's promises (getCurrentPositionAsync, watchPositionAsync) have
// no built-in timeout and can hang indefinitely on some devices/cold GPS
// fixes instead of rejecting — wrapping them here turns a silent hang into a
// bounded failure the caller can retry or surface to the user.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}
