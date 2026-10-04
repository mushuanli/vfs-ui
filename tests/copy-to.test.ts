// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend, FSError } from '@itookit/vfs-core';
import { createVFSUI, type VFSUIShell } from '../src';

it('copies through the destination picker and keeps a collision visible without deleting the source', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createFile({ parentPath: '/notes', name: 'a.md', content: 'hello', recursive: true });
    await fs.driver.createDirectory({ parentPath: '/', name: 'target' });
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({ sessionListContainer: host, persistence: false, autoSelectFirst: false }, fs) as VFSUIShell;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await ui.start();
        expect(ui.allowsBulkAction('copy', ['/notes'])).toBe(true);
        await ui.runBulkAction('copy', ['/notes']);
        const overlay = document.querySelector<HTMLElement>('.vfs-move-modal-overlay')!;
        expect(overlay.textContent).toContain('复制');
        overlay.querySelector<HTMLElement>('[data-folder-id="/target"] .vfs-move-modal__folder-title')!.click();
        overlay.querySelector<HTMLElement>('[data-action="confirm-move"]')!.click();
        await vi.waitFor(() => expect(overlay.style.display).toBe('none'));
        expect(await fs.driver.readContent('/target/notes/a.md', { encoding: 'utf-8' })).toBe('hello');
        expect(await fs.driver.exists('/notes/a.md')).toBe(true);
        await ui.runBulkAction('copy', ['/notes']);
        overlay.querySelector<HTMLElement>('[data-folder-id="/target"] .vfs-move-modal__folder-title')!.click();
        overlay.querySelector<HTMLElement>('[data-action="confirm-move"]')!.click();
        await vi.waitFor(() => expect(overlay.querySelector('[role="alert"]')?.textContent).toContain('EEXIST'));
        expect(overlay.style.display).toBe('flex');
        expect(await fs.driver.exists('/notes/a.md')).toBe(true);
        overlay.querySelector<HTMLElement>('[data-action="cancel-move"]')!.click();
    } finally { error.mockRestore(); ui.destroy(); host.remove(); await manager.dispose(); }
});

it('loads an independent destination tree and keeps its viewport and main navigation stable', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    await fs.driver.createFile({ parentPath: '/', name: 'a.md', content: 'hello' });
    await fs.driver.createDirectory({ parentPath: '/', name: 'target' });
    const node = (id: string) => ({ id, type: 'directory' as const, version: '1', metadata: {
        title: id, path: id, parentPath: '/', tags: [], createdAt: '', lastModified: '', custom: {},
    } });
    const targets = vi.fn(async (_ids: string[], _mode: string, parent?: string) => parent ? [node('/target/sub')]
        : [node('/target'), { ...node('/missing'), metadata: { ...node('/missing').metadata, custom: { _disabled: true } } }]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const host = document.createElement('div'); document.body.append(host);
    const ui = createVFSUI({ sessionListContainer: host, persistence: false, autoSelectFirst: false,
        transferPolicy: { source: () => true, destination: () => true, targets } }, fs) as VFSUIShell;
    try {
        await ui.start(); await ui.runBulkAction('copy', ['/a.md']);
        const overlay = document.querySelector<HTMLElement>('.vfs-move-modal-overlay')!;
        await vi.waitFor(() => expect(overlay.querySelector('[data-folder-id="/target"]')).not.toBeNull());
        expect(overlay.querySelector('[data-folder-id="root"]')).toBeNull();
        expect(overlay.querySelector('[data-action="toggle-folder"][data-folder-id="/missing"]')).toBeNull();
        expect(overlay.querySelector<HTMLElement>('[data-folder-id="/missing"] .vfs-move-modal__folder-title')!.title).not.toBe('');
        const disabledLog = vi.spyOn(console, 'info');
        overlay.querySelector<HTMLElement>('[data-folder-id="/missing"] .vfs-move-modal__folder-title')!.click();
        expect(disabledLog).toHaveBeenCalledWith('[VFS transfer]', expect.objectContaining({ stage: 'target-disabled',
            destination: '/missing', reason: 'target-unavailable' }));
        disabledLog.mockRestore();
        expect(overlay.querySelector<HTMLButtonElement>('[data-action="confirm-move"]')!.disabled).toBe(true);
        const body = overlay.querySelector<HTMLElement>('.vfs-move-modal__body')!;
        body.scrollTop = 70;
        const before = ui.getSnapshot();
        overlay.querySelector<HTMLElement>('[data-action="toggle-folder"][data-folder-id="/target"]')!.click();
        await vi.waitFor(() => expect(overlay.querySelector('[data-folder-id="/target/sub"]')).not.toBeNull());
        expect(overlay.querySelector('.vfs-move-modal__body')).toBe(body);
        expect(body.scrollTop).toBe(70);
        expect(ui.getSnapshot().activeId).toBe(before.activeId);
        expect(ui.getSnapshot().expandedIds).toEqual(before.expandedIds);
        overlay.querySelector<HTMLElement>('[data-action="toggle-folder"][data-folder-id="/target"]')!.click();
        expect(overlay.querySelector('[data-folder-id="/target/sub"]')).toBeNull();
        expect(body.scrollTop).toBe(70);
        expect(targets).toHaveBeenCalledTimes(2);
        overlay.querySelector<HTMLElement>('[data-action="toggle-folder"][data-folder-id="/target"]')!.click();
        const cause = new FSError('ENOENT', 'Directory not found', 'list', '/missing/path');
        targets.mockRejectedValueOnce(new FSError('ENOENT', 'Source operation failed: getChildren', 'getChildren', undefined, cause));
        overlay.querySelector<HTMLElement>('[data-action="toggle-folder"][data-folder-id="/target/sub"]')!.click();
        await vi.waitFor(() => expect(overlay.querySelector('[role="alert"]')?.textContent).toContain('Directory not found'));
        expect(errors).toHaveBeenCalledWith('[VFS transfer]', expect.objectContaining({
            stage: 'load-targets', mode: 'copy', sources: ['/a.md'], destination: '/target/sub',
            cause: expect.stringContaining('Directory not found'),
        }));
    } finally { errors.mockRestore(); ui.destroy(); host.remove(); await manager.dispose(); }
});
