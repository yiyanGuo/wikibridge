import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export type ReaderTreeNode = {
  node_id: string;
  name: string;
  kind: string;
  document_id?: string | null;
  readable: boolean;
  children: ReaderTreeNode[];
};

type ReaderMarkdownProps = {
  content: string;
  currentDocumentId: string;
  projectId: string;
  projectFolder: string;
  tree: ReaderTreeNode | null;
  onOpenDocument: (documentId: string) => void;
};

type ProjectAssetDto = {
  mime_type: string;
  bytes: number[];
};

type ResolvedImage =
  | {
      kind: 'remote';
      src: string;
    }
  | {
      kind: 'local';
      nodeId: string;
    };

type TreeIndex = {
  fileNodes: ReaderTreeNode[];
  documentNodes: ReaderTreeNode[];
};

const OBSIDIAN_TOKEN_RE = /(!?)\[\[([^\]\n]+)\]\]/g;
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const DRIVE_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;
const UNC_ABSOLUTE_RE = /^\\\\/;
const MARKDOWN_EXTENSION_RE = /\.(md|markdown)$/i;
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const PASSTHROUGH_SRC_RE = /^(https?:|data:|blob:|file:|tauri:|asset:)/i;

const CALLOUT_LABELS: Record<string, string> = {
  abstract: '摘要',
  bug: '问题',
  caution: '注意',
  danger: '风险',
  error: '错误',
  example: '示例',
  fail: '失败',
  failure: '失败',
  faq: '问题',
  help: '帮助',
  hint: '提示',
  important: '重要',
  info: '信息',
  missing: '缺失',
  note: '提示',
  question: '问题',
  quote: '引用',
  success: '完成',
  summary: '摘要',
  tip: '建议',
  todo: '待办',
  warning: '注意'
};

