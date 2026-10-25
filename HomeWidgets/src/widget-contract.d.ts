/** Documentation types for local widgets and the public registerWidget API. */
export interface WidgetPluginSource {
  pluginId: string;
  pluginName: string;
}
export interface HomeWidgetsAPI {
  version: 3;
  /** Public registrations are always categorized as external plugin components. */
  registerWidget(definition: WidgetDefinition<any>, source: WidgetPluginSource): () => void;
  listWidgetTypes(): Array<{ type: string; label: string; supportsMultipleInstances: boolean }>;
  /** Register a heatmap source; call the returned cleanup when unloading. */
  registerActivitySource(definition: ActivitySource): () => void;
}
export interface ActivitySource {
  id: string;
  label: string;
  unit: string;
  legend?: string;
  load(context: { io: any; config: Record<string, unknown>; start: string; end: string; signal?: AbortSignal }): Promise<{ values: Array<{date: string; value: number}>; note?: string }>;
}
export interface Lifetime {
  readonly signal: AbortSignal;
  own(cleanup: () => void): () => void;
  listen(target: EventTarget, event: string, callback: EventListener, options?: AddEventListenerOptions): () => void;
  interval(callback: () => void, milliseconds: number): () => void;
}
export interface WidgetField {
  key: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'date' | 'checkbox' | 'select' | 'json';
  required?: boolean;
  min?: number;
  max?: number;
  options?: Array<string | [value: string, label: string]>;
  help?: string;
  default?: unknown;
}
export interface WidgetInstance<T = Record<string, unknown>> {
  id: string;        // instance identity; never reuse it for another widget
  type: string;      // registered definition type, e.g. banner
  title: string;
  span: number;      // 1–12 columns; stacks on narrow containers
  hidden?: boolean;
  tint?: 'plain' | 'lavender' | 'rose' | 'sage';
  background?: string;
  cssClasses?: string; // optional space-separated classes for this instance
  settings: T;       // component-owned business configuration
}
export interface WidgetContext<T> {
  id: string;
  config: T;
  doc: Document;
  el: HTMLElement;       // owned body; do not query sibling widget DOM
  actions: HTMLElement;  // optional header actions
  sourcePath: string;
  signal: AbortSignal;
  /** With deferRender, call only after async loading, immediately before synchronous DOM changes. */
  beginRender(): void;
  lifetime: Lifetime;
  local: Record<string, unknown>; // ephemeral state keyed by instance ID
  services: { io: any; bus: any; tasks: any; events: any; ideas: any; quotes: any; integrations: any; activity: any };
  platform: { vaultId: string; preview?: boolean };
  forms: {
    panel(title: string, className?: string): { dialog: HTMLDialogElement; body: HTMLElement; readonly alive: boolean; setBusy(value: boolean): void };
    show(title: string, fields: WidgetField[], initial: object, onSave: (value: any) => Promise<unknown>, submit?: string): HTMLDialogElement;
    confirm(title: string, description: string | { message?: string; content?: string; detail?: string }, onConfirm: () => Promise<unknown>, submit?: string): HTMLDialogElement;
  };
  notify(text: string, error?: boolean): void;
  run<TValue>(action: () => Promise<TValue>): Promise<TValue | undefined>;
  refresh(): Promise<void>;
  /** Function patches read the latest saved settings in the vault update queue. */
  updateConfig(patch: Partial<T> | ((current: Partial<T>) => Partial<T>)): Promise<void>;
}
export interface WidgetDefinition<T = Record<string, unknown>> {
  type: string;
  label: string;
  subtitle?: string;
  /** Defaults to false. A hidden instance still occupies the vault's single slot. */
  supportsMultipleInstances?: boolean;
  icon?: string | ((doc: Document) => Element);
  span?: number;
  frameless?: boolean; // hide the header, independently of the frame
  frame?: 'card' | 'none'; // default: card; use none explicitly for a borderless widget
  defaults: T;
  fields?: WidgetField[];
  watch?(settings: T): string[]; // file:<path>, folder:<path>, integrations
  /** Keep the previous content/lifetime until mount calls context.beginRender(). */
  deferRender?: boolean;
  mount(context: WidgetContext<T>): void | (() => void) | Promise<void | (() => void)>;
}
