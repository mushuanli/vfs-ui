// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { createVFSUI } from '../src';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); document.body.replaceChildren(); });
async function setup() {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    cleanup.push(() => manager.dispose());
    const fs = await manager.openFileSystem('/browser');
    await fs.driver.createDirectory({ parentPath: '/folder', name: 'child', recursive: true });
    const container = document.createElement('div'); document.body.append(container);
    const shell = createVFSUI({ sessionListContainer: container, persistence: false, hideGitignored: false,
        deferExpansion: true, autoSelectFirst: false, initialState: { expandedFolderIds: new Set(['/folder', '/folder/child']) } }, fs);
    cleanup.push(() => shell.destroy());
    const original = fs.driver.getChildren.bind(fs.driver);
    const list = vi.spyOn(fs.driver, 'getChildren');
    return { shell, list, original, container };
}

it('returns root navigation before reading persisted expanded directories', async () => {
    const { shell, list } = await setup();
    await shell.start();
    expect(list.mock.calls.map(([path]) => path)).toEqual(['/']);
    await vi.waitFor(() => expect(list.mock.calls.map(([path]) => path)).toContain('/folder'));
});

it('cancels deferred restoration when the shell closes', async () => {
    const { shell, list } = await setup();
    await shell.start(); shell.destroy();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(list.mock.calls.map(([path]) => path)).toEqual(['/']);
});

it('does not reopen a folded directory or load descendants after an in-flight restoration', async () => {
    const { shell, list, original } = await setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    list.mockImplementation(async (path, options) => { if (path === '/folder') await gate; return original(path, options); });
    await shell.start();
    await vi.waitFor(() => expect(list.mock.calls.map(([path]) => path)).toContain('/folder'));
    shell.setExpanded('/folder', false); release();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(shell.getSnapshot().expandedIds).not.toContain('/folder');
    expect(list.mock.calls.map(([path]) => path)).not.toContain('/folder/child');
});