export function ReaderMarkdown({
  content,
  currentDocumentId,
  projectId,
  projectFolder,
  tree,
  onOpenDocument
}: ReaderMarkdownProps) {
  const treeIndex = useMemo(() => indexTree(tree), [tree]);
  const markdown = useMemo(() => stripFrontmatter(content), [content]);

  function openResolvedDocument(event: MouseEvent, documentId: string) {
    event.preventDefault();
    onOpenDocument(documentId);
  }

  function resolveWikiDocument(target: string) {
    return resolveDocumentTarget(target, currentDocumentId, treeIndex);
  }

  function resolveLocalImage(src: string, fromObsidianEmbed: boolean) {
    if (PASSTHROUGH_SRC_RE.test(src)) return { kind: 'remote', src } satisfies ResolvedImage;

    if (fromObsidianEmbed) {
      const target = parseObsidianTarget(src).target;
      const fileNodeId = resolveFileTarget(target, currentDocumentId, treeIndex, true);
      if (fileNodeId) return { kind: 'local', nodeId: fileNodeId } satisfies ResolvedImage;
    }

    const nodeId = markdownResourceNodeId(projectFolder, currentDocumentId, src);
    return nodeId ? ({ kind: 'local', nodeId } satisfies ResolvedImage) : null;
  }

  return (
    <ReactMarkdown
      rehypePlugins={[rehypeKatex]}
      remarkPlugins={[remarkGfm, remarkMath, remarkReaderSyntax]}
      urlTransform={readerUrlTransform}
      components={{
        a({ href, children, ...props }) {
          if (href?.startsWith('wiki:')) {
            const target = safeDecode(href.slice('wiki:'.length));
            const documentId = resolveWikiDocument(target);
            if (!documentId) {
              return <span className="wiki-link missing">{children}</span>;
            }
            return (
              <button className="wiki-link" onClick={(event) => openResolvedDocument(event, documentId)} type="button">
                {children}
              </button>
            );
          }

          const linkedDocumentId = href ? resolveMarkdownDocumentHref(href, currentDocumentId, treeIndex) : null;
          if (linkedDocumentId) {
            return (
              <button className="wiki-link" onClick={(event) => openResolvedDocument(event, linkedDocumentId)} type="button">
                {children}
              </button>
            );
          }

          return (
            <a {...props} href={href} rel={isExternalHref(href) ? 'noreferrer' : undefined} target={isExternalHref(href) ? '_blank' : undefined}>
              {children}
            </a>
          );
        },
        img({ src, alt }) {
          const isObsidianImage = Boolean(src?.startsWith('obsidian-image:'));
          const rawSrc = isObsidianImage && src ? safeDecode(src.slice('obsidian-image:'.length)) : src || '';
          const resolvedSrc = rawSrc ? resolveLocalImage(rawSrc, isObsidianImage) : null;
          if (!resolvedSrc) {
            return <span className="image-missing">{alt || '图片不可用'}</span>;
          }
          if (resolvedSrc.kind === 'remote') {
            return <img alt={alt || ''} src={resolvedSrc.src} />;
          }
          return <ProjectImage alt={alt || ''} nodeId={resolvedSrc.nodeId} projectId={projectId} />;
        }
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function ProjectImage({ alt, nodeId, projectId }: { alt: string; nodeId: string; projectId: string }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setSrc('');
    setFailed(false);

    invoke<ProjectAssetDto>('read_project_asset', { projectId, nodeId })
      .then((asset) => {
        if (disposed) return;
        const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mime_type });
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [nodeId, projectId]);

  if (failed) return <span className="image-missing">{alt || '图片不可用'}</span>;
  if (!src) return <span className="image-missing">图片加载中</span>;
  return <img alt={alt} src={src} />;
}

function remarkReaderSyntax() {
  return (tree: unknown) => transformMarkdownAst(tree);
}

function readerUrlTransform(url: string) {
  if (url.startsWith('wiki:') || url.startsWith('obsidian-image:')) return url;
  if (!URI_SCHEME_RE.test(url) || PASSTHROUGH_SRC_RE.test(url)) return url;
  return '';
}

function transformMarkdownAst(node: unknown) {
  if (!isAstNode(node) || shouldSkipAstNode(node)) return;

  if (node.type === 'blockquote') {
    applyCalloutMetadata(node);
  }

  const children = Array.isArray(node.children) ? node.children : null;
  if (!children) return;

  node.children = children.flatMap((child: unknown) => {
    if (isAstNode(child) && child.type === 'text' && typeof child.value === 'string') {
      return splitObsidianTokens(child.value);
    }
    return [child];
  });

  (node.children as unknown[]).forEach((child) => transformMarkdownAst(child));
}

function splitObsidianTokens(value: string) {
  const nodes: unknown[] = [];
  let lastIndex = 0;
  const regex = new RegExp(OBSIDIAN_TOKEN_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: value.slice(lastIndex, match.index) });
    }

    const isEmbed = match[1] === '!';
    const parsed = parseObsidianTarget(match[2]);
    if (isEmbed && IMAGE_EXTENSION_RE.test(stripHash(parsed.target))) {
      nodes.push({
        type: 'image',
        url: `obsidian-image:${encodeURIComponent(parsed.target)}`,
        alt: parsed.label || displayWikiTarget(parsed.target)
      });
    } else {
      nodes.push({
        type: 'link',
        url: `wiki:${encodeURIComponent(parsed.target)}`,
        title: null,
        children: [{ type: 'text', value: parsed.label || displayWikiTarget(parsed.target) }]
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push({ type: 'text', value: value.slice(lastIndex) });
  }

  return nodes.length ? nodes : [{ type: 'text', value }];
}

function applyCalloutMetadata(blockquote: Record<string, unknown>) {
  const children = Array.isArray(blockquote.children) ? blockquote.children : [];
  const firstParagraph = children.find((child) => isAstNode(child) && child.type === 'paragraph');
  if (!isAstNode(firstParagraph) || !Array.isArray(firstParagraph.children)) return;

  const firstText = firstParagraph.children.find((child) => isAstNode(child) && child.type === 'text' && typeof child.value === 'string');
  if (!isAstNode(firstText) || typeof firstText.value !== 'string') return;

  const match = firstText.value.match(/^\[!([a-zA-Z0-9_-]+)\][ \t]*(.*)$/);
  if (!match) return;

  const type = match[1].toLowerCase();
  const title = match[2].trim() || CALLOUT_LABELS[type] || type;
  firstText.value = title;
  firstParagraph.data = {
    ...(typeof firstParagraph.data === 'object' && firstParagraph.data ? firstParagraph.data : {}),
    hProperties: { className: 'callout-title' }
  };
  blockquote.data = {
    ...(typeof blockquote.data === 'object' && blockquote.data ? blockquote.data : {}),
    hProperties: { className: `callout callout-${type}`, 'data-callout': type }
  };
}

function isAstNode(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && 'type' in value);
}

function shouldSkipAstNode(node: Record<string, unknown>) {
  return ['code', 'inlineCode', 'link', 'linkReference', 'image', 'imageReference'].includes(String(node.type));
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
}

function indexTree(tree: ReaderTreeNode | null): TreeIndex {
  const fileNodes: ReaderTreeNode[] = [];
  const documentNodes: ReaderTreeNode[] = [];

  function walk(node: ReaderTreeNode | null) {
    if (!node) return;
    if (node.kind === 'file') {
      fileNodes.push(node);
      if (node.readable && node.document_id) documentNodes.push(node);
    }
    node.children.forEach(walk);
  }

  walk(tree);
  return { fileNodes, documentNodes };
}

function resolveMarkdownDocumentHref(href: string, currentDocumentId: string, treeIndex: TreeIndex) {
  if (!href || isExternalHref(href) || href.startsWith('#')) return null;
  const { path } = splitResourceRef(href);
  if (!MARKDOWN_EXTENSION_RE.test(path)) return null;
  return resolveDocumentTarget(path, currentDocumentId, treeIndex);
}

function resolveDocumentTarget(target: string, currentDocumentId: string, treeIndex: TreeIndex) {
  const cleanTarget = stripHash(parseObsidianTarget(target).target);
  if (!cleanTarget) return currentDocumentId;

  const candidates = documentCandidatePaths(cleanTarget, currentDocumentId);
  const lowerCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()));
  const direct = treeIndex.documentNodes.find((node) => {
    const documentId = normalizeRelativePath(node.document_id || node.node_id);
    return Boolean(documentId && lowerCandidates.has(documentId.toLowerCase()));
  });
  if (direct?.document_id) return direct.document_id;

  const normalizedTarget = stripMarkdownExtension(normalizeRelativePath(cleanTarget)).toLowerCase();
  const byPath = treeIndex.documentNodes.find((node) => stripMarkdownExtension(normalizeRelativePath(node.document_id || node.node_id)).toLowerCase() === normalizedTarget);
  if (byPath?.document_id) return byPath.document_id;

  const targetBase = stripMarkdownExtension(baseName(cleanTarget)).toLowerCase();
  const byBaseName = treeIndex.documentNodes.find((node) => stripMarkdownExtension(baseName(node.document_id || node.node_id)).toLowerCase() === targetBase);
  return byBaseName?.document_id || null;
}

