export interface DrawerSearchOptions {
    label: string;
    placeholder?: string;
    visible?: boolean;
    query?: string;
    /** Filtering and asynchronous request ordering belong to the host. */
    onChange(query: string): void;
}

export interface DrawerOptions {
    title: string;
    showHeader?: boolean;
    collapsible?: boolean;
    collapsed?: boolean;
    scrollMode?: 'content' | 'host';
    search?: false | DrawerSearchOptions;
    onToggle?(collapsed: boolean): void;
    /** Mount trusted host controls and return their disposer. */
    mountActions?(container: HTMLElement): void | (() => void);
}

/** A presentation-only section; it never reads a filesystem or owns host data. */
export class Drawer {
    readonly element = document.createElement('section');
    readonly content = document.createElement('div');
    private readonly body = document.createElement('div');
    private readonly title = document.createElement('button');
    private readonly abort = new AbortController();
    private search?: HTMLInputElement;
    private releaseActions?: () => void;
    private closed = false;
    constructor(private readonly options: DrawerOptions) {
        this.element.className = 'vfs-drawer'; this.element.setAttribute('aria-label', options.title);
        this.element.classList.toggle('vfs-drawer--host-scroll', options.scrollMode === 'host');
        this.body.className = 'vfs-drawer__body'; this.content.className = 'vfs-drawer__content';
        try {
            if (options.showHeader !== false) this.header();
            if (options.search) this.addSearch(options.search);
            this.body.append(this.content); this.element.append(this.body);
            this.setCollapsed(options.collapsed ?? false);
        } catch (error) { this.destroy(); throw error; }
    }
    private header(): void {
        const header = document.createElement('div'); header.className = 'vfs-drawer__header';
        this.title.type = 'button'; this.title.className = 'vfs-drawer__title';
        const label = document.createElement('span'); label.className = 'vfs-drawer__label'; label.textContent = this.options.title;
        this.title.append(label); this.title.title = this.options.title; this.title.disabled = this.options.collapsible === false;
        this.title.addEventListener('click', () => {
            const collapsed = !this.body.hidden; this.setCollapsed(collapsed); this.options.onToggle?.(collapsed);
        }, {signal: this.abort.signal});
        const actions = document.createElement('div'); actions.className = 'vfs-drawer__actions';
        header.append(this.title, actions); this.element.append(header);
        this.releaseActions = this.options.mountActions?.(actions) ?? undefined;
    }
    private addSearch(options: DrawerSearchOptions): void {
        const input = document.createElement('input'); input.type = 'search'; input.className = 'vfs-drawer__search';
        input.placeholder = options.placeholder ?? options.label; input.setAttribute('aria-label', options.label);
        input.value = options.query ?? ''; input.hidden = options.visible === false;
        input.addEventListener('input', () => options.onChange(input.value), {signal: this.abort.signal});
        this.search = input; this.body.append(input);
    }
    setCollapsed(collapsed: boolean): void {
        this.body.hidden = this.options.collapsible === false ? false : collapsed;
        this.element.classList.toggle('is-collapsed', this.body.hidden);
        this.title.setAttribute('aria-expanded', String(!this.body.hidden));
    }
    setSearchVisible(visible: boolean): void { if (this.search) this.search.hidden = !visible; }
    setQuery(query: string): void { if (this.search) this.search.value = query; }
    focusSearch(): void { if (this.search && !this.search.hidden && !this.body.hidden) this.search.focus(); }
    destroy(): void {
        if (this.closed) return;
        this.closed = true; this.abort.abort();
        try { this.releaseActions?.(); } finally { this.element.remove(); }
    }
}
