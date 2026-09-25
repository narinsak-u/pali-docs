---
version: "alpha"
name: Pali Docs
description: Documentation site for Pali language learning with AI chat and quiz features
---

# Design System: Pali Docs

## 1. Overview

A documentation-focused design system optimized for educational content in Thai and English. The aesthetic emphasizes clarity, readability, and accessibility with a warm, scholarly feel appropriate for language learning. Uses a blue primary palette to convey trust and knowledge, with generous whitespace for comfortable extended reading.

## 2. Colors

The color system supports both light and dark modes with semantic role assignments:

| Token | Light Mode | Dark Mode | Role |
|:------|:-----------|:-----------|:-----|
| `primary` | `#2563eb` (blue-600) | `#4f46e5` (indigo-500) | Main actions, links, highlights |
| `primary-foreground` | `#ffffff` | `#f0f9ff` | Text on primary background |
| `secondary` | `#f1f5f9` (slate-100) | `#1e293b` (slate-800) | Secondary surfaces, cards |
| `secondary-foreground` | `#0f172a` (slate-900) | `#f8fafc` | Text on secondary |
| `muted` | `#f1f5f9` (slate-100) | `#1e293b` (slate-800) | Subtle backgrounds |
| `muted-foreground` | `#64748b` (slate-500) | `#94a3b8` (slate-400) | Secondary text |
| `accent` | `#f1f5f9` (slate-100) | `#334155` (slate-700) | Hover states, highlights |
| `accent-foreground` | `#0f172a` (slate-900) | `#f8fafc` | Text on accent |
| `destructive` | `#dc2626` (red-600) | `#dc2626` (red-600) | Error states, destructive actions |
| `border` | `#e2e8f0` (slate-200) | `rgba(255,255,255,0.1)` | Borders, dividers |
| `input` | `#e2e8f0` (slate-200) | `rgba(255,255,255,0.15)` | Form inputs |
| `ring` | `#2563eb` (blue-600) | `#4f46e5` (indigo-500) | Focus rings |
| `background` | `#ffffff` | `#0f172a` (slate-900) | Page background |
| `foreground` | `#1e293b` (slate-800) | `#f8fafc` | Primary text |
| `card` | `#ffffff` | `#1e293b` (slate-800) | Card backgrounds |
| `card-foreground` | `#1e293b` (slate-800) | `#f8fafc` | Card text |
| `popover` | `#ffffff` | `#1e293b` (slate-800) | Dropdown/modal bg |
| `popover-foreground` | `#1e293b` (slate-800) | `#f8fafc` | Dropdown text |

**Chart colors** (for data visualization): `#2563eb`, `#06b6d4`, `#8b5cf6`, `#f59e0b`, `#10b981`

## 3. Typography

The system uses multilingual typography with different fonts for English and Thai content:

| Token | Font | Size | Weight | Line Height | Usage |
|:------|:-----|:-----|:-------|:------------|:------|
| `heading-en` | Geist | 24-48px | 600-700 | 1.2 | English headings |
| `heading-th` | Thasadith | 24-48px | 600 | 1.3 | Thai headings |
| `body-en` | Geist | 16px | 400 | 1.6 | English body text |
| `body-th` | Thasadith | 16px | 400 | 1.6 | Thai body text |
| `blog` | IBM Plex Sans Thai | 16px | 400 | 1.7 | Blog content (mixed) |
| `code` | Geist Mono | 14px | 400 | 1.5 | Code blocks |
| `small` | inherit | 14px | 400 | 1.4 | Captions, labels |
| `button` | inherit | 14px | 500 | 1 | Button text |

**Font hierarchy:**
- H1: 48px / bold / tracking -0.02em
- H2: 36px / semibold / tracking -0.01em
- H3: 24px / semibold / tracking 0
- Body: 16px / regular / line-height 1.6
- Small: 14px / regular / line-height 1.4

## 4. Layout

**Spacing scale** (based on 4px base unit):
- `--space-xs`: 4px (tight spacing)
- `--space-sm`: 8px (component internal)
- `--space-md`: 16px (standard gap)
- `--space-lg`: 24px (section spacing)
- `--space-xl`: 32px (major sections)
- `--space-2xl`: 48px (page-level spacing)

