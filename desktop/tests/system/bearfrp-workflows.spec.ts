import { expect, test } from '@playwright/test';
import {
  enqueueOpenResult,
  getOpenCalls,
  prepareSystemTestPage,
  setConfirmResult
} from './test-utils';

test('imports sources, builds wiki, refreshes graph, and starts/stops Chat', async ({ page }) => {
  await prepareSystemTestPage(page);

  await page.getByRole('button', { name: '进入项目' }).click();
  await enqueueOpenResult(page, ['/tmp/source-one.md', '/tmp/source-two.md']);
  await page.getByRole('button', { name: 'Add 文件', exact: true }).click();
  await expect(page.getByText('已导入 2 个 source')).toBeVisible();
  await expect(page.getByText('Sources：3')).toBeVisible();

  await page.getByRole('button', { name: '构建' }).click();
  await expect(page.getByText('已加入构建队列：1 个 source')).toBeVisible();
  await expect(page.getByText('队列：pending 1')).toBeVisible();

  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText('Graph 已刷新：1 个节点，0 条边')).toBeVisible();
  await expect(page.getByText('Graph：1/0')).toBeVisible();

  await page.getByRole('button', { name: '启动 Chat' }).click();
  await expect(page.getByText('OpenCode Chat 已启动：http://127.0.0.1:9010')).toBeVisible();
  await expect.poll(() => getOpenCalls(page)).toContainEqual({ url: 'http://127.0.0.1:9010', target: '_blank' });
  await expect(page.getByRole('button', { name: '停止 Chat' })).toBeVisible();

  await page.getByRole('button', { name: '停止 Chat' }).click();
  await expect(page.getByText('OpenCode Chat 已停止')).toBeVisible();
  await expect(page.getByRole('button', { name: '启动 Chat' })).toBeVisible();
});

test('shows empty reader state when a project has no wiki documents', async ({ page }) => {
  await prepareSystemTestPage(page, {
    projectTrees: {
      'project-1': {
        node_id: '',
        name: 'root',
        kind: 'directory',
        readable: false,
        children: []
      }
    },
    wikiProjects: {
      'project-1': {
        project: { id: 'project-1', name: '示例知识库', path: '/tmp/wikibridge/sample' },
        queue: { pending: 0, processing: 0, failed: 0, completed: 0, total: 0 },
        sourceCount: 0,
        wikiCount: 0
      }
    }
  });

  await page.getByRole('button', { name: '进入项目' }).click();
  await expect(page.getByText('暂无 Wiki 文档')).toBeVisible();
  await expect(page.getByText('请先 Add source，再构建。')).toBeVisible();
});

test('shows reader errors when document loading fails', async ({ page }) => {
  await prepareSystemTestPage(page, {
    commandFailures: {
      read_project_tree_document: '文档读取失败'
    }
  });

  await page.getByRole('button', { name: '进入项目' }).click();
  await expect(page.getByText('文档读取失败')).toBeVisible();
});

test('requires confirmation before deleting a project', async ({ page }) => {
  await prepareSystemTestPage(page);

  await expect(page.getByRole('heading', { name: '示例知识库' })).toBeVisible();
  await setConfirmResult(page, false);
  await page.getByTitle('删除项目').click();
  await expect(page.getByRole('heading', { name: '示例知识库' })).toBeVisible();

  await setConfirmResult(page, true);
  await page.getByTitle('删除项目').click();
  await expect(page.getByText('项目已从列表移除')).toBeVisible();
  await expect(page.getByRole('heading', { name: '示例知识库' })).toBeHidden();
});
