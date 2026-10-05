// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, ScopeSelector, type VFSActionDefinition } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function fixture(definitions: VFSActionDefinition[], onError = vi.fn()) {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/', name: 'target' });
    await fs.driver.createDirectory({ parentPath: '/', name: 'other' });
    const container = document.createElement('div'); document.body.append(container);
    const ui = createVFSUI({ sessionListContainer: container, persistence: false, autoSelectFirst: false,
        toolbarOptions: { definitions }, onError }, fs);
    await ui.start();
    return { ui, container, async destroy() { ui.destroy(); await manager.dispose(); } };
}

it('shares icons and one async execution across toolbar and menu while preserving each target', async () => {
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const run = vi.fn(async () => pending);
    const f = await fixture([{ id: 'archive', label: 'Archive', iconHTML: '<svg></svg>', placement: 'both', run }]);
    try {
        f.ui.setSelection(['/target']);
        const button = f.container.querySelector<HTMLButtonElement>('[data-action="archive"]')!;
        expect(button.querySelector('svg')).not.toBeNull(); button.click();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
        expect(run.mock.calls[0]).toEqual([expect.objectContaining({ origin: 'toolbar', selectedIds: ['/target'] }), expect.any(AbortSignal)]);
        f.ui.setSelection(['/target', '/other']);
        await f.ui.showItemMenu(new MouseEvent('contextmenu'), '/target');
        const menu = document.querySelector<HTMLButtonElement>('.vfs-context-menu [data-action="archive"]')!;
        expect(menu.querySelector('svg')).not.toBeNull(); menu.click();
        await Promise.resolve(); expect(run).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.vfs-context-menu')).not.toBeNull();
        complete(); await vi.waitFor(() => expect(document.querySelector('.vfs-context-menu')).toBeNull());
        await f.ui.showItemMenu(new MouseEvent('contextmenu'), '/target');
        document.querySelector<HTMLButtonElement>('.vfs-context-menu [data-action="archive"]')!.click();
        await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
        expect(run.mock.calls[1]).toEqual([expect.objectContaining({ origin: 'menu', selectedIds: ['/target'], parentPath: '/target' }), expect.any(AbortSignal)]);
    } finally { complete(); await f.destroy(); }
});

it('rechecks disabled state before execution and reports an awaited failure once', async () => {
    let disabled = false;
    const error = new Error('Archive failed'), report = vi.fn(), run = vi.fn(async () => { throw error; });
    const f = await fixture([{ id: 'archive', label: 'Archive', placement: 'both', disabled: () => disabled, run }], report);
    try {
        const button = f.container.querySelector<HTMLButtonElement>('[data-action="archive"]')!;
        button.click(); disabled = true;
        await vi.waitFor(() => expect(button.disabled).toBe(true)); expect(run).not.toHaveBeenCalled();
        disabled = false; await f.ui.refresh();
        await f.ui.showItemMenu(new MouseEvent('contextmenu'), '/target');
        document.querySelector<HTMLButtonElement>('.vfs-context-menu [data-action="archive"]')!.click();
        await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error)); expect(report).toHaveBeenCalledTimes(1);
    } finally { await f.destroy(); }
});

it('keeps scope selection pending, restores failed choices and accepts host updates on success', async () => {
    let reject!: (error: Error) => void;
    const report = vi.fn(), select = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const scope = new ScopeSelector({ label: 'Scope', select, onError: report }); document.body.append(scope.element);
    const items = [{ id: 'all', label: 'All' }, { id: 'project', label: 'Project' }]; scope.update(items, 'all');
    scope.element.value = 'project'; scope.element.dispatchEvent(new Event('change'));
    expect(scope.element.disabled).toBe(true); scope.element.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    reject(new Error('Offline')); await vi.waitFor(() => expect(scope.element.disabled).toBe(false));
    expect(scope.element.value).toBe('all'); expect(report).toHaveBeenCalledTimes(1);
    select.mockImplementation(async () => { scope.update(items, 'project'); });
    scope.element.value = 'project'; scope.element.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(scope.element.disabled).toBe(false)); expect(scope.element.value).toBe('project');
    scope.destroy(); scope.element.dispatchEvent(new Event('change')); expect(select).toHaveBeenCalledTimes(2);
});