function resolveFileTarget(target: string, currentDocumentId: string, treeIndex: TreeIndex, requireImage: boolean) {
  const cleanTarget = stripHash(parseObsidianTarget(target).target);
  if (!cleanTarget) return null;

  const currentDir = dirName(currentDocumentId);
  const candidates = [joinRelative(currentDir, cleanTarget), normalizeRelativePath(cleanTarget)].filter(Boolean);
  const lowerCandidates = new Set(candidates.map((candidate) => candidate.toLowerCase()));
  const exact = treeIndex.fileNodes.find((node) => {
    const nodeId = normalizeRelativePath(node.node_id);
    if (requireImage && !IMAGE_EXTENSION_RE.test(nodeId)) return false;
    return lowerCandidates.has(nodeId.toLowerCase());
  });
  if (exact) return exact.node_id;

  const targetBase = baseName(cleanTarget).toLowerCase();
  const byBaseName = treeIndex.fileNodes.find((node) => {
    const nodeId = normalizeRelativePath(node.node_id);
    if (requireImage && !IMAGE_EXTENSION_RE.test(nodeId)) return false;
    return baseName(nodeId).toLowerCase() === targetBase;
  });
  return byBaseName?.node_id || null;
}

function documentCandidatePaths(target: string, currentDocumentId: string) {
  const normalizedTarget = normalizeRelativePath(target);
  const currentDir = dirName(currentDocumentId);
  const targetVariants = MARKDOWN_EXTENSION_RE.test(normalizedTarget)
    ? [normalizedTarget]
    : [normalizedTarget, `${normalizedTarget}.md`, `${normalizedTarget}.markdown`];
  return uniqueStrings([
    ...targetVariants.map((candidate) => joinRelative(currentDir, candidate)),
    ...targetVariants
  ]).filter(Boolean);
}

