// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Drawer } from '../src/ui/components/Drawer';

afterEach(() => document.body.replaceChildren());

it('keeps search optional and preserves content, query and focus across host refreshes', () => {
    const change = vi.fn(), release = vi.fn();
    const plain = new Drawer({title: 'Files'});
    expect(plain.element.querySelector('input')).toBeNull();
    const drawer = new Drawer({title: 'Resources', collapsed: true, search: {label: 'Filter', visible: false, onChange: change},
        mountActions: actions => { const button = document.createElement('button'); button.textContent = 'Add'; actions.append(button); return release; }});
    document.body.append(drawer.element);
    const content = document.createElement('p'); content.textContent = 'Saved content'; drawer.content.append(content);
    drawer.element.querySelector<HTMLButtonElement>('button')!.click();
    drawer.setSearchVisible(true); drawer.focusSearch();
    const input = drawer.element.querySelector<HTMLInputElement>('input')!;
    expect(document.activeElement).toBe(input);
    input.value = '中文'; input.dispatchEvent(new Event('input'));
    expect(change).toHaveBeenCalledWith('中文');
    drawer.setCollapsed(true); drawer.setCollapsed(false);
    expect(drawer.content.firstChild).toBe(content); expect(input.value).toBe('中文');
    drawer.setQuery('Updated'); expect(change).toHaveBeenCalledTimes(1);
    drawer.setSearchVisible(false); expect(input.hidden).toBe(true);
    drawer.destroy(); drawer.destroy(); plain.destroy(); expect(release).toHaveBeenCalledOnce();
    input.dispatchEvent(new Event('input')); expect(change).toHaveBeenCalledTimes(1);
});

it('removes its DOM and search listeners even when a mounted action disposer throws', () => {
    const change = vi.fn();
    const drawer = new Drawer({title: 'Resources', search: {label: 'Find', onChange: change},
        mountActions: () => () => {throw new Error('cleanup');}});
    document.body.append(drawer.element);
    const input = drawer.element.querySelector('input')!;
    expect(() => drawer.destroy()).toThrow('cleanup');
    expect(document.body.contains(drawer.element)).toBe(false);
    input.dispatchEvent(new Event('input')); expect(change).not.toHaveBeenCalled();
});
