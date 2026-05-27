const maxEntries = 200;
const entries = [];
const listeners = new Set();

export function addLog(entry) {
  const fullEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    ...entry
  };
  entries.unshift(fullEntry);
  entries.splice(maxEntries);
  for (const listener of listeners) {
    listener(fullEntry);
  }
  return fullEntry;
}

export function getLogs() {
  return entries;
}

export function subscribeLogs(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
