/**
 * Applies only a settings snapshot confirmed by the main process.
 * Rejections deliberately propagate to callers that need transactional UI state.
 */
export async function persistSettingsUpdate<Settings, Patch>(
  update: (patch: Patch) => Promise<Settings>,
  apply: (settings: Settings) => void,
  patch: Patch
): Promise<void> {
  const updated = await update(patch);
  apply(updated);
}
