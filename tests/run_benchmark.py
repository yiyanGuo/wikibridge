#!/usr/bin/env python3
"""
Benchmark the current search implementation against the test query set.

Simulates LLM Wiki's search pipeline:
1. Tokenized search (CJK bigram + English word splitting)
2. Graph expansion (4-signal relevance model)

Measures: Recall@K, Precision@K, MRR per difficulty level.
"""

import json
import re
import math
from pathlib import Path
from collections import defaultdict

BASE = Path(__file__).parent / "fixtures" / "wiki"
QUERIES_FILE = Path(__file__).parent / "fixtures" / "queries.json"

# ── Load wiki pages ────────────────────────────────────────────────────────

def load_wiki():
    """Load all wiki pages, return {id: {title, type, content, sources, links}}"""
    pages = {}
    for md in BASE.rglob("*.md"):
        rel = md.relative_to(BASE)
        # Skip structural files
        if rel.name in ("index.md", "overview.md", "purpose.md", "schema.md", "log.md"):
            continue

        page_id = rel.with_suffix("").name  # e.g. "geoffrey-hinton"
        content = md.read_text(encoding="utf-8")

        # Parse frontmatter
        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        fm = fm_match.group(1) if fm_match else ""

        title_match = re.search(r'^title:\s*"?(.+?)"?\s*$', fm, re.MULTILINE)
        type_match = re.search(r'^type:\s*(\w+)', fm, re.MULTILINE)
        sources_match = re.search(r'^sources:\s*\[([^\]]*)\]', fm, re.MULTILINE)

        title = title_match.group(1).strip() if title_match else page_id
        page_type = type_match.group(1).strip() if type_match else "other"
        sources = []
        if sources_match:
            sources = [s.strip().strip('"').strip("'") for s in sources_match.group(1).split(",") if s.strip()]

        # Extract wikilinks
        links = re.findall(r'\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]', content)

        pages[page_id] = {
            "title": title,
            "type": page_type,
            "content": content,
            "sources": sources,
            "links": [l.strip() for l in links],
            "path": str(rel),
        }

    return pages

# ── Tokenized Search (current LLM Wiki implementation) ─────────────────────

STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "about", "against", "and", "but", "or", "nor",
    "not", "so", "yet", "both", "either", "neither", "each", "every",
    "all", "any", "few", "more", "most", "other", "some", "such", "no",
    "only", "own", "same", "than", "too", "very", "just", "because",
    "if", "when", "where", "how", "what", "which", "who", "whom",
    "this", "that", "these", "those", "it", "its", "he", "she", "they",
    "them", "we", "us", "my", "your", "his", "her", "our", "their",
    "的", "是", "在", "了", "和", "与", "或", "也", "都", "就",
    "不", "有", "这", "那", "个", "中", "上", "下", "大", "小",
}

def is_cjk(ch):
    cp = ord(ch)
    return (0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or
            0x2B820 <= cp <= 0x2CEAF or 0xF900 <= cp <= 0xFAFF)

def tokenize(text):
    """Tokenize like LLM Wiki: CJK bigram + English word splitting + stop words."""
    text = text.lower()
    tokens = []

    # Split by non-alphanumeric (keep CJK)
    parts = re.split(r'[^\w\u4e00-\u9fff\u3400-\u4dbf]+', text)

    for part in parts:
        if not part:
            continue

        # Check if contains CJK
        has_cjk = any(is_cjk(ch) for ch in part)

        if has_cjk:
            # CJK bigram tokenization
            cjk_chars = [ch for ch in part if is_cjk(ch)]
            for i in range(len(cjk_chars)):
                if i + 1 < len(cjk_chars):
                    bigram = cjk_chars[i] + cjk_chars[i + 1]
                    tokens.append(bigram)
                # Also add individual chars for short terms
                tokens.append(cjk_chars[i])
            # Also extract non-CJK segments within mixed text
            non_cjk = re.findall(r'[a-z0-9]+', part)
            for word in non_cjk:
                if word not in STOP_WORDS and len(word) > 1:
                    tokens.append(word)
        else:
            # English word
            if part not in STOP_WORDS and len(part) > 1:
                tokens.append(part)

    return tokens

def search_tokenized(query, pages, top_k=10):
    """Simulate LLM Wiki's tokenized search."""
    query_tokens = tokenize(query)
    if not query_tokens:
        return []

    scored = []
    for page_id, page in pages.items():
        content_lower = page["content"].lower()
        title_lower = page["title"].lower()

        score = 0
        for token in query_tokens:
            if token in content_lower:
                score += 1
            if token in title_lower:
                score += 10  # title bonus

        if score > 0:
            scored.append((page_id, score))

    scored.sort(key=lambda x: -x[1])
    return scored[:top_k]

