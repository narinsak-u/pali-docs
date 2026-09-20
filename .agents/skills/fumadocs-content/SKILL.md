---
name: fumadocs-content
description: Use when creating, organizing, or updating MDX documentation content in the Fumadocs-based docs system
---

# Fumadocs Content Management

## Overview

Manage MDX documentation content with Fumadocs frontmatter, source configuration, and content organization.

## When to Use

- Creating new documentation pages
- Organizing docs into sections/categories
- Adding metadata (title, description, order)
- Referencing content in components
- Setting up navigation

## File Structure

MDX files live in `.source/` directory. Reference via `@/.source` alias.

```typescript
// source.config.ts - content source definition
import { defineSource } from 'fumadocs-mdx';

export const source = defineSource({
  // MDX files glob pattern
  glob: '**/*.mdx',
  // Content directory
  root: '.source',
});
```

## Frontmatter Schema

```mdx
---
title: Page Title
description: SEO description
indexing:
  - { category: grammar }
  - { category: vocabulary }
weight: 1
---
```

## Key Patterns

### Adding New Doc Page

1. Create `.source/<section>/<page>.mdx`
2. Add frontmatter with title, description, indexing
3. Use existing MDX components (see `mdx-components.tsx`)
4. Run `bun run dev` to verify

### Referencing Content in Components

```typescript
import { source } from '@/source.config';

// Get all docs for navigation
const docs = await source.getMany();

// Filter by category for section nav
const grammarDocs = docs.filter(doc => 
  doc.indexing?.some(i => i.category === 'grammar')
);
```

### Using MDX Components

```mdx
import { Callout } from '@/components/ui/alert';

<Callout type="info">
  Important note for learners
</Callout>
```

## Common Mistakes

- Missing frontmatter → page excluded from navigation
- Wrong glob pattern in source.config.ts
- Forgetting `@/.source` alias for imports

## Quick Reference

| Task | File |
|------|------|
| Add doc | `.source/<name>.mdx` |
| Configure source | `source.config.ts` |
| Custom components | `mdx-components.tsx` |
| Site config | `site.config.ts` |