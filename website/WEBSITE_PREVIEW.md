# TanStack DB Website Preview

## Overview

The TanStack DB website is a modern, clean single-page application built with React, Vite, and TypeScript, inspired by the design of graphql.org.

## Design Features

### Color Scheme
- **Primary**: #e535ab (Pink/Magenta)
- **Secondary**: #00d8ff (Cyan/Blue)
- **Background**: #0f0f23 (Dark Blue)
- **Background Light**: #1a1a2e
- **Text**: #ffffff (White)
- **Text Muted**: #a8a8b3 (Light Gray)

### Layout Sections

#### 1. Homepage (/)
- **Hero Section**: Large gradient title "TanStack DB" with tagline and call-to-action buttons
- **Features Grid**: 6 feature cards highlighting key benefits (Blazing Fast, Fine-Grained Reactivity, Optimistic Mutations, etc.)
- **Code Examples**: Syntax-highlighted code blocks showing useLiveQuery examples
- **Query-Driven Sync Highlight**: Special section with gradient background emphasizing the new v0.5 feature
- **Framework Support**: Grid showing React, Vue, Solid, Angular, Svelte support
- **Getting Started CTA**: Final section with installation command and documentation links

#### 2. Query-Driven Sync Page (/query-driven-sync)
- Dedicated page explaining the new Query-Driven Sync feature
- Problem/Solution format (Option A, B, C)
- Step-by-step examples with code
- Before/After comparisons
- Benefits grid
- Links to documentation and RFC

#### 3. Learn Page (/learn)
- Quick Start guide with installation instructions
- Code examples for creating collections
- Live query examples
- Optimistic mutation examples
- Core concepts grid
- Collection types comparison

#### 4. Code Page (/code)
- Official packages grid
- Collection adapters listing
- Developer tools
- Examples & templates with GitHub links

#### 5. Community Page (/community)
- Community channels (Discord, GitHub Discussions, Twitter)
- Contributing guidelines
- Community resources
- Sponsor section
- Partners showcase

### Navigation
- Sticky header with TanStack DB logo
- Links to: Learn, Query-Driven Sync, Code, Community, GitHub
- Gradient logo treatment

### Footer
- Four columns: Learn, Community, More, Support
- Links to documentation, social media, other TanStack projects
- Copyright notice

## Responsive Design
- Mobile-first approach
- Breakpoint at 768px for tablet/desktop
- Flexible grid layouts that stack on mobile
- Responsive typography

## Key Visual Elements
- Gradient text effects (pink to cyan)
- Hover effects on cards (lift and glow)
- Syntax-highlighted code blocks
- Smooth transitions
- Dark theme throughout

## Technologies Used
- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **React Router**: Client-side routing
- **TypeScript**: Type safety
- **Custom CSS**: No framework dependencies

## Development
```bash
cd website
npm install
npm run dev  # Dev server at http://localhost:5173
npm run build  # Production build
```

## Live Preview
To see the website:
1. Start the dev server: `npm run dev`
2. Open http://localhost:5173 in your browser
3. Navigate through the different pages

## Screenshot Generation
See [SCREENSHOT.md](./SCREENSHOT.md) for instructions on generating full-page screenshots of the website.
