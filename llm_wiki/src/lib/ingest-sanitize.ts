/**
 * Clean up an LLM-generated wiki page body before it hits disk.
 *
 * Audit of one real corpus (67 entity pages from `/Test321/wiki/entities`)
 * showed 30/67 pages had frontmatter that couldn't be parsed strictly.
 * Three recurring shapes the model emits:
 *
 *   1. The whole page wrapped in a `\`\`\`yaml … \`\`\`` (or `\`\`\`md`,
 *      `\`\`\`markdown`) code fence, e.g.
 *
 *          ```yaml
 *          ---
 *          type: entity
 *          ---
 *          # Body
 *          ```
 *
 *      — looks fine in the generation context but has no place in a
 *      real .md file.
 *
 *   2. A leading `frontmatter:` key that turns the document into a
 *      malformed nested-yaml shape, e.g.
 *
 *          frontmatter:
 *          ---
 *          type: entity
 *          ---
 *
 *   3. Inline wikilink lists without the outer brackets, e.g.
 *
 *          related: [[a]], [[b]], [[c]]
 *
 *      — semantically what the model wanted (a list of wikilinks),
 *      but not valid YAML flow syntax.
 *
 *   4. A frontmatter payload whose opening `---` is missing but whose
 *      closing `---` is present, e.g.
 *
 *          type: entity
 *          title: Foo
 *          ---
 *
 *      — common when the model starts "inside" the YAML block.
 *
 * This sanitizer rewrites these shapes into the standard
 * `---\n…\n---\n` frontmatter form before write. It's deliberately
 * conservative: each pattern is anchored at the very start of the
 * document (or at top-level frontmatter scope), so a legitimate
 * fenced code block deep in the body or a `frontmatter:` mention
 * inside prose is left alone.
 *
 * The read-time parser still retains its fallback paths so old,
 * already-written corrupt files render correctly. Sanitizing on
 * write means newly-generated files never need that fallback,
 * which means re-ingesting an old file once cleans it up
 * permanently.
 */
export function sanitizeIngestedFileContent(content: string): string {
  let cleaned = content

  // (1) Strip an outer code fence wrapping the whole document.
  // We only act when the FIRST non-empty line is an opening fence
  // (`\`\`\`yaml`, `\`\`\`md`, `\`\`\`markdown`, or just `\`\`\``)
  // AND the LAST non-empty line is a matching closing fence. This
  // avoids touching pages that legitimately end with an unclosed
  // fence (we don't try to "fix" mid-stream truncation here).
  cleaned = stripOuterCodeFence(cleaned)

  // (2) Strip a stray `frontmatter:` line that prefixes the real
  // `---` block. Some prompts seem to make the model interpret
  // the request as "produce a YAML document with a `frontmatter`
  // key" rather than "produce a markdown document with a
  // frontmatter block".
  cleaned = stripFrontmatterKeyPrefix(cleaned)

  // (2.5) Repair a missing opening frontmatter fence when the model
  // clearly emitted frontmatter lines followed by a closing fence.
  cleaned = addMissingOpeningFrontmatterFence(cleaned)

  // (2.6) Repair frontmatter that the LLM collapsed onto a single
  // line, e.g. "type: concept title: Foo created: 2024-01-01 ...".
  // Each key: value pair needs to be on its own line, wrapped in
  // --- fences, for the read-time parser to recognise it.
  cleaned = expandSingleLineFrontmatter(cleaned)

  // (3) Repair `key: [[a]], [[b]], [[c]]` lines inside the
  // frontmatter block so they're valid YAML. Body wikilinks are
  // left alone — those render fine via the wikilink → markdown
  // link transform applied at read time.
  cleaned = repairWikilinkListsInFrontmatter(cleaned)

  return cleaned
}

