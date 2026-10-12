// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI } from '../src';
import { toolbarHTML } from '../src/ui/components/NodeList/toolbar';
import { createPresentation } from '../src/contracts/presentation';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

async function fixture() {
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createDirectory({ parentPath: '/', name: 'folder' });
    await fs.driver.createFile({ parentPath: '/folder', name: 'note.md', content: 'body' });
    const container = document.createElement('div'); document.body.append(container);
    const onError = vi.fn();
    const shell = createVFSUI({ sessionListContainer: container, persistence: false, autoSelectFirst: false,
        readOnly: true, onError }, fs);
    await shell.start();
    return { shell, fs, container, onError, async destroy() { shell.destroy(); await manager.dispose(); } };
}

it('re-reads expanded directories in a read-only list and coalesces button clicks', async () => {
    const f = await fixture();
    try {
        f.container.querySelector<HTMLElement>('[data-item-id="/folder"] [data-action="toggle-folder"]')!.click();
        await vi.waitFor(() => expect(f.container.querySelector('[data-item-id="/folder/note.md"]')).not.toBeNull());
        const read = vi.spyOn(f.fs.driver, 'getChildren');
        const original = f.shell.refresh.bind(f.shell);
        let release!: () => void;
        const refresh = vi.spyOn(f.shell, 'refresh').mockImplementation(async () => {
            await new Promise<void>(resolve => { release = resolve; }); await original();
        });
        const button = f.container.querySelector<HTMLButtonElement>('[data-action="refresh"]')!;
        expect(button.disabled).toBe(false); button.click(); button.click();
        await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
        expect(button.disabled).toBe(true); release();
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        expect(read.mock.calls.map(([path]) => path)).toContain('/');
        expect(read.mock.calls.map(([path]) => path)).toContain('/folder');
        expect(f.container.querySelector('[data-item-id="/folder/note.md"]')).not.toBeNull();
    } finally { await f.destroy(); }
});

it('reports a failed refresh once and enables retry', async () => {
    const f = await fixture();
    try {
        const error = new Error('Offline');
        const refresh = vi.spyOn(f.shell, 'refresh').mockRejectedValueOnce(error).mockResolvedValue(undefined);
        const button = f.container.querySelector<HTMLButtonElement>('[data-action="refresh"]')!;
        button.click();
        await vi.waitFor(() => expect(f.onError).toHaveBeenCalledWith(error));
        await vi.waitFor(() => expect(button.disabled).toBe(false));
        button.click(); await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
        expect(f.onError).toHaveBeenCalledOnce();
    } finally { await f.destroy(); }
});

it('supports localized refresh icons, hiding and host-owned toolbar content', () => {
    const ui = createPresentation({ locale: 'en', icons: { refresh: '<svg data-custom-refresh></svg>' } });
    const html = toolbarHTML({}, 'File', ui);
    expect(html).toContain('data-action="refresh"'); expect(html).toContain('aria-label="Refresh"');
    expect(html).toContain('data-custom-refresh');
    expect(toolbarHTML({ hiddenActions: ['refresh'] }, 'File')).not.toContain('data-action="refresh"');
    expect(toolbarHTML({ items: [] }, 'File')).toBe('');
    expect(toolbarHTML({ definitions: [] }, 'File')).toBe('');
});
