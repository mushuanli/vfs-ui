// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFSUI, createVFSBrowser, type BrowserSource } from '../src';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';

const close: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of close.splice(0).reverse()) await cleanup(); document.body.replaceChildren(); });
function container() { const root = document.createElement('div'); document.body.append(root); return root; }

it('keeps translations and action icons local to each browser instance', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() }); close.push(() => manager.dispose());
    const fs = await manager.openFileSystem('/'); await fs.driver.createFile({ name: 'hello.md', content: '' });
    const english = container(), chinese = container(), trace = vi.fn(async (_label: string, work: () => Promise<unknown>) => work());
    const first = createVFSUI({ sessionListContainer: english, autoSelectFirst: false,
        presentation: { locale: 'en', icons: { export: '<svg data-custom-export="true"></svg>',
            addFile: '<svg data-custom-add-file="true"></svg>', addFolder: '<svg data-custom-add-folder="true"></svg>' }, trace } }, fs);
    const second = createVFSUI({ sessionListContainer: chinese, autoSelectFirst: false }, fs);
    close.push(() => first.destroy(), () => second.destroy()); await first.start(); await second.start();
    expect(english.querySelector('[data-action="create-directory"]')!.textContent).toContain('Folder');
    expect(chinese.querySelector('[data-action="create-directory"]')!.textContent).toContain('目录');
    expect(english.querySelector('[data-custom-export]')).not.toBeNull();
    expect(english.querySelector('[data-action="create-file"] [data-custom-add-file]')).not.toBeNull();
    expect(english.querySelector('[data-action="create-directory"] [data-custom-add-folder]')).not.toBeNull();
    expect(chinese.querySelector('[data-custom-export]')).toBeNull();
    expect(chinese.querySelector('[data-custom-add-file]')).toBeNull();
    expect(chinese.querySelector('[data-custom-add-folder]')).toBeNull();
    expect(trace.mock.calls.map(call => call[0])).toEqual(['vfsUi.loadData', 'vfsUi.restoreExpansion']);
});

it('accepts a user data source and presentation without host packages or a filesystem', async () => {
    const source: BrowserSource = {
        get: async () => undefined,
        children: async () => [{ id: 'opaque', parentId: null, kind: 'file', label: 'Example' }],
        subscribe: () => () => {},
    };
    const root = container(), browser = createVFSBrowser({ container: root, source,
        presentation: { translate: key => `host:${key}`, fileIcon: () => '<svg data-user-file="true"></svg>' } });
    close.push(() => browser.destroy()); await browser.start();
    expect(root.querySelector('[data-user-file]')).not.toBeNull();
    expect(root.querySelector('[data-action="item-menu"]')!.getAttribute('aria-label')).toBe('host:vfs.columns.more');
});

it('renders icon-only menu actions with accessible labels and falls back to text when no icon exists', async () => {
    const {createContextMenuHTML} = await import('../src/ui/components/NodeList/templates');
    const host = document.createElement('div'); host.innerHTML = createContextMenuHTML([{id: 'create', label: 'Create "file"', iconHTML: '<svg></svg>', iconOnly: true}]);
    const button = host.querySelector('button')!;
    expect(button.textContent).toBe(''); expect(button.getAttribute('aria-label')).toBe('Create "file"'); expect(button.title).toBe('Create "file"'); expect(button.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.vfs-context-menu--icons')).not.toBeNull();
    host.innerHTML = createContextMenuHTML([{id: 'fallback', label: 'Fallback', iconOnly: true}]);
    expect(host.querySelector('button')?.textContent).toBe('Fallback');
});

it('shows host semantic icons even with badges and tags hidden, and escapes labels and icon text', async () => {
    const {createFileItemHTML} = await import('../src/ui/components/NodeList/items/itemTemplates');
    const markup = createFileItemHTML({id: '/c', type: 'file', icon: '', version: '1',
        metadata: {title: 'Connection', path: '/c', tags: [], parentPath: '/', createdAt: '', lastModified: '', custom: {}},
        presentation: {indicators: [{icon: '<unsafe>', label: 'Image "generation"'}]}},
        {uiSettings: {showTags: false, showBadges: false}, searchQueries: []} as never, {readOnly: false} as never);
    const root = container(); root.innerHTML = markup;
    expect(root.querySelector('.vfs-node-item__semantic-icon')?.textContent).toBe('<unsafe>');
    expect(root.querySelector('[role=img]')?.getAttribute('aria-label')).toBe('Image "generation"');
    expect(root.querySelector('unsafe')).toBeNull();
});
