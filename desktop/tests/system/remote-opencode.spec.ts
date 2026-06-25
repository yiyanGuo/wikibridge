import { expect, test } from '@playwright/test';
import { prepareSystemTestPage, setConfirmResult } from './test-utils';

test('adds and opens a remote OpenCode knowledge base', async ({ page }) => {
  await prepareSystemTestPage(page);

  await page.getByRole('button', { name: /消费端/ }).click();
  await expect(page.getByText('添加消费端公网地址后可在 App 内查看。')).toBeVisible();

  await page.getByLabel('名称').fill('团队知识库');
  await page.getByLabel('分享链接').fill('https://wiki.example.test/share/');
  await page.getByRole('button', { name: '添加' }).click();

  await expect(page.getByText('远程知识库已添加')).toBeVisible();
  await expect(page.locator('.remote-card').filter({ hasText: '团队知识库' })).toBeVisible();
  await expect(page.locator('iframe.opencode-frame')).toHaveAttribute('src', 'https://wiki.example.test/share');
});

test('normalizes duplicate remote OpenCode links and updates the existing card', async ({ page }) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: 'remote-1',
        name: '旧名称',
        url: 'https://wiki.example.test/share',
        status: 'ready',
        addedAt: 1,
        lastOpenedAt: 1
      }
    ]
  });

  await page.getByRole('button', { name: /消费端/ }).click();
  await page.getByLabel('名称').fill('新名称');
  await page.getByLabel('分享链接').fill('https://wiki.example.test/share/');
  await page.getByRole('button', { name: '添加' }).click();

  await expect(page.locator('.remote-card')).toHaveCount(1);
  await expect(page.locator('.remote-card').filter({ hasText: '新名称' })).toBeVisible();
  await expect(page.locator('.remote-card')).toContainText('https://wiki.example.test/share');
});

test('reports remote check failure without removing the saved item', async ({ page }) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: 'remote-down',
        name: '故障知识库',
        url: 'https://down.example.test',
        status: 'ready',
        addedAt: 1,
        lastOpenedAt: 1
      }
    ]
  });

  await page.getByRole('button', { name: /消费端/ }).click();
  await page.getByRole('button', { name: '检测' }).click();

  await expect(page.getByText('远程知识库不可达')).toBeVisible();
  await expect(page.getByText('故障知识库')).toBeVisible();
});

test('requires confirmation before removing a remote knowledge base', async ({ page }) => {
  await prepareSystemTestPage(page, {
    remoteKnowledgeBases: [
      {
        remoteId: 'remote-1',
        name: '团队知识库',
        url: 'https://wiki.example.test',
        status: 'ready',
        addedAt: 1,
        lastOpenedAt: 1
      }
    ]
  });

  await page.getByRole('button', { name: /消费端/ }).click();
  await expect(page.getByText('团队知识库')).toBeVisible();

  await setConfirmResult(page, false);
  await page.getByTitle('删除').click();
  await expect(page.getByText('团队知识库')).toBeVisible();

  await setConfirmResult(page, true);
  await page.getByTitle('删除').click();
  await expect(page.getByText('远程知识库已删除')).toBeVisible();
  await expect(page.getByText('团队知识库')).toBeHidden();
});
