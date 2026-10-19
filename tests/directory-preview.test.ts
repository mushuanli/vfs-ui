// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, type VFSUIShell } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([false, true])('restores projected children after reloading with deferred expansion %s', async deferExpansion => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({parentPath: '/', name: 'one'});
    await fs.driver.createDirectory({parentPath: '/one', name: 'container'});
    await fs.driver.createFile({parentPath: '/one/container', name: 'entry.txt', content: ''});
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({sessionListContainer: host, autoSelectFirst: false, deferExpansion,
        persistence: {load: () => ({expandedFolderIds: ['/one']}), save() {}},
        navigationChildren: node => (node.children ?? []).filter(child => child.id.endsWith('/container')).map(child => child.id)}, fs) as VFSUIShell;
    try {
        await ui.start();
        await vi.waitFor(() => expect(ui.getNode('/one/container')?.children?.map(item => item.id)).toEqual(['/one/container/entry.txt']));
        expect(ui.getSnapshot().expandedIds).toContain('/one');
        expect(ui.getSnapshot().expandedIds).not.toContain('/one/container');
    } finally {ui.destroy(); await manager.dispose();}
});

it('loads projected containers in a single list on expansion and refresh without reading collapsed branches', async () => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    for (const parent of ['one', 'two']) {
        await fs.driver.createDirectory({parentPath: '/', name: parent});
        await fs.driver.createDirectory({parentPath: '/' + parent, name: 'container'});
        await fs.driver.createFile({parentPath: '/' + parent + '/container', name: 'entry.txt', content: ''});
    }
    const host = document.createElement('div'); document.body.append(host);
    const reads = vi.spyOn(fs.driver, 'getChildren');
    const ui = createVFSUI({sessionListContainer: host, persistence: false, autoSelectFirst: false,
        navigationChildren: node => (node.children ?? []).filter(child => child.id.endsWith('/container')).map(child => child.id)}, fs) as VFSUIShell;
    try {
        await ui.start();
        host.querySelector<HTMLElement>('[data-item-id="/one"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(ui.getNode('/one/container')?.children).toHaveLength(1));
        reads.mockClear(); await ui.refresh();
        expect(ui.getNode('/one/container')?.children).toHaveLength(1);
        expect(ui.getSnapshot().expandedIds).toContain('/one');
        expect(ui.getSnapshot().expandedIds).not.toContain('/one/container');
        expect(reads.mock.calls.some(([path]) => path === '/one/container')).toBe(true);
        expect(reads.mock.calls.some(([path]) => path.startsWith('/two'))).toBe(false);
    } finally {ui.destroy(); await manager.dispose();}
});

it('limits only presentation, keeps actions after toggling, reveals selection and searches hidden children', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }), fs = await manager.openFileSystem('/');
    for (const name of ['one', 'two']) await fs.driver.createDirectory({ parentPath: '/', name });
    for (let i = 0; i < 8; i++) await fs.driver.createFile({ parentPath: '/one', name: `item-${i}.txt`, content: '' });
    const host = document.createElement('div'); document.body.append(host);
    const action = vi.fn(async () => {});
    const ui = createVFSUI({ sessionListContainer: host, scopeId: 'preview-test', persistence: false, autoSelectFirst: false,
        defaultUiSettings: { sortBy: 'title' }, directoryPreview: item => item.id === '/one' ? 3 : undefined,
        directoryAction: { label: 'Add child', visible: () => true, run: action } }, fs) as VFSUIShell;
    const rows = () => host.querySelectorAll('[data-item-id="/one"] [data-item-type="file"]');
    const toggle = () => host.querySelector<HTMLButtonElement>('[data-preview-id="/one"]')!;
    try {
        await ui.start(); await ui.expandPath('/one');
        await vi.waitFor(() => expect(rows()).toHaveLength(3));
        expect((await fs.driver.getChildren('/one')).length).toBe(8);
        toggle().click(); expect(rows()).toHaveLength(8);
        expect(host.querySelector('.vfs-directory-item__children--preview-expanded')).not.toBeNull();
        expect(document.activeElement).toBe(toggle());
        const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-item-id="/one"] button')];
        buttons.find(button => button.textContent === 'Add child')!.click();
        await vi.waitFor(() => expect(action).toHaveBeenCalledWith('/one'));
        toggle().click(); expect(rows()).toHaveLength(3);
        expect(host.querySelector('.vfs-directory-item__children--preview-expanded')).toBeNull();
        await ui.selectPath('/one/item-7.txt');
        await vi.waitFor(() => expect(host.querySelector('[data-item-id="/one/item-7.txt"]')).not.toBeNull());
        expect(rows()).toHaveLength(4);
        const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
        search.value = 'item-6'; search.dispatchEvent(new Event('input', { bubbles: true }));
        await vi.waitFor(() => expect(host.querySelector('[data-item-id="/one/item-6.txt"]')).not.toBeNull());
        expect(host.querySelector('[data-preview-id]')).toBeNull();
    } finally { ui.destroy(); await manager.dispose(); }
});

