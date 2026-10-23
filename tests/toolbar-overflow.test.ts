// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI } from '../src';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function fixture(extra: Partial<Parameters<typeof createVFSUI>[0]> = {}) {
    const media = Object.assign(new EventTarget(), { matches: true });
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    const container = document.createElement('div'); document.body.append(container);
    const report = vi.fn(), run = vi.fn(async () => {});
    const ui = createVFSUI({sessionListContainer: container, persistence: false, autoSelectFirst: false,
        onError: report, toolbarOptions: {actions: {import: run, export: run}}, ...extra}, fs);
    await ui.start();
    return {ui, media, container, run, report, async destroy() {ui.destroy(); await manager.dispose();}};
}

it('moves the same import/export controls into the touch menu and restores them after resizing', async () => {
    const f = await fixture();
    try {
        const menu = f.container.querySelector<HTMLDetailsElement>('.vfs-toolbar-overflow')!;
        const button = f.container.querySelector<HTMLButtonElement>('[data-action="import"]')!;
        expect(menu.contains(button)).toBe(true); expect(menu.hidden).toBe(false);
        expect(menu.querySelector('summary svg')).not.toBeNull();
        expect(f.container.querySelectorAll('[data-action="import"]')).toHaveLength(1);
        expect(menu.contains(f.container.querySelector('[data-action="refresh"]'))).toBe(false);
        menu.open = true; button.click();
        await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce()); expect(menu.open).toBe(false);
        f.media.matches = false; f.media.dispatchEvent(new Event('change'));
        expect(menu.hidden).toBe(true); expect(menu.contains(button)).toBe(false);
        expect(f.container.querySelector('[data-action="import"]')).toBe(button);
        f.media.matches = true; f.media.dispatchEvent(new Event('change'));
        expect(menu.contains(button)).toBe(true); expect(menu.hidden).toBe(false);
    } finally {await f.destroy();}
});

it('keeps async action locking and closes the menu with Escape or an outside click', async () => {
    const f = await fixture();
    try {
        let finish!: () => void;
        f.run.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
        const menu = f.container.querySelector<HTMLDetailsElement>('.vfs-toolbar-overflow')!;
        const button = menu.querySelector<HTMLButtonElement>('[data-action="export"]')!;
        menu.open = true; button.click(); button.click();
        await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce()); expect(button.disabled).toBe(true);
        finish(); await vi.waitFor(() => expect(button.disabled).toBe(false));
        menu.open = true; menu.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect(menu.open).toBe(false); expect(document.activeElement).toBe(menu.querySelector('summary'));
        menu.open = true; document.body.click(); expect(menu.open).toBe(false);
        f.ui.setToolbar({hiddenActions: ['import', 'export']});
        expect(menu.hidden).toBe(true); expect(menu.querySelector('button')).toBeNull();
    } finally {await f.destroy();}
});

it('keeps disabled actions disabled in the menu', async () => {
    const f = await fixture();
    try {
        f.ui.setToolbar({items: [{id: 'import', label: 'Load', disabled: true}]});
        const button = f.container.querySelector<HTMLButtonElement>('.vfs-toolbar-overflow [data-action="import"]')!;
        expect(button.disabled).toBe(true); button.click(); expect(f.run).not.toHaveBeenCalled();
    } finally {await f.destroy();}
});

it('shares one navigator menu with host actions on desktop and keeps handlers after toolbar updates', async () => {
    const root = document.createElement('details'), content = document.createElement('div'), host = document.createElement('button');
    host.textContent = 'Project settings'; const run = vi.fn(); host.onclick = run; content.append(host); root.append(content);
    const filter = document.createElement('button'), summary = document.createElement('div');
    const f = await fixture({navigationHeader: {menu: {root, content}, filter, summary}});
    try {
        f.media.matches = false; f.media.dispatchEvent(new Event('change'));
        expect(f.container.querySelectorAll('details.vfs-toolbar-overflow')).toHaveLength(1);
        expect(root.hidden).toBe(false); expect(root.contains(host)).toBe(true);
        expect(root.contains(f.container.querySelector('[data-action="create-file"]'))).toBe(false);
        expect(root.contains(f.container.querySelector('[data-action="refresh"]'))).toBe(true);
        expect(filter.parentElement?.classList.contains('vfs-node-list__header')).toBe(true);
        f.ui.setToolbar({hiddenActions: ['create-directory'], actions: {export: f.run}, secondary: {label: 'Organize', run}});
        expect(root.contains(host)).toBe(true); host.click(); expect(run).toHaveBeenCalledOnce();
        root.querySelector<HTMLButtonElement>('[data-action="secondary"]')!.click(); expect(run).toHaveBeenCalledTimes(2);
        root.querySelector<HTMLButtonElement>('[data-action="export"]')!.click(); await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce());
    } finally {await f.destroy();}
});
