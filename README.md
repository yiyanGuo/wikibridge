# LLM Wiki

<p align="center">
  <img src="logo.jpg" width="128" height="128" style="border-radius: 22%;" alt="LLM Wiki Logo">
</p>

<p align="center">
  <strong>A personal knowledge base that builds itself.</strong><br>
  LLM reads your documents, builds a structured wiki, and keeps it current.
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#features">Features</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#credits">Credits</a> •
  <a href="#license">License</a>
</p>

---

## What is this?

LLM Wiki is a cross-platform desktop application that turns your documents into an organized, interlinked knowledge base — automatically. Instead of traditional RAG (retrieve-and-answer from scratch every time), the LLM **incrementally builds and maintains a persistent wiki** from your sources. Knowledge is compiled once and kept current, not re-derived on every query.

This project is based on [Karpathy's LLM Wiki pattern](https://github.com/karpathy/llm-wiki) — a methodology for building personal knowledge bases using LLMs. We implemented the core ideas as a full desktop application with significant enhancements.

## Credits

The foundational methodology comes from **Andrej Karpathy**'s [llm-wiki.md](https://github.com/karpathy/llm-wiki), which describes the pattern of using LLMs to incrementally build and maintain a personal wiki. The original document is an abstract design pattern; this project is a concrete implementation with substantial extensions.

## What We Kept from the Original

The core architecture follows Karpathy's design faithfully:

- **Three-layer architecture**: Raw Sources (immutable) → Wiki (LLM-generated) → Schema (rules & config)
- **Three core operations**: Ingest, Query, Lint
- **index.md** as the content catalog and LLM navigation entry point
- **log.md** as the chronological operation record with parseable format
- **[[wikilink]]** syntax for cross-references
- **YAML frontmatter** on every wiki page
- **Obsidian compatibility** — the wiki directory works as an Obsidian vault
- **Human curates, LLM maintains** — the fundamental role division

## What We Changed & Added

### Architecture Enhancements

| Original (Karpathy) | Our Implementation |
|---------------------|-------------------|
| CLI-based workflow (copy-paste to LLM agent) | Full desktop app (Tauri v2 + React) |
| Single LLM conversation | Multi-conversation chat with history |
| Manual ingest with discussion | Two-step chain-of-thought: LLM analyzes first, then generates |
| Schema only | Schema + **Purpose.md** (wiki's soul — goals, key questions, scope) |
| No search engine at small scale | **Tokenized search** with CJK bigram support + graph-enhanced retrieval |
| index.md as sole navigation | **Knowledge View** (grouped by type) + File Tree + Graph View |

### Knowledge Graph & Relevance

The original mentions Obsidian's graph view for browsing. We built a **full knowledge graph system**:

- **Interactive graph visualization** (sigma.js) with nodes colored by type
- **4-signal relevance model** for relationship strength:
  - Direct links (wikilink count) × 3.0
  - Source overlap (shared source files) × 4.0
  - Common neighbors (Adamic-Adar) × 1.5
  - Type affinity (entity↔concept) × 1.0
- **Edge thickness and color** reflect relationship strength
- **Graph-enhanced retrieval**: Chat queries expand to related nodes via 1-level graph traversal
- **Budget-controlled context**: 60% for pages, 20% for history, 5% for index, 15% reserved

### Ingest Pipeline

The original describes a single-step ingest. We use a **two-step chain-of-thought**:

```
Step 1 (Analysis): LLM reads source → structured analysis
  - Key entities, concepts, arguments
  - Connections to existing wiki
  - Contradictions & tensions
  - Recommendations

Step 2 (Generation): LLM takes analysis → generates wiki files
  - Source summary, entities, concepts
  - Updated index.md, log.md, overview.md
  - Review items for human judgment
  - Search queries for Deep Research
```

### Review System (Async Human-in-the-Loop)

The original suggests staying involved during ingest. We added an **asynchronous review queue**:

- LLM flags items needing human judgment during ingest
- Contradictions, duplicates, missing pages, suggestions
- Pre-made action buttons: Create Page, Deep Research, Skip
- User handles reviews at their convenience — doesn't block ingest

### Deep Research

Not in the original. When the LLM identifies knowledge gaps:

- **Web search** (Tavily API) finds relevant sources
- **Multiple search queries** per topic (LLM-generated, optimized for search engines)
- **LLM synthesizes** findings into a wiki research page
- **Auto-ingest** the research result to extract entities/concepts
- **Task queue** with 3 concurrent tasks
- **Research Panel** shows real-time progress

### Browser Extension (Web Clipper)

The original mentions Obsidian Web Clipper. We built a **dedicated Chrome Extension**:

- **Mozilla Readability.js** for accurate article extraction
- **Turndown.js** for HTML → Markdown conversion
- **Project picker** — choose which wiki to clip into
- **Local HTTP API** (port 19827) — Extension → App communication
- **Auto-ingest** — clipped content automatically processed into wiki
- Works even when app is not running (shows content preview)

### Multi-format Document Support

The original focuses on text/markdown. We support:

| Format | Method |
|--------|--------|
| PDF | pdf-extract (Rust) |
| DOCX | docx-rs — headings, bold/italic, lists, tables → Markdown |
| PPTX | ZIP + XML — slide-by-slide extraction with structure |
| XLSX/XLS/ODS | calamine — proper cell types, multi-sheet, Markdown tables |
| Images | Native preview (png, jpg, gif, webp, svg, etc.) |
| Video/Audio | Built-in player |
| Web clips | Readability.js + Turndown.js → Markdown |

### Chat Enhancements

| Feature | Details |
|---------|---------|
| **Multi-conversation** | Independent chat sessions with history |
| **Cited references** | Each response shows which wiki pages were used |
| **Tokenized search** | Chinese bigram + English word splitting for retrieval |
| **Graph expansion** | Retrieves related pages via knowledge graph |
| **Budget control** | Configurable context window (4K → 1M), proportional allocation |
| **Save to Wiki** | Archive valuable answers → auto-ingest into knowledge network |
| **Regenerate** | Re-generate last response with one click |
| **Thinking display** | `<think>` blocks shown as collapsible sections |
| **LaTeX → Unicode** | 100+ symbols converted (→ α ∑ ≤ etc.) |
| **Markdown tables** | GFM table rendering with borders |

### Other Additions

- **i18n** — English + Chinese interface
- **Scenario templates** — Research, Reading, Personal Growth, Business, General
- **Settings persistence** — LLM provider, context size, language saved across restarts
- **Chat persistence** — Conversations saved per-project, survive restarts
- **Activity panel** — Real-time ingest progress with file-by-file details
- **Obsidian config** — Auto-generated `.obsidian/` with recommended settings
- **File deletion cascade** — Deleting a source cleanly removes related wiki pages, updates index, cleans wikilinks
- **Cross-platform** — macOS, Windows, Linux (path normalization throughout)
- **GitHub Actions CI/CD** — Automated builds for all platforms

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri v2 (Rust backend) |
| Frontend | React 19 + TypeScript + Vite |
| UI | shadcn/ui + Tailwind CSS v4 |
| Editor | Milkdown (ProseMirror-based WYSIWYG) |
| Graph | sigma.js + graphology + ForceAtlas2 |
| Search | Custom tokenized search + graph relevance |
| PDF | pdf-extract |
| Office | docx-rs + calamine |
| i18n | react-i18next |
| State | Zustand |
| LLM | Streaming fetch (OpenAI, Anthropic, Google, Ollama, Custom) |
| Web Search | Tavily API |

## Installation

### Pre-built Binaries

Download from [Releases](https://github.com/nashsu/llm_wiki/releases):
- **macOS**: `.dmg` (Apple Silicon + Intel)
- **Windows**: `.msi`
- **Linux**: `.deb` / `.AppImage`

### Build from Source

```bash
# Prerequisites: Node.js 20+, Rust 1.70+
git clone https://github.com/nashsu/llm_wiki.git
cd llm_wiki
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

### Chrome Extension

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `extension/` directory

## Quick Start

1. Launch the app → Create a new project (choose a template)
2. Go to **Settings** → Configure your LLM provider (API key + model)
3. Go to **Sources** → Import documents (PDF, DOCX, MD, etc.)
4. Watch the **Activity Panel** — LLM automatically builds wiki pages
5. Use **Chat** to query your knowledge base
6. Browse the **Knowledge Graph** to see connections
7. Check **Review** for items needing your attention
8. Run **Lint** periodically to maintain wiki health

## Project Structure

```
my-wiki/
├── purpose.md              # Goals, key questions, research scope
├── schema.md               # Wiki structure rules, page types
├── raw/
│   ├── sources/            # Uploaded documents (immutable)
│   └── assets/             # Local images
├── wiki/
│   ├── index.md            # Content catalog
│   ├── log.md              # Operation history
│   ├── overview.md         # Global summary (auto-updated)
│   ├── entities/           # People, organizations, products
│   ├── concepts/           # Theories, methods, techniques
│   ├── sources/            # Source summaries
│   ├── queries/            # Saved chat answers + research
│   ├── synthesis/          # Cross-source analysis
│   └── comparisons/        # Side-by-side comparisons
├── .obsidian/              # Obsidian vault config (auto-generated)
└── .llm-wiki/              # App config, chat history, review items
```

## License

This project is licensed under the **GNU General Public License v3.0** — see [LICENSE](LICENSE) for details.
