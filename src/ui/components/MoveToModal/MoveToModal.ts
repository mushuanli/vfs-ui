import { escapeHTML } from '../../../utils/local';
import { isItemReadOnly } from '../../../utils/helpers';
import { describeCauseChain, describeErrorReason } from '../../../utils/error-detail';
import type { VFSRowActionOptions } from '../../../contracts/options';
import { FILE_ICONS } from '../../../utils/icons';
/**
 * @file vfs-ui/ui/components/MoveToModal/MoveToModal.ts
 * @desc Modal for moving items to a target folder.
 */
import { BaseComponent, BaseComponentDeps } from '../../core/BaseComponent';
import type { VFSNodeUI, VFSUIState } from '../../../contracts/types';

interface MoveToModalState {
  operation: { isMoving: boolean; itemIds: string[]; mode?: 'copy' | 'move' } | null;
  availableTargets: VFSNodeUI[];
}

export class MoveToModal extends BaseComponent<MoveToModalState> {
  private selectedTargetId: string | null = null;
  /** Directories expanded in the modal (independent of main file tree). */
  private expandedIds = new Set<string>();

  private catalog: VFSNodeUI[] = [];
  private catalogOperation: VFSUIState['moveOperation'] = null;
  private catalogRevision = 0;
  private loading = new Set<string>();
  private busy = false;
  private error = '';
  constructor(private readonly deps: BaseComponentDeps & Pick<VFSRowActionOptions, 'transferPolicy'>) {
    super(deps);
    this.container.classList.add('vfs-move-modal-overlay');
  }

  protected transformState(global: VFSUIState): MoveToModalState {
    // Preserve children:undefined (not-yet-loaded) vs children:[] (empty dir)
    // so that loaded subdirectories inside unexpanded dirs are not silently dropped.
    const buildTree = (items: VFSNodeUI[]): VFSNodeUI[] =>
      items
        .filter(i => i.type === 'directory')
        .map(f => ({ ...f, children: f.children ? buildTree(f.children) : undefined }));

    if (this.deps.transferPolicy?.targets && global.moveOperation !== this.catalogOperation) {
      this.catalogOperation = global.moveOperation; this.catalog = []; this.loading.clear();
      const revision = ++this.catalogRevision;
      if (global.moveOperation) void this.loadTargets(undefined, revision);
    }
    return {
      operation: global.moveOperation,
      availableTargets: this.deps.transferPolicy?.targets ? this.catalog : global.moveOperation ? buildTree(global.items) : [],
    };
  }

