import { useEffect, useState } from 'react';

/** Server build version (date + short commit SHA, see server/src/VERSION —
 *  written by the Docker build workflow, .github/workflows/docker.yml) —
 *  lets a tester tell which exact build/commit a deploy is actually running,
 *  same idea as BUILD_TIME/COMMIT_SHA shown in the mobile/wear apps. */
export function useServerVersion() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(d => setVersion(d.version || '')).catch(() => {});
  }, []);
  return version;
}