/** Top-level fence wrapper. Removes the open + close fence lines. */
function stripOuterCodeFence(content: string): string {
  const open = content.match(/^[ \t]*```(?:yaml|md|markdown)?[ \t]*\r?\n/)
  if (!open) return content
  const afterOpen = content.slice(open[0].length)

  // Closing fence: a final ``` on its own line, ignoring trailing
  // whitespace/newlines after it.
  const close = afterOpen.match(/\r?\n[ \t]*```[ \t]*\r?\n?\s*$/)
  if (!close) return content
  return afterOpen.slice(0, close.index)
}

/**
 * Strip a leading `frontmatter:` line followed by the real
 * frontmatter block. Only acts when the next non-empty line is
 * `---`, so a body that legitimately mentions the word
 * "frontmatter:" in prose is unaffected.
 */
function stripFrontmatterKeyPrefix(content: string): string {
  const m = content.match(/^[ \t]*frontmatter\s*:\s*\r?\n(?=[ \t]*---\s*\r?\n)/)
  if (!m) return content
  return content.slice(m[0].length)
}

function addMissingOpeningFrontmatterFence(content: string): string {
  if (/^[ \t]*---\s*(\r?\n|$)/.test(content)) return content

  const lines = content.split(/\r?\n/)
  const firstContentIdx = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIdx < 0) return content

  const first = lines[firstContentIdx].trim()
  if (!/^(type|title|created|updated|tags|related|sources)\s*:/i.test(first)) {
    return content
  }

  const searchEnd = Math.min(lines.length, firstContentIdx + 30)
  for (let i = firstContentIdx + 1; i < searchEnd; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === "---") {
      return `---\n${lines.slice(firstContentIdx).join("\n")}`
    }
    if (/^#{1,6}\s+/.test(trimmed)) break
  }

  return content
}

/**
 * Detect and expand frontmatter that the LLM collapsed onto a single
 * line, e.g.:
 *
 *     type: concept title: Foo created: 2024-01-01 tags: [a, b] sources: ["x.pdf"]
 *
 * into proper multi-line YAML wrapped in `---` fences:
 *
 *     ---
 *     type: concept
 *     title: Foo
 *     created: 2024-01-01
 *     tags: [a, b]
 *     sources: ["x.pdf"]
 *     ---
 *
 * Known frontmatter keys are used as split anchors. The function only
 * acts when the very first non-empty line of the document looks like
 * collapsed frontmatter (starts with a known key and contains at
 * least one more known key later on the same line).
 */
const FRONTMATTER_KEYS = [
  "type", "title", "created", "updated", "tags", "related",
  "sources", "origin", "summary", "language", "status",
]

function expandSingleLineFrontmatter(content: string): string {
  // Only act on documents that don't already have a frontmatter fence.
  if (/^---\s*\r?\n/.test(content)) return content

  const lines = content.split(/\r?\n/)
  const firstContentIdx = lines.findIndex((line) => line.trim().length > 0)
  if (firstContentIdx < 0) return content

  const firstLine = lines[firstContentIdx].trim()

  // Must start with a known frontmatter key.
  const firstKey = FRONTMATTER_KEYS.find((k) =>
    new RegExp(`^${k}\\s*:`, "i").test(firstLine),
  )
  if (!firstKey) return content

  // Count how many known frontmatter keys appear on this line.
  // If only one, it's a normal single-field line, not collapsed.
  const allKeysRe = new RegExp(
    `(?<![\\w-])(${FRONTMATTER_KEYS.join("|")})\\s*:`,
    "gi",
  )
  const keyMatches = firstLine.match(allKeysRe)
  if (!keyMatches || keyMatches.length < 2) return content

  // Split the single line into separate key: value lines.
  // Find each ` key:` occurrence (preceded by whitespace, not mid-word)
  // and split there.
  const splitRe = new RegExp(
    `\\s+(${FRONTMATTER_KEYS.join("|")})\\s*:`,
    "gi",
  )

  const splits: { start: number }[] = []
  let m: RegExpExecArray | null
  while ((m = splitRe.exec(firstLine)) !== null) {
    splits.push({ start: m.index })
  }

  if (splits.length === 0) return content

  // Build the expanded lines from split positions.
  // The first segment is from the start of the line to the first split
  // (e.g. "type: concept"). Subsequent segments are between splits.
  const expandedLines: string[] = []
  if (splits.length > 0 && splits[0].start > 0) {
    const firstSegment = firstLine.slice(0, splits[0].start).trim()
    if (firstSegment) expandedLines.push(firstSegment)
  }
  for (let i = 0; i < splits.length; i++) {
    const start = splits[i].start
    const end = i + 1 < splits.length ? splits[i + 1].start : firstLine.length
    const segment = firstLine.slice(start, end).trim()
    if (segment) {
      expandedLines.push(segment)
    }
  }

  // Reconstruct: --- + expanded lines + --- + rest of document
  const beforeFirst = lines.slice(0, firstContentIdx).join("\n")
  const afterFirst = lines.slice(firstContentIdx + 1).join("\n")

  const parts = [
    beforeFirst,
    "---",
    ...expandedLines,
    "---",
    afterFirst,
  ].filter((s, i) => !(i === 0 && s === ""))

  const result = parts.join("\n")

  // Clean up any leading newlines
  return result.replace(/^\n+/, "")
}

/**
 * Inside the frontmatter block (between the opening `---` and the
 * closing `---`), rewrite invalid wikilink-list lines. Lines
 * outside the frontmatter block are left untouched.
 */
function repairWikilinkListsInFrontmatter(content: string): string {
  const fmRe = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/
  const m = content.match(fmRe)
  if (!m) return content

  const repairedPayload = m[1]
    .split("\n")
    .map((line) => {
      const lm = line.match(
        /^(\s*[A-Za-z_][\w-]*\s*:\s*)(\[\[[^\]]+\]\](?:\s*,\s*\[\[[^\]]+\]\])+)\s*$/,
      )
      if (!lm) return line
      const items = lm[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => `"${s}"`)
        .join(", ")
      return `${lm[1]}[${items}]`
    })
    .join("\n")

  // Replace ONLY the payload between fences; preserve the original
  // fence lines and trailing newline shape.
  return (
    content.slice(0, m.index! + 4) + // up to and including "---\n"
    repairedPayload +
    content.slice(m.index! + 4 + m[1].length)
  )
}