  protected bindEvents(): void {
    this.container.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as Element;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const folderId = target.closest<HTMLElement>('[data-folder-id]')?.dataset.folderId;

      if (this.busy) return;
      if (action === 'confirm-move' && this.selectedTargetId && this.state.operation) {
        void this.confirm();
      } else if (action === 'cancel-move' || target === this.container) {
        this.expandedIds.clear();
        this.commandBus.execute('move:end', undefined as any);
      } else if (action === 'toggle-folder' && folderId) {
        this.toggleFolder(folderId);
      } else if (folderId) {
        if (this.allowed(folderId)) { this.selectedTargetId = folderId; this.render(); }
        else this.logDisabledTarget(folderId);
      }
    });
  }

  private toggleFolder(id: string): void {
    if (this.findInAvailableTargets(id)?.metadata.custom._disabled === true) return;
    if (this.expandedIds.has(id)) this.expandedIds.delete(id);
    else {
      this.expandedIds.add(id);
      if (this.findInAvailableTargets(id)?.children === undefined) {
        if (this.deps.transferPolicy?.targets) void this.loadTargets(id, this.catalogRevision);
        else this.commandBus.execute('nav:toggleFolder', { folderId: id });
      }
    }
    this.render();
  }

  private async loadTargets(parent: string | undefined, revision: number): Promise<void> {
    const operation = this.catalogOperation, load = this.deps.transferPolicy?.targets;
    if (!operation || !load || this.loading.has(parent ?? 'root')) return;
    this.loading.add(parent ?? 'root');
    try {
      const nodes = await load(operation.itemIds, operation.mode ?? 'move', parent);
      if (revision !== this.catalogRevision) return;
      if (parent) { const node = this.findInAvailableTargets(parent); if (node) node.children = nodes; }
      else this.catalog = nodes;
      this.state = { ...this.state, availableTargets: this.catalog };
      for (const node of nodes) if (!this.allowed(node.id)) this.logDisabledTarget(node.id);
    } catch (error) { if (revision === this.catalogRevision) this.reportFailure('load-targets', error, parent); }
    finally { if (revision === this.catalogRevision) { this.loading.delete(parent ?? 'root'); this.render(); } }
  }

  override destroy(): void { ++this.catalogRevision; super.destroy(); }

  private allowed(id: string): boolean {
    return !this.targetRejection(id);
  }

  private targetRejection(id: string): string | undefined {
    const operation = this.state.operation;
    if (!operation) return 'inactive';
    const node = id === 'root' ? null : this.findInAvailableTargets(id) ?? null;
    if (id !== 'root' && !node) return 'target-missing';
    if (this.store.getState().readOnly) return 'view-read-only';
    if (node?.metadata.custom._disabled === true) return 'target-unavailable';
    if (node && isItemReadOnly(node)) return 'target-read-only';
    const destination = id === 'root' ? '/' : id;
    if (operation.itemIds.some(source => destination === source || destination.startsWith(source + '/'))) return 'source-descendant';
    if (operation.itemIds.some(source => destination === (source.slice(0, source.lastIndexOf('/')) || '/'))) return 'source-parent';
    if (this.deps.transferPolicy?.destination(node, operation.itemIds, operation.mode ?? 'move') === false) return 'policy-rejected';
    return undefined;
  }

  private logDisabledTarget(id: string): void {
    const node = this.findInAvailableTargets(id);
    console.info('[VFS transfer]', { stage: 'target-disabled', mode: this.state.operation?.mode ?? 'move',
      sources: this.state.operation?.itemIds, destination: id, reason: this.targetRejection(id),
      description: node?.metadata.custom.navigationDescription });
  }

  private async confirm(): Promise<void> {
    const operation = this.state.operation, id = this.selectedTargetId;
    if (!operation || !id || !this.allowed(id)) return;
    this.busy = true; this.error = ''; this.render();
    try {
      await this.commandBus.execute(operation.mode === 'copy' ? 'file:copy' : 'file:move', {
        itemIds: operation.itemIds, targetId: id === 'root' ? null : id,
      });
      this.busy = false;
      await this.commandBus.execute('move:end', undefined);
    } catch (error) { this.reportFailure('execute', error, id); }
    finally { this.busy = false; this.render(); }
  }

  private reportFailure(stage: 'load-targets' | 'execute', error: unknown, destination?: string): void {
    this.error = describeErrorReason(error);
    console.error('[VFS transfer]', { stage, mode: this.state.operation?.mode ?? 'move',
      sources: this.state.operation?.itemIds, destination, cause: describeCauseChain(error), error });
  }

  private findInAvailableTargets(id: string): VFSNodeUI | undefined {
    const search = (dirs: VFSNodeUI[]): VFSNodeUI | undefined => {
      for (const dir of dirs) {
        if (dir.id === id) return dir;
        if (dir.children) {
          const found = search(dir.children);
          if (found) return found;
        }
      }
    };
    return search(this.state.availableTargets);
  }

  protected render(): void {
    if (!this.state.operation?.isMoving) {
      this.container.style.display = 'none'; this.container.replaceChildren();
      this.selectedTargetId = null; this.expandedIds.clear(); this.error = ''; return;
    }
    this.container.style.display = 'flex';
    const markup = `<div class="vfs-move-modal">
      <div class="vfs-move-modal__header">${this.ui.t(this.state.operation.mode === 'copy' ? 'vfs.transfer.copyTitle' : 'vfs.transfer.moveTitle', { count: this.state.operation.itemIds.length })}</div>
      <div class="vfs-move-modal__body">${this.deps.transferPolicy?.targets ? '' : this.folderRow('root', this.ui.t('vfs.transfer.root'), false, 0)}${this.tree(this.state.availableTargets)}</div>
      ${this.error ? `<p role="alert">${escapeHTML(this.error)}</p>` : ''}
      <div class="vfs-move-modal__footer">
        <button class="vfs-move-modal__btn" data-action="cancel-move">${this.ui.t('vfs.transfer.cancel')}</button>
        <button class="vfs-move-modal__btn vfs-move-modal__btn--primary" data-action="confirm-move" ${this.busy || !this.selectedTargetId || !this.allowed(this.selectedTargetId) ? 'disabled' : ''}>${this.ui.t(this.state.operation.mode === 'copy' ? 'vfs.transfer.confirmCopy' : 'vfs.transfer.confirmMove')}</button>
      </div></div>`;
    this.updateDialog(markup);
  }

  private tree(folders: VFSNodeUI[], level = 0): string {
    return folders.map(folder => {
      const children = this.expandedIds.has(folder.id) && folder.children?.length
        ? `<div class="vfs-move-modal__folder-children">${this.tree(folder.children, level + 1)}</div>` : '';
      return `<div class="vfs-move-modal__folder-wrapper">${this.folderRow(folder.id, folder.metadata.title,
        folder.metadata.custom._disabled !== true && (folder.children === undefined || folder.children.length > 0), level)}${children}</div>`;
    }).join('');
  }

  private folderRow(id: string, title: string, expandable: boolean, level: number): string {
    const toggle = expandable ? `data-action="toggle-folder" data-folder-id="${escapeHTML(id)}"` : '';
    const reason = this.targetRejection(id), node = this.findInAvailableTargets(id);
    const description = reason === 'target-unavailable' ? node?.metadata.custom.navigationDescription : undefined;
    const hint = reason ? String(description ?? this.ui.t('vfs.transfer.' + reason)) : title;
    return `<div class="vfs-move-modal__folder" style="--level:${level}" data-folder-id="${escapeHTML(id)}">
      <span class="vfs-move-modal__folder-toggle" ${toggle}>${expandable ? this.expandedIds.has(id) ? '▼' : '▶' : ''}</span>
      <span class="vfs-move-modal__folder-icon">${FILE_ICONS.folder}</span>
      <span class="vfs-move-modal__folder-title ${id === this.selectedTargetId ? 'is-selected' : ''}" title="${escapeHTML(hint)}" aria-disabled="${!!reason}">${escapeHTML(title)}</span></div>`;
  }

  /** Preserve the scrolling viewport while updating its contents. */
  private updateDialog(markup: string): void {
    const body = this.container.querySelector<HTMLElement>('.vfs-move-modal__body');
    if (!body) { this.container.innerHTML = markup; return; }
    const scrollTop = body.scrollTop;
    const template = document.createElement('template'); template.innerHTML = markup;
    const next = template.content.querySelector<HTMLElement>('.vfs-move-modal')!;
    body.innerHTML = next.querySelector('.vfs-move-modal__body')!.innerHTML;
    const dialog = body.parentElement!;
    dialog.querySelector('.vfs-move-modal__header')!.textContent = next.querySelector('.vfs-move-modal__header')!.textContent;
    dialog.querySelector('[role="alert"]')?.remove();
    const alert = next.querySelector('[role="alert"]'); if (alert) dialog.insertBefore(alert, dialog.lastElementChild);
    dialog.querySelector('.vfs-move-modal__footer')!.replaceChildren(...next.querySelector('.vfs-move-modal__footer')!.childNodes);
    body.scrollTop = scrollTop;
  }
}
