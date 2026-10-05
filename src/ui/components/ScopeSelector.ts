import { ActionRunner } from '../../interaction/ActionRunner';

export interface ScopeOption { id: string; label: string; disabled?: boolean }
export interface ScopeSelectorOptions {
    label: string;
    select(id: string, signal: AbortSignal): Promise<void>;
    onError?(error: unknown): void;
}
/** Hosts supply scope semantics; the component owns selection, pending state and rollback. */
export class ScopeSelector {
    readonly element = document.createElement('select');
    private readonly actions: ActionRunner;
    private value = '';
    constructor(private readonly options: ScopeSelectorOptions) {
        this.actions = new ActionRunner(options.onError);
        this.element.setAttribute('aria-label', options.label);
        this.element.addEventListener('change', this.change);
    }
    update(items: readonly ScopeOption[], value: string): void {
        this.value = value;
        this.element.replaceChildren(...items.map(item => {
            const option = document.createElement('option'); option.value = item.id;
            option.textContent = item.label; option.disabled = item.disabled ?? false; return option;
        }));
        this.element.value = value;
    }
    private change = (): void => {
        if (this.element.disabled || this.actions.signal.aborted) return;
        const id = this.element.value;
        if (!this.element.selectedOptions[0] || this.element.selectedOptions[0].disabled) return;
        this.element.disabled = true; this.element.setAttribute('aria-busy', 'true');
        void this.actions.run('select-scope', signal => this.options.select(id, signal)).catch(() => {}).finally(() => {
            this.element.value = this.value;
            this.element.disabled = false; this.element.removeAttribute('aria-busy');
        });
    };
    destroy(): void {
        this.actions.destroy(); this.element.removeEventListener('change', this.change);
    }
}
