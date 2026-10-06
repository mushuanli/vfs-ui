import { defaultPresentation, type VFSPresentation } from '../../../contracts/presentation';
import type { VFSNodeUI, MenuItem } from '../../../contracts/types';
import { escapeHTML } from '../../../utils/local';

export type VFSToolbarAction = string;
export interface VFSToolbarContext { selectedIds: string[]; activeId: string | null; parentPath: string | null }
export interface VFSActionContext extends VFSToolbarContext {
    origin: 'toolbar' | 'menu';
    target: VFSNodeUI | null;
    readonly: boolean;
}
export type VFSActionPlacement = 'toolbar' | 'menu' | 'both' | 'hidden';
/** One host-owned command definition shared by toolbar and resource menu. */
export interface VFSActionDefinition {
    id: string;
    label: string;
    iconHTML?: string;
    placement: VFSActionPlacement | ((context: VFSActionContext) => VFSActionPlacement);
    disabled?(context: VFSActionContext): boolean;
    run(context: VFSActionContext, signal: AbortSignal): Promise<void>;
}
export function actionVisible(action: VFSActionDefinition, context: VFSActionContext): boolean {
    const placement = typeof action.placement === 'function' ? action.placement(context) : action.placement;
    return placement === 'both' || placement === context.origin;
}
export function actionMenuItems(definitions: readonly VFSActionDefinition[], context: VFSActionContext,
    run: (id: string, item: VFSNodeUI) => Promise<void>): MenuItem[] {
    return definitions.filter(action => actionVisible(action, context)).map(action => ({
        id: action.id, label: action.label, iconHTML: action.iconHTML, disabled: action.disabled?.(context),
        onClick: item => run(action.id, item),
    }));
}
export interface VFSToolbarOptions {
    /** Compact borderless controls for a host-owned header. */
    variant?: 'default' | 'plain';
    definitions?: readonly VFSActionDefinition[];
    items?: readonly { id: string; label: string; disabled?: boolean }[];
    hiddenActions?: VFSToolbarAction[];
    fileLabel?: string;
    directoryLabel?: string;
    directoryFirst?: boolean;
    actions?: Partial<Record<VFSToolbarAction, (context: VFSToolbarContext) => Promise<void>>>;
    /** A compact title-bar action, such as returning to the navigation list. */
    secondary?: { label: string; run(): void };
}

export function toolbarHTML(options: VFSToolbarOptions, fileLabel: string, ui: VFSPresentation = defaultPresentation): string {
    if (options.definitions) return options.definitions.map(action =>
        `<button type="button" class="vfs-node-list__new-btn${action.iconHTML ? ' vfs-node-list__new-btn--icon' : ''}" data-action="${escapeHTML(action.id)}" title="${escapeHTML(action.label)}" aria-label="${escapeHTML(action.label)}">${action.iconHTML ?? ''}<span class="vfs-node-list__button-label">${escapeHTML(action.label)}</span></button>`).join('');
    if (options.items) return options.items.map(item => `<button type="button" class="vfs-node-list__new-btn" data-action="${escapeHTML(item.id)}" ${item.disabled ? 'disabled' : ''}>${escapeHTML(item.label)}</button>`).join('');
    const labels: Record<string, string> = { 'create-file': options.fileLabel ?? fileLabel, 'create-directory': options.directoryLabel ?? ui.t('vfs.toolbar.directory'),
        import: ui.t('vfs.toolbar.import'), export: ui.t('vfs.toolbar.export') };
    const order: VFSToolbarAction[] = options.directoryFirst
        ? ['create-directory', 'create-file', 'import', 'export'] : ['create-file', 'create-directory', 'import', 'export'];
    const buttons = order.filter(action => !options.hiddenActions?.includes(action)).map(action => {
        const create = action.startsWith('create-'), label = labels[action];
        const title = create ? ui.t('vfs.toolbar.create', { name: label }) : label;
        const icon = action === 'create-file' ? 'addFile' : action === 'create-directory' ? 'addFolder' : action as 'import' | 'export';
        return { create, html: `<button type="button" class="vfs-node-list__new-btn ${create ? '' : 'vfs-node-list__new-btn--icon'}" data-action="${action}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">${ui.icon(icon)}<span class="vfs-node-list__button-label">${escapeHTML(label)}</span></button>` };
    });
    if (options.variant === 'plain') return buttons.map(button => button.html).join('');
    return [true, false].map(create => {
        const html = buttons.filter(button => button.create === create).map(button => button.html).join('');
        return html ? `<span class="vfs-node-list__toolbar-group vfs-node-list__toolbar-group--${create ? 'create' : 'transfer'}">${html}</span>` : '';
    }).join('');
}
