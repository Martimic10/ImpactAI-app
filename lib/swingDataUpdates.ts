const listeners = new Set<() => void>();

export function subscribeSwingDataUpdates(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySwingDataUpdates() {
  listeners.forEach((fn) => fn());
}
