export function exactlyOnce(callback?: () => void): () => void {
  let fired = false;
  return () => {
    if (fired) return;
    fired = true;
    callback?.();
  };
}