it('loads a projected child group without expanding it or collapsing another directory', async () => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    for (const name of ['files', 'group']) {
        await fs.driver.createDirectory({parentPath: '/', name});
        await fs.driver.createFile({parentPath: '/' + name, name: 'entry.txt', content: ''});
    }
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({sessionListContainer: host, persistence: false, autoSelectFirst: false}, fs) as VFSUIShell;
    try {
        await ui.start(); await ui.expandPath('/files'); await ui.loadDirectory('/group');
        expect(ui.getNode('/group')?.children?.map(item => item.id)).toEqual(['/group/entry.txt']);
        expect(ui.getSnapshot().expandedIds).toContain('/files'); expect(ui.getSnapshot().expandedIds).not.toContain('/group');
        expect(host.querySelector('[data-item-id="/files/entry.txt"]')).not.toBeNull();
    } finally {ui.destroy(); await manager.dispose();}
});

it('propagates a directory load failure and allows retry without changing expanded branches', async () => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    for (const name of ['files', 'group']) {
        await fs.driver.createDirectory({parentPath: '/', name});
        await fs.driver.createFile({parentPath: '/' + name, name: 'entry.txt', content: ''});
    }
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({sessionListContainer: host, persistence: false, autoSelectFirst: false}, fs) as VFSUIShell;
    try {
        await ui.start(); await ui.expandPath('/files');
        vi.spyOn(fs.driver, 'getChildren').mockRejectedValueOnce(new Error('Directory unavailable'));
        await expect(ui.loadDirectory('/group')).rejects.toThrow('Directory unavailable');
        expect(ui.getNode('/group')?.children).toBeUndefined();
        await ui.loadDirectory('/group');
        expect(ui.getNode('/group')?.children?.map(item => item.id)).toEqual(['/group/entry.txt']);
        expect(ui.getSnapshot().expandedIds).toContain('/files'); expect(ui.getSnapshot().expandedIds).not.toContain('/group');
    } finally {ui.destroy(); await manager.dispose();}
});

it('keeps a strict sorted preview and opens overflow without expanding inline, including during search and selection', async () => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({parentPath: '/', name: 'files'});
    for (let i = 0; i < 16; i++) await fs.driver.createFile({parentPath: '/files', name: `item-${i}.txt`, content: ''});
    const host = document.createElement('div'); document.body.append(host);
    const open = vi.fn(async () => {});
    const ui = createVFSUI({sessionListContainer: host, persistence: false, autoSelectFirst: false,
        sort: {by: 'title', direction: 'desc'}, directoryPreview: node => node.id === '/files'
            ? {limit: 15, moreLabel: 'More files', open} : undefined}, fs) as VFSUIShell;
    const rows = () => [...host.querySelectorAll<HTMLElement>('[data-item-id="/files"] [data-item-type="file"]')];
    const more = () => host.querySelector<HTMLButtonElement>('[data-preview-id="/files"]');
    try {
        await ui.start(); await ui.expandPath('/files');
        expect(rows()).toHaveLength(15); expect(rows()[0].dataset.itemId).toBe('/files/item-15.txt');
        expect(more()!.textContent).toBe('More files'); expect(more()!.hasAttribute('aria-expanded')).toBe(false);
        more()!.click(); await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
        expect(open).toHaveBeenCalledWith(expect.objectContaining({id: '/files'})); expect(rows()).toHaveLength(15);
        await ui.selectPath('/files/item-0.txt'); expect(rows()).toHaveLength(15);
        expect(rows().some(row => row.dataset.itemId === '/files/item-0.txt')).toBe(false);
        ui.setQuery('item'); expect(rows()).toHaveLength(15); expect(more()).not.toBeNull();
        ui.setQuery('item-0'); expect(rows()).toHaveLength(1); expect(rows()[0].dataset.itemId).toBe('/files/item-0.txt');
        expect(more()).toBeNull(); ui.setQuery('');
        expect(ui.getNode('/files')!.children).toHaveLength(16); expect(await fs.driver.getChildren('/files')).toHaveLength(16);
        await fs.driver.delete(['/files/item-0.txt']); await ui.refresh();
        expect(rows()).toHaveLength(15); expect(more()).toBeNull();
    } finally {ui.destroy(); await manager.dispose();}
});

it('deduplicates overflow navigation and enables a replaced control after a reported failure', async () => {
    const {manager} = await createVFS({rootBackend: new MemoryBackend()}), fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({parentPath: '/', name: 'files'});
    for (let i = 0; i < 2; i++) await fs.driver.createFile({parentPath: '/files', name: `item-${i}.txt`, content: ''});
    const host = document.createElement('div'); document.body.append(host);
    let fail!: (error: Error) => void;
    const open = vi.fn(() => new Promise<void>((_resolve, reject) => {fail = reject;})), onError = vi.fn();
    const ui = createVFSUI({sessionListContainer: host, persistence: false, autoSelectFirst: false, onError,
        directoryPreview: () => ({limit: 1, moreLabel: 'More files', open})}, fs) as VFSUIShell;
    const more = () => host.querySelector<HTMLButtonElement>('[data-preview-id="/files"]')!;
    try {
        await ui.start(); await ui.expandPath('/files');
        more().click(); more().click(); await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
        expect(more().disabled).toBe(true); ui.refreshList(); expect(more().disabled).toBe(true);
        fail(new Error('Navigation failed'));
        await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(more().disabled).toBe(false));
        expect(host.querySelectorAll('[data-item-id="/files"] [data-item-type="file"]')).toHaveLength(1);
    } finally {ui.destroy(); await manager.dispose();}
});
