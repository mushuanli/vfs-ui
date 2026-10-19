import { defaultPresentation, type VFSPresentation } from '../../../contracts/presentation';
import type { DirectoryPreviewOptions } from '../../../contracts/options';
import type { ActionRunner } from '../../../interaction/ActionRunner';
import type { VFSNodeUI } from '../../../contracts/types';
import type { NodeListState } from './NodeListState';

/** A display limit never changes the source tree or selection/export scope. */
export class DirectoryPreview {
    private readonly expanded = new Set<string>();
    private readonly controls = new Map<string, HTMLButtonElement>();
    constructor(private readonly actions: ActionRunner,
        private readonly policy?: (directory: VFSNodeUI) => number | DirectoryPreviewOptions | undefined,
        private readonly ui: VFSPresentation = defaultPresentation) {}
    project(directory: VFSNodeUI, state: NodeListState) {
        const children = directory.children ?? [], policy = this.policy?.(directory);
        const strict = typeof policy === 'object', limit = strict ? policy.limit : policy;
        if (state.searchQuery && !strict || limit === undefined || !Number.isFinite(limit) || limit < 1 || children.length <= limit) return { children };
        const expanded = !strict && this.expanded.has(directory.id);
        const visible = expanded ? children : children.filter((child, index) => index < Math.floor(limit)
            || !strict && this.containsSelection(child, state, new Set()));
        if (!expanded && visible.length === children.length) return { children };
        return { children: visible, expanded, hidden: children.length - visible.length };
    }
    private containsSelection(node: VFSNodeUI, state: NodeListState, visited: Set<string>): boolean {
        if (visited.has(node.id)) return false;
        visited.add(node.id);
        return node.id === state.activeId || state.selectedItemIds.has(node.id) ||
            !!node.children?.some(child => this.containsSelection(child, state, visited));
    }
    control(directory: VFSNodeUI, expanded: boolean, hidden: number, render: () => void): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button';
        const id = directory.id, policy = this.policy?.(directory);
        button.className = 'vfs-directory-item__preview-toggle'; button.dataset.previewId = id;
        if (typeof policy === 'object') {
            button.textContent = policy.moreLabel; button.disabled = this.actions.isPending(`preview:${id}`);
            this.controls.set(id, button);
            button.onclick = event => { event.stopPropagation(); this.open(directory, policy); };
        } else {
            button.setAttribute('aria-expanded', String(expanded));
            button.textContent = expanded ? this.ui.t('vfs.preview.collapse') : this.ui.t('vfs.preview.more', { count: hidden });
            button.onclick = event => { event.stopPropagation(); expanded ? this.expanded.delete(id) : this.expanded.add(id); render(); };
        }
        return button;
    }
    private open(directory: VFSNodeUI, policy: DirectoryPreviewOptions): void {
        const button = this.controls.get(directory.id); if (button) button.disabled = true;
        void this.actions.run(`preview:${directory.id}`, () => policy.open(directory)).catch(() => {})
            .finally(() => { const current = this.controls.get(directory.id); if (current) current.disabled = false; });
    }
    beginRender(): void { this.controls.clear(); }
    clear(): void { this.expanded.clear(); this.controls.clear(); }
}
