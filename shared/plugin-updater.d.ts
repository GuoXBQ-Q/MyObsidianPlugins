export interface PluginUpdater {
  ready: Promise<void>;
  dispose(): void;
}
// Obsidian supplies these objects; the shared CommonJS runtime is bundled independently in each plugin.
export function createPluginUpdater(plugin: unknown, obsidian: unknown): PluginUpdater | null;
export function renderUpdateSettings(parent: HTMLElement, updater: PluginUpdater | null, obsidian: unknown): () => void;
