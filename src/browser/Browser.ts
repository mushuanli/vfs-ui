import type { VFSPresentationOptions } from '../contracts/presentation';
import type { BrowserNode, BrowserSource } from '../contracts/source';
import type { VFSListSort, VFSNodeUI } from '../contracts/types';
import { VFSUIShell } from '../shell/VFSUIShell';
import type { BrowserAction, ActionContext } from './actions';

export interface BrowserOptions {
  container: HTMLElement;
  source: BrowserSource;
  title?: string;
  presentation?: VFSPresentationOptions;
  appearance?: import('../contracts/components').VFSListAppearance;
  sort?: VFSListSort;
  actions?: readonly BrowserAction[];
  onActivate?(node: BrowserNode): void;
  onExpansionChange?(change: { id: string; expanded: boolean }): void;
  onError?(error: unknown): void;
}
function resource(node: VFSNodeUI): BrowserNode {
  return { id: node.id, parentId: node.parentId ?? node.metadata.parentPath, kind: node.kind ?? node.type,
    label: node.metadata.title, resource: node.resource, expandable: node.metadata.custom.browserExpandable, icon: node.icon,
    description: node.content?.summary, readOnly: node.metadata.custom._readOnly === true,
    tags: [...node.metadata.tags], createdAt: Date.parse(node.metadata.createdAt), modifiedAt: Date.parse(node.metadata.lastModified),
    presentation: node.presentation?.layout, titleLayout: node.presentation?.titleLayout };
}
/** Compact public facade; store and rendering details remain private. */
export class VFSBrowser {
  private readonly shell: VFSUIShell;
  private readonly abort = new AbortController();
  private readonly cleanups: Array<() => void> = [];
  constructor(private readonly options: BrowserOptions) {
    this.shell = new VFSUIShell({ sessionListContainer: options.container, source: options.source,
      title: options.title, presentation: options.presentation, appearance: options.appearance, sort: options.sort, autoSelectFirst: false, persistence: false, onError: options.onError,
      contextMenu: { items: (_item, defaults) => defaults.filter(entry => entry.type !== 'separator'
        && options.actions?.some(action => action.id === entry.id)), bulkItems: () => this.menu('selection') },
    });
    this.cleanups.push(this.shell.on('stateChanged', () => this.toolbar()));
    this.cleanups.push(this.shell.on('sessionSelected', ({ item }) => { if (item) options.onActivate?.(resource(item)); }));
    this.cleanups.push(this.shell.on('directoryExpansionChanged', change => options.onExpansionChange?.(change)));
    this.toolbar();
  }
  private context(target?: VFSNodeUI): ActionContext {
    const state = this.shell.getSnapshot();
    const selection = [...state.selectedIds].map(id => this.shell.getNode(id)).filter((node): node is VFSNodeUI => !!node);
    const parent = target?.metadata.parentPath ? this.shell.getNode(target.metadata.parentPath) : undefined;
    return { selection: selection.map(resource), target: target ? resource(target) : null, parent: parent ? resource(parent) : null };
  }
  private available(placement: 'toolbar' | 'menu' | 'selection', target?: VFSNodeUI): BrowserAction[] {
    return (this.options.actions ?? []).filter(action => action.placements.includes(placement) && (action.state?.(this.context(target)).visible ?? true));
  }
  private async execute(action: BrowserAction, target?: VFSNodeUI): Promise<void> {
    const context = this.context(target), state = action.state?.(context);
    if (this.abort.signal.aborted || state && (!state.visible || !state.enabled)) return;
    await action.run(context, this.abort.signal);
    if (!this.abort.signal.aborted) await this.shell.refresh();
  }
  private menu(placement: 'menu' | 'selection', target?: VFSNodeUI) {
    return this.available(placement, target).map(action => ({ id: action.id, label: action.label, iconHTML: action.iconHTML,
      disabled: action.state?.(this.context(target)).enabled === false,
      onClick: () => this.execute(action, target) }));
  }
  private toolbar(): void {
    this.shell.setToolbar({ definitions: (this.options.actions ?? []).map(action => ({
      id: action.id, label: action.label, iconHTML: action.iconHTML,
      placement: context => {
        const target = context.origin === 'menu' ? context.target ?? undefined : undefined;
        return this.available(context.origin, target).includes(action) ? context.origin : 'hidden';
      },
      disabled: context => action.state?.(this.context(context.origin === 'menu' ? context.target ?? undefined : undefined)).enabled === false,
      run: context => this.execute(action, context.origin === 'menu' ? context.target ?? undefined : undefined),
    })) });
  }
  start(): Promise<void> { return this.shell.start().then(() => {}); }
  reveal(id: string): Promise<void> { return this.shell.selectPath(id); }
  expand(id: string, expanded = true): void { this.shell.setExpanded(id, expanded); }
  setQuery(query: string): void { this.shell.setQuery(query); }
  select(ids: readonly string[]): void { this.shell.setSelection([...ids]); }
  refresh(): Promise<void> { return this.shell.refresh(); }
  getSelection(): readonly BrowserNode[] { return this.context().selection; }
  getSnapshot(): import('../contracts/source').BrowserSnapshot { return this.shell.getSnapshot(); }
  destroy(): void { this.abort.abort(); this.cleanups.forEach(close => close()); this.shell.destroy(); }
}
export const createVFSBrowser = (options: BrowserOptions): VFSBrowser => new VFSBrowser(options);
