// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI, createVFSBrowser, VFS_DOM_EVENTS, type VFSUIOptions, type BrowserNode } from '../src';
const appearanceCSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/list-appearance.css'), 'utf8');

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const close of cleanups.splice(0).reverse()) await close();
    document.body.replaceChildren(); vi.restoreAllMocks();
});

async function fixture(options: Partial<VFSUIOptions> = {}) {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    cleanups.push(() => manager.dispose());
    const fs = await manager.openFileSystem('/');
    await fs.driver.createFile({ name: 'note.md', content: '' });
    for (const name of ['one', 'two']) await fs.driver.createDirectory({ name });
    const host = document.createElement('section'), root = document.createElement('div');
    host.append(root); document.body.append(host);
    const ui = createVFSUI({ sessionListContainer: root, persistence: false, autoSelectFirst: false, ...options }, fs);
    cleanups.push(() => ui.destroy()); await ui.start();
    return { ui, root, host };
}

it('owns timestamp visibility and inline creation styling without a host stylesheet', async () => {
    const style = document.createElement('style'); style.textContent = appearanceCSS; document.body.append(style);
    const hidden = await fixture({ appearance: { showTimestamp: false }, rowCreation: { visible: () => true, run: vi.fn(async () => {}) } });
    const normal = await fixture();
    expect(hidden.root.classList.contains('vfs-ui--hide-timestamps')).toBe(true);
    expect(style.sheet?.cssRules.length).toBeGreaterThan(0);
    expect(getComputedStyle(hidden.root.querySelector('.vfs-node-item__timestamp')!).display).toBe('none');
    expect(getComputedStyle(normal.root.querySelector('.vfs-node-item__timestamp')!).display).not.toBe('none');
    expect(getComputedStyle(hidden.root.querySelector('.vfs-node-item__creation')!).display).toBe('inline-flex');
    expect(getComputedStyle(hidden.root.querySelector('.vfs-node-item__creation button')!).opacity).toBe('1');
});

it('owns menu visibility per instance while retaining the host action callback', async () => {
    const style = document.createElement('style'); style.textContent = appearanceCSS; document.body.append(style);
    const project = (nodes: import('../src').VFSNodeUI[]) => nodes.map(node => ({ ...node,
        metadata: { ...node.metadata, custom: { ...node.metadata.custom, navigationMenu: true } } }));
    const hover = await fixture({ appearance: { menuVisibility: 'hover' }, listItems: project });
    const always = await fixture({ appearance: { menuVisibility: 'always' }, listItems: project });
    const button = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-item-id="/one"] [data-action="item-menu"]')!;
    expect(getComputedStyle(button(hover.root)).opacity).toBe('0');
    expect(getComputedStyle(button(always.root)).opacity).toBe('1');
    button(always.root).click();
    expect(document.querySelector('.vfs-context-menu')).not.toBeNull();
});

it('renders host-defined drawers and notifies every accordion expansion change once', async () => {
    const f = await fixture({ listItems: nodes => nodes.map(node => node.type === 'directory'
        ? { ...node, presentation: { layout: 'drawer', titleLayout: 'stacked' } } : node) });
    const changes = vi.fn(), dom = vi.fn();
    f.ui.on('directoryExpansionChanged', changes);
    f.host.addEventListener(VFS_DOM_EVENTS.directoryExpansionChanged, dom);
    const header = (id: string) => f.root.querySelector<HTMLElement>(`[data-item-id="${id}"] .vfs-directory-item__header`)!;
    header('/one').click();
    expect(changes).toHaveBeenLastCalledWith({ id: '/one', expanded: true });
    expect(f.ui.getSnapshot().activeId).toBeNull();
    header('/two').click();
    expect(changes.mock.calls.map(([change]) => change)).toEqual([
        { id: '/one', expanded: true }, { id: '/one', expanded: false }, { id: '/two', expanded: true },
    ]);
    f.ui.setExpanded('/two', false); f.ui.setExpanded('/two', false);
    expect(changes).toHaveBeenCalledTimes(4); expect(dom).toHaveBeenCalledTimes(4);
    expect((dom.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: '/one', expanded: true });
    expect(header('/two').getAttribute('aria-expanded')).toBe('false');
    expect(header('/two').closest('.vfs-directory-item--stacked-title')).not.toBeNull();
});

it('reports user activation independently of selection, folding, and programmatic reveal', async () => {
    const f = await fixture(), activate = vi.fn(), dom = vi.fn();
    f.ui.on('resourceActivated', activate); f.host.addEventListener(VFS_DOM_EVENTS.resourceActivated, dom);
    await f.ui.selectPath('/note.md'); expect(activate).not.toHaveBeenCalled();
    const click = () => f.root.querySelector<HTMLElement>('[data-item-id="/note.md"] [data-action="select-and-open"]')!.click();
    click(); click(); expect(activate).toHaveBeenCalledTimes(2); expect(dom).toHaveBeenCalledTimes(2);
    expect((dom.mock.calls[0][0] as CustomEvent).detail.item.id).toBe('/note.md');
    f.ui.setSelection(['/note.md']);
    f.root.querySelector<HTMLElement>('[data-item-id="/one"] [data-action="toggle-folder"]')!.click();
    expect(activate).toHaveBeenCalledTimes(2);
});

it('exposes drawer expansion callbacks and snapshots for opaque browser sources', async () => {
    const entries: BrowserNode[] = [{ id: 'group:one', parentId: null, kind: 'group', label: 'Group', presentation: 'drawer', titleLayout: 'stacked' }];
    const root = document.createElement('div'); document.body.append(root);
    const changed = vi.fn(), browser = createVFSBrowser({ container: root, onExpansionChange: changed,
        source: { get: async id => entries.find(node => node.id === id), children: async parent => parent === null ? entries : [], subscribe: () => () => {} } });
    cleanups.push(() => browser.destroy()); await browser.start();
    browser.expand('group:one');
    expect(changed).toHaveBeenCalledWith({ id: 'group:one', expanded: true });
    expect(browser.getSnapshot().expandedIds).toEqual(['group:one']);
    browser.expand('group:one', false);
    expect(changed).toHaveBeenLastCalledWith({ id: 'group:one', expanded: false });
});
