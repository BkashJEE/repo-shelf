import { describe, it, expect } from 'vitest';
import { buildPages, cleanDoc, docRawUrl, docSourceUrl } from '../../server/pages';
import type { Repo } from '../../server/types';

const RAW = `---
sidebar_position: 1
title: "Hermes Agent Quickstart"
description: "Zero to chat in five minutes"
---

import Tabs from '@theme/Tabs';

# Hermes Agent Quickstart

Intro paragraph.

<div style={{position: 'relative'}}>
  <iframe src="https://example.com/embed"></iframe>
</div>

## Install

:::tip Android / Termux
Use the Termux guide.
:::

\`\`\`bash
curl -fsSL https://example.com/install.sh | bash
\`\`\`

<Tabs>
<TabItem value="a">A</TabItem>
</Tabs>

## Verify

Run \`hermes\`.
`;

describe('cleanDoc', () => {
  it('strips front matter, imports, embeds and turns admonitions into quotes', () => {
    const d = cleanDoc(RAW);
    expect(d.title).toBe('Hermes Agent Quickstart');
    expect(d.description).toBe('Zero to chat in five minutes');
    expect(d.markdown).not.toContain('sidebar_position');
    expect(d.markdown).not.toContain('import Tabs');
    expect(d.markdown).not.toContain('iframe');
    expect(d.markdown).not.toContain('<Tabs');
    expect(d.markdown).toContain('> **Android / Termux**');
    expect(d.markdown).toContain('curl -fsSL');
    expect(d.markdown.startsWith('# Hermes Agent Quickstart')).toBe(true);
  });
  it('falls back to the H1 for the title', () => {
    expect(cleanDoc('# Hello\n\nbody').title).toBe('Hello');
  });
});

describe('doc urls', () => {
  it('maps owner/repo:path to raw and blob URLs and passes https through', () => {
    expect(docRawUrl('o/r:website/docs/a.md')).toBe('https://raw.githubusercontent.com/o/r/HEAD/website/docs/a.md');
    expect(docSourceUrl('o/r:website/docs/a.md')).toBe('https://github.com/o/r/blob/HEAD/website/docs/a.md');
    expect(docRawUrl('https://x.y/z.md')).toBe('https://x.y/z.md');
  });
});

describe('buildPages for a guide', () => {
  const guide: Repo = {
    id: 'g',
    name: 'Quickstart',
    path: '',
    shelfId: 's',
    virtual: true,
    linkUrl: 'https://example.com/docs/quickstart',
    visibility: null,
    archived: false,
    createdAt: null,
    doc: 'o/r:website/docs/quickstart.md',
    summary: 'Zero to chat',
    branch: null,
    lastCommitAt: null,
    commitCount: 0,
    dirtyCount: 0,
    sizeKB: 0,
    languageGuess: 'Guide',
    remoteUrl: null,
    owner: null,
    repoSlug: null,
    github: null,
  };
  it('fetches the raw markdown, cleans it, and reports source doc', async () => {
    const seen: string[] = [];
    const pages = await buildPages(guide, undefined, false, async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => RAW };
    });
    expect(seen).toEqual(['https://raw.githubusercontent.com/o/r/HEAD/website/docs/quickstart.md']);
    expect(pages.source).toBe('doc');
    expect(pages.readme).toContain('## Install');
    expect(pages.files).toEqual([]);
  });
  it('reports none when the fetch fails', async () => {
    const pages = await buildPages(guide, undefined, false, async () => ({ ok: false, status: 404, text: async () => '' }));
    expect(pages.source).toBe('none');
    expect(pages.readme).toBeNull();
  });
});
