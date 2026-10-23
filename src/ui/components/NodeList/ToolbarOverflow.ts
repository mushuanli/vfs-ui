import type { VFSPresentation } from '../../../contracts/presentation';
import type { VFSNavigationHeader } from '../../../contracts/components';

/** Move the original actions so pending, permission and event state stay intact. */
export class ToolbarOverflow {
    private readonly menu: HTMLDetailsElement;
    private readonly summary: HTMLElement;
    private readonly content: HTMLElement;
    private readonly items = document.createElement('div');
    private readonly abort = new AbortController();
    private readonly media = window.matchMedia?.('(max-width: 768px), (pointer: coarse)');
    private records: Array<{ button: HTMLButtonElement; place: Comment }> = [];

    constructor(private readonly controls: HTMLElement, ui: VFSPresentation, private readonly navigation?: VFSNavigationHeader) {
        this.menu = navigation?.menu?.root ?? document.createElement('details');
        this.content = navigation?.menu?.content ?? document.createElement('div');
        this.summary = this.menu.querySelector('summary') ?? document.createElement('summary');
        this.menu.classList.add('vfs-toolbar-overflow'); this.menu.hidden = true;
        this.summary.innerHTML = ui.icon('more');
        this.summary.title = ui.t('vfs.columns.more'); this.summary.setAttribute('aria-label', this.summary.title);
        this.content.classList.add('vfs-toolbar-overflow__items');
        this.items.className = 'vfs-toolbar-overflow__actions'; this.content.prepend(this.items);
        this.menu.replaceChildren(this.summary, this.content);
        const signal = this.abort.signal;
        this.media?.addEventListener('change', () => this.layout(), { signal });
        document.addEventListener('click', event => { if (!this.menu.contains(event.target as Node)) this.menu.open = false; }, { signal });
        this.menu.addEventListener('click', event => { if ((event.target as Element).closest('button')) this.menu.open = false; }, { signal });
        this.menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); this.menu.open = false; this.summary.focus(); }
        }, { signal });
        this.refresh();
    }

    refresh(): void {
        this.records = []; this.items.replaceChildren();
        const primary = this.navigation?.primaryAction ?? 'create-file';
        for (const button of this.controls.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
            if (this.menu.contains(button)) continue;
            const action = button.dataset.action;
            if (this.navigation ? action === primary : action !== 'import' && action !== 'export') continue;
            const place = document.createComment('toolbar action'); button.before(place);
            this.records.push({ button, place });
        }
        (this.navigation ? this.controls : this.controls.querySelector('.vfs-node-list__toolbar-group--transfer') ?? this.controls).append(this.menu);
        this.layout();
    }

    private layout(): void {
        this.menu.open = false;
        for (const {button, place} of this.records) {
            if (this.navigation || this.media?.matches) this.items.append(button);
            else place.after(button);
        }
        this.syncVisibility();
    }

    syncVisibility(): void {
        const visible = [...this.content.querySelectorAll<HTMLButtonElement>('button')].some(button => !button.hidden);
        this.menu.hidden = !(this.navigation || this.media?.matches) || !visible;
        if (this.menu.hidden) this.menu.open = false;
    }

    destroy(): void { this.abort.abort(); this.menu.remove(); this.records = []; }
}