function markdownResourceNodeId(projectFolder: string, currentDocumentId: string, rawSrc: string) {
  const { path } = splitResourceRef(safeDecode(rawSrc));
  if (!path) return null;

  if (isAbsolutePath(path)) {
    return relativePathFromProject(projectFolder, path);
  }

  const relative = joinRelative(dirName(currentDocumentId), path);
  if (!relative || relative.startsWith('../') || relative === '..') return null;
  return relative;
}

function relativePathFromProject(projectFolder: string, absolutePath: string) {
  const path = trimTrailingSlash(normalizeSlashes(absolutePath));
  const projectRoot = trimTrailingSlash(normalizeSlashes(projectFolder));
  if (!projectRoot || (path !== projectRoot && !path.startsWith(`${projectRoot}/`))) return null;
  const relative = normalizeRelativePath(path.slice(projectRoot.length));
  return relative && !relative.startsWith('../') && relative !== '..' ? relative : null;
}

function parseObsidianTarget(raw: string) {
  const [targetPart, ...labelParts] = raw.split('|');
  return {
    target: safeDecode(targetPart.trim()),
    label: labelParts.join('|').trim() || undefined
  };
}

function displayWikiTarget(target: string) {
  return stripMarkdownExtension(baseName(stripHash(target))) || target;
}

function splitResourceRef(value: string) {
  const queryIndex = value.search(/[?#]/);
  if (queryIndex === -1) return { path: value, suffix: '' };
  return { path: value.slice(0, queryIndex), suffix: value.slice(queryIndex) };
}

function stripHash(value: string) {
  return value.split('#')[0].trim();
}

function stripMarkdownExtension(value: string) {
  return value.replace(MARKDOWN_EXTENSION_RE, '');
}

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, '/');
}

function normalizeRelativePath(value: string) {
  const normalized = normalizeSlashes(value).replace(/^\.\/+/, '');
  const parts: string[] = [];
  normalized.split('/').forEach((part) => {
    if (!part || part === '.') return;
    if (part === '..') {
      if (parts.length) parts.pop();
      else parts.push('..');
      return;
    }
    parts.push(part);
  });
  return parts.join('/');
}

function joinRelative(base: string, target: string) {
  const cleanTarget = normalizeSlashes(target);
  if (!base || cleanTarget.startsWith('/')) return normalizeRelativePath(cleanTarget);
  return normalizeRelativePath(`${base}/${cleanTarget}`);
}

function dirName(value: string) {
  const normalized = normalizeRelativePath(value);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
}

function baseName(value: string) {
  const normalized = normalizeSlashes(value);
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

function isAbsolutePath(value: string) {
  return value.startsWith('/') || DRIVE_ABSOLUTE_RE.test(value) || UNC_ABSOLUTE_RE.test(value);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function isExternalHref(href: string | undefined) {
  return Boolean(href && URI_SCHEME_RE.test(href));
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
