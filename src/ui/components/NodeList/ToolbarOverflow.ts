import type { VFSPresentation } from '../../../contracts/presentation';

/** Move existing actions into a touch menu without duplicating their state or handlers. */
export class ToolbarOverflow {
    private readonly menu = document.createElement('details');
    private readonly summary = document.createElement('summary');
    private readonly items = document.createElement('div');
    private readonly abort = new AbortController();
    private readonly media = window.matchMedia?.('(max-width: 768px), (pointer: coarse)');
    private records: Array<{ button: HTMLButtonElement; place: Comment }> = [];

    constructor(private readonly controls: HTMLElement, ui: VFSPresentation) {
        this.menu.className = 'vfs-toolbar-overflow'; this.menu.hidden = true;
        this.summary.innerHTML = ui.icon('more');
        this.summary.title = ui.t('vfs.columns.more'); this.summary.setAttribute('aria-label', ui.t('vfs.columns.more'));
        this.items.className = 'vfs-toolbar-overflow__items'; this.menu.append(this.summary, this.items);
        const signal = this.abort.signal;
        this.media?.addEventListener('change', () => this.layout(), { signal });
        document.addEventListener('click', event => { if (!this.menu.contains(event.target as Node)) this.menu.open = false; }, { signal });
        this.menu.addEventListener('click', event => { if ((event.target as Element).closest('button[data-action]')) this.menu.open = false; }, { signal });
        this.menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); this.menu.open = false; this.summary.focus(); }
        }, { signal });
        this.refresh();
    }

    refresh(): void {
        this.records = [];
        this.items.replaceChildren();
        for (const button of this.controls.querySelectorAll<HTMLButtonElement>('[data-action="import"], [data-action="export"]')) {
            const place = document.createComment('toolbar action'); button.before(place);
            this.records.push({ button, place });
        }
        (this.controls.querySelector('.vfs-node-list__toolbar-group--transfer') ?? this.controls).append(this.menu);
        this.layout();
    }

    private layout(): void {
        this.menu.open = false;
        for (const {button, place} of this.records) {
            if (this.media?.matches) this.items.append(button);
            else place.after(button);
        }
        this.syncVisibility();
    }

    syncVisibility(): void {
        this.menu.hidden = !this.media?.matches || !this.records.some(({button}) => !button.hidden);
        if (this.menu.hidden) this.menu.open = false;
    }

    destroy(): void { this.abort.abort(); this.menu.remove(); this.records = []; }
}