# ── Graph Expansion (4-signal relevance) ───────────────────────────────────

TYPE_AFFINITY = {
    "entity": {"concept": 1.2, "entity": 0.8, "source": 1.0, "synthesis": 1.0, "comparison": 0.8},
    "concept": {"entity": 1.2, "concept": 0.8, "source": 1.0, "synthesis": 1.2, "comparison": 1.0},
    "source": {"entity": 1.0, "concept": 1.0, "source": 0.5, "synthesis": 1.0, "comparison": 0.8},
    "synthesis": {"concept": 1.2, "entity": 1.0, "source": 1.0, "synthesis": 0.8, "comparison": 1.0},
    "comparison": {"concept": 1.0, "entity": 0.8, "source": 0.8, "synthesis": 1.0, "comparison": 0.5},
}

WEIGHTS = {
    "direct_link": 3.0,
    "source_overlap": 4.0,
    "common_neighbor": 1.5,
    "type_affinity": 1.0,
}

def build_graph(pages):
    """Build adjacency data for graph expansion."""
    # Build link maps
    out_links = {}
    in_links = defaultdict(set)

    for pid, page in pages.items():
        resolved = set()
        for link in page["links"]:
            target = link.lower().replace(" ", "-")
            if target in pages and target != pid:
                resolved.add(target)
        out_links[pid] = resolved
        for target in resolved:
            in_links[target].add(pid)

    return out_links, dict(in_links)

def calculate_relevance(a_id, b_id, pages, out_links, in_links):
    """Calculate 4-signal relevance score between two pages."""
    a = pages[a_id]
    b = pages[b_id]

    a_out = out_links.get(a_id, set())
    b_out = out_links.get(b_id, set())
    a_in = in_links.get(a_id, set())
    b_in = in_links.get(b_id, set())

    # Signal 1: Direct links
    forward = 1 if b_id in a_out else 0
    backward = 1 if a_id in b_out else 0
    direct = (forward + backward) * WEIGHTS["direct_link"]

    # Signal 2: Source overlap
    shared = len(set(a["sources"]) & set(b["sources"]))
    source_overlap = shared * WEIGHTS["source_overlap"]

    # Signal 3: Common neighbors (Adamic-Adar)
    a_neighbors = a_out | a_in
    b_neighbors = b_out | b_in
    aa = 0
    for common in a_neighbors & b_neighbors:
        degree = len(out_links.get(common, set())) + len(in_links.get(common, set()))
        aa += 1 / math.log(max(degree, 2))
    common_neighbor = aa * WEIGHTS["common_neighbor"]

    # Signal 4: Type affinity
    affinity = TYPE_AFFINITY.get(a["type"], {}).get(b["type"], 0.5)
    type_score = affinity * WEIGHTS["type_affinity"]

    return direct + source_overlap + common_neighbor + type_score

def graph_expand(seed_ids, pages, out_links, in_links, top_k=5):
    """Expand seed nodes using 4-signal relevance."""
    candidates = {}

    for seed_id in seed_ids:
        if seed_id not in pages:
            continue
        for pid in pages:
            if pid in seed_ids or pid in candidates:
                continue
            rel = calculate_relevance(seed_id, pid, pages, out_links, in_links)
            if rel > 0:
                if pid not in candidates or candidates[pid] < rel:
                    candidates[pid] = rel

    sorted_candidates = sorted(candidates.items(), key=lambda x: -x[1])
    return sorted_candidates[:top_k]

# ── Full Search Pipeline ───────────────────────────────────────────────────

def search(query, pages, out_links, in_links, top_k=10):
    """Full pipeline: tokenized search → graph expansion → merge."""
    # Phase 1: Tokenized search
    token_results = search_tokenized(query, pages, top_k=top_k)

    # Phase 2: Graph expansion from top results
    seed_ids = [pid for pid, _ in token_results[:5]]
    graph_results = graph_expand(seed_ids, pages, out_links, in_links, top_k=top_k)

    # Merge: combine scores
    merged = {}
    for pid, score in token_results:
        merged[pid] = score

    for pid, rel_score in graph_results:
        if pid in merged:
            merged[pid] += rel_score * 0.5  # graph expansion weighted lower
        else:
            merged[pid] = rel_score * 0.3  # pure graph results weighted even lower

    sorted_results = sorted(merged.items(), key=lambda x: -x[1])
    return [pid for pid, _ in sorted_results[:top_k]]