**Container widths:**
- `max-w-[1100px]` - Main content container
- `max-w-[640px]` - Narrow content (reading)
- `max-w-[1200px]` - Wide layouts

**Responsive breakpoints:**
- Mobile: < 640px (single column)
- Tablet: 640px - 1024px (adaptive)
- Desktop: > 1024px (full layout)

## 5. Elevation & Depth

Shadow tokens for layered surfaces:

| Token | Value | Usage |
|:------|:------|:------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation |
| `shadow` | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)` | Cards, buttons |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Elevated cards |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dialogs |

**Z-index layers:**
- `z-0`: Base content
- `z-10`: Cards, dropdowns
- `z-20`: Sticky headers
- `z-30`: Modals, dialogs
- `z-40`: Tooltips
- `z-50`: AI chat overlay

## 6. Shapes

**Border radius scale:**
- `--radius-sm`: calc(var(--radius) - 4px) = 6px (small elements)
- `--radius-md`: calc(var(--radius) - 2px) = 8px (inputs, buttons)
- `--radius-lg`: var(--radius) = 10px (cards, containers)
- `--radius-xl`: calc(var(--radius) + 4px) = 12px (large surfaces)
- `--radius-2xl`: 16px (modals)
- `--radius-full`: 9999px (pills, avatars)

**Base radius:** `--radius: 0.65rem` (10.4px)

**Specific shapes:**
- Buttons: `rounded-md` (8px)
- Cards: `rounded-xl` (12px)
- Inputs: `rounded-md` (8px)
- Avatars: `rounded-full` (pill)

## 7. Components

### Button

```yaml
button-default:
  backgroundColor: "{colors.primary}"
  textColor: "{colors.primary-foreground}"
  rounded: "{rounded.md}"
  padding: "10px 16px"
  height: "40px"

button-default-hover:
  backgroundColor: "rgba(37, 99, 235, 0.9)"

button-secondary:
  backgroundColor: "{colors.secondary}"
  textColor: "{colors.secondary-foreground}"

button-outline:
  backgroundColor: "transparent"
  border: "1px solid {colors.border}"

button-ghost:
  backgroundColor: "transparent"
  textColor: "{colors.foreground}"
  hover:
    backgroundColor: "{colors.accent}"

button-destructive:
  backgroundColor: "{colors.destructive}"
  textColor: "#ffffff"
```

### Card

```yaml
card:
  backgroundColor: "{colors.card}"
  border: "1px solid {colors.border}"
  rounded: "{rounded.lg}"
  padding: "24px"
  shadow: "{shadow}"
```

### Progress

```yaml
progress:
  height: "8px"
  rounded: "9999px"
  backgroundColor: "{colors.muted}"
  fillColor: "{colors.primary}"
```

### Input/RadioGroup

```yaml
input:
  backgroundColor: "{colors.background}"
  border: "1px solid {colors.input}"
  rounded: "{rounded.md}"
  padding: "8px 12px"

radio:
  indicatorColor: "{colors.primary}"
  borderColor: "{colors.border}"
```

## 8. Do's and Don'ts

### Do
- Use primary blue for main actions and links
- Apply Thasadith font for Thai text, Geist for English
- Use card shadows for content groupings
- Maintain 16px minimum body text for readability
- Support both light and dark modes
- Use semantic colors (muted-foreground for secondary text)

### Don't
- Use primary color for large background areas (use secondary)
- Mix Thai and English fonts in the same element
- Use destructive colors for non-error states
- Apply tight spacing below headings (use md or lg)
- Use arbitrary colors outside the design system
- Forget to set lang attribute for Thai content detection

### Spacing Rules
- **Tight** (xs-sm): Icon gaps, inline elements
- **Standard** (md): Between related items
- **Relaxed** (lg-xl): Between sections, card padding
- **Generous** (2xl): Page-level spacing

### Accessibility
- Ensure 4.5:1 contrast ratio for body text
- Use focus-visible for keyboard navigation
- Support reduced motion preferences
- Set proper lang attributes for screen readers