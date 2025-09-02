import { test, expect, Page } from '@playwright/test';
import { setupApp } from '../../setup/setupApp';

const getObject = async (page: Page, id: string) => {
  return await page.evaluate((id) => window.objectMap.get(id), id);
};

test.beforeEach(async ({ page }) => {
  await setupApp(page, __filename);
});

test.describe('HTML Overlay Editor', () => {
  test('should allow text editing via html overlay', async ({ page }) => {
    const initialText = 'Double-click to edit';
    const newText = 'Hello, world!';

    // 1. Initial state verification
    const textObject = await getObject(page, 'text');
    expect(textObject).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(textObject.text).toBe(initialText);

    // 2. Trigger editing
    await page.mouse.dblclick(100, 60);

    // 3. Verify textarea is created and text object is hidden
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(initialText);
    const textObjectAfterEditStart = await getObject(page, 'text');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(textObjectAfterEditStart.visible).toBe(false);

    // 4. Edit text
    await textarea.fill(newText);
    await expect(textarea).toHaveValue(newText);

    // 5. Commit changes by blurring
    await textarea.blur();

    // 6. Verify textarea is gone and text object is updated
    await expect(textarea).not.toBeVisible();
    const textObjectAfterEditEnd = await getObject(page, 'text');
    expect(textObjectAfterEditEnd).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(textObjectAfterEditEnd.visible).toBe(true);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    expect(textObjectAfterEditEnd.text).toBe(newText);
  });
});