# ── Evaluation Metrics ─────────────────────────────────────────────────────

def evaluate(results, expected, unexpected=None):
    """Calculate metrics for a single query."""
    expected_set = set(expected)
    unexpected_set = set(unexpected) if unexpected else set()
    results_set = set(results)

    # Recall@K: fraction of expected items found
    found = expected_set & results_set
    recall = len(found) / len(expected_set) if expected_set else 1.0

    # Precision@K: fraction of results that are expected (not counting unexpected as wrong)
    correct = len(found)
    wrong = len(results_set & unexpected_set)
    precision = correct / len(results) if results else 0.0

    # MRR: reciprocal rank of first expected item
    mrr = 0.0
    for i, pid in enumerate(results):
        if pid in expected_set:
            mrr = 1.0 / (i + 1)
            break

    # Unexpected hit rate
    unexpected_hits = len(results_set & unexpected_set)

    return {
        "recall": recall,
        "precision": precision,
        "mrr": mrr,
        "unexpected_hits": unexpected_hits,
    }

# ── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Loading wiki pages...")
    pages = load_wiki()
    print(f"  {len(pages)} pages loaded")

    print("Building graph...")
    out_links, in_links = build_graph(pages)
    total_edges = sum(len(v) for v in out_links.values())
    print(f"  {total_edges} edges")

    print("Loading queries...")
    queries = json.loads(QUERIES_FILE.read_text(encoding="utf-8"))
    print(f"  {len(queries)} queries")

    print("\nRunning benchmark...\n")

    TOP_K = 10

    level_labels = {
        1: "Direct Match",
        2: "Synonym/Alternate",
        3: "Cross-Domain",
        4: "Disambiguation",
        5: "Implicit Association",
        6: "Reasoning Chain",
        7: "Mixed Language",
    }

    level_metrics = defaultdict(lambda: {"recall": [], "precision": [], "mrr": [], "unexpected": []})
    all_metrics = {"recall": [], "precision": [], "mrr": [], "unexpected": []}

    for q in queries:
        results = search(q["query"], pages, out_links, in_links, top_k=TOP_K)
        m = evaluate(results, q["expected"], q.get("unexpected"))

        level = q["level"]
        level_metrics[level]["recall"].append(m["recall"])
        level_metrics[level]["precision"].append(m["precision"])
        level_metrics[level]["mrr"].append(m["mrr"])
        level_metrics[level]["unexpected"].append(m["unexpected_hits"])

        all_metrics["recall"].append(m["recall"])
        all_metrics["precision"].append(m["precision"])
        all_metrics["mrr"].append(m["mrr"])
        all_metrics["unexpected"].append(m["unexpected_hits"])

    # Print results
    print(f"{'Level':<30} {'Recall@{}'.format(TOP_K):>10} {'Prec@{}'.format(TOP_K):>10} {'MRR':>10} {'Unexp':>8} {'Count':>7}")
    print("-" * 77)

    for level in sorted(level_metrics.keys()):
        m = level_metrics[level]
        n = len(m["recall"])
        avg_recall = sum(m["recall"]) / n
        avg_precision = sum(m["precision"]) / n
        avg_mrr = sum(m["mrr"]) / n
        total_unexpected = sum(m["unexpected"])
        label = f"L{level}: {level_labels.get(level, '')}"
        print(f"{label:<30} {avg_recall:>9.1%} {avg_precision:>9.1%} {avg_mrr:>9.3f} {total_unexpected:>7d} {n:>7d}")

    print("-" * 77)
    n_all = len(all_metrics["recall"])
    print(f"{'OVERALL':<30} {sum(all_metrics['recall'])/n_all:>9.1%} {sum(all_metrics['precision'])/n_all:>9.1%} {sum(all_metrics['mrr'])/n_all:>9.3f} {sum(all_metrics['unexpected']):>7d} {n_all:>7d}")

    # Save detailed results
    results_file = Path(__file__).parent / "fixtures" / "benchmark_results.json"
    detail = []
    for q in queries:
        results = search(q["query"], pages, out_links, in_links, top_k=TOP_K)
        m = evaluate(results, q["expected"], q.get("unexpected"))
        detail.append({
            "query": q["query"],
            "level": q["level"],
            "intent": q["intent"],
            "expected": q["expected"],
            "retrieved": results,
            "recall": m["recall"],
            "precision": m["precision"],
            "mrr": m["mrr"],
            "unexpected_hits": m["unexpected_hits"],
        })

    results_file.write_text(json.dumps(detail, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDetailed results saved to: {results_file}")
