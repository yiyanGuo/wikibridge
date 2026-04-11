#!/usr/bin/env python3
"""
Benchmark V2: BM25 + Intent Classification + RRF Fusion

Phase 1: Replace tokenized search with BM25 (TF-IDF with length normalization)
Phase 2: Intent classification (heuristic) + RRF fusion of BM25 + Graph lanes

Compare against baseline (run_benchmark.py).
"""

import json
import re
import math
from pathlib import Path
from collections import defaultdict, Counter

BASE = Path(__file__).parent / "fixtures" / "wiki"
QUERIES_FILE = Path(__file__).parent / "fixtures" / "queries.json"

# ── Load wiki pages (same as baseline) ─────────────────────────────────────

def load_wiki():
    pages = {}
    for md in BASE.rglob("*.md"):
        rel = md.relative_to(BASE)
        if rel.name in ("index.md", "overview.md", "purpose.md", "schema.md", "log.md"):
            continue
        page_id = rel.with_suffix("").name
        content = md.read_text(encoding="utf-8")
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
        links = re.findall(r'\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]', content)
        pages[page_id] = {
            "title": title, "type": page_type, "content": content,
            "sources": sources, "links": [l.strip() for l in links], "path": str(rel),
        }
    return pages

# ── BM25 Implementation ───────────────────────────────────────────────────

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
    text = text.lower()
    tokens = []
    parts = re.split(r'[^\w\u4e00-\u9fff\u3400-\u4dbf]+', text)
    for part in parts:
        if not part:
            continue
        has_cjk = any(is_cjk(ch) for ch in part)
        if has_cjk:
            cjk_chars = [ch for ch in part if is_cjk(ch)]
            for i in range(len(cjk_chars)):
                if i + 1 < len(cjk_chars):
                    tokens.append(cjk_chars[i] + cjk_chars[i + 1])
                tokens.append(cjk_chars[i])
            non_cjk = re.findall(r'[a-z0-9]+', part)
            for word in non_cjk:
                if word not in STOP_WORDS and len(word) > 1:
                    tokens.append(word)
        else:
            if part not in STOP_WORDS and len(part) > 1:
                tokens.append(part)
    return tokens

class BM25Index:
    """BM25 with TF-IDF, document length normalization, and title boosting."""

    def __init__(self, k1=1.5, b=0.75, title_boost=3.0):
        self.k1 = k1
        self.b = b
        self.title_boost = title_boost
        self.doc_count = 0
        self.avg_dl = 0.0
        self.doc_lens = {}      # doc_id -> token count
        self.doc_freqs = {}     # token -> number of docs containing it
        self.tf = {}            # doc_id -> {token -> count}
        self.title_tf = {}      # doc_id -> {token -> count}

    def index(self, pages):
        """Build BM25 index from pages."""
        self.doc_count = len(pages)
        total_len = 0

        for pid, page in pages.items():
            # Tokenize content
            content_tokens = tokenize(page["content"])
            title_tokens = tokenize(page["title"])

            self.doc_lens[pid] = len(content_tokens)
            total_len += len(content_tokens)

            # Term frequencies
            self.tf[pid] = Counter(content_tokens)
            self.title_tf[pid] = Counter(title_tokens)

            # Document frequencies
            unique_tokens = set(content_tokens) | set(title_tokens)
            for token in unique_tokens:
                self.doc_freqs[token] = self.doc_freqs.get(token, 0) + 1

        self.avg_dl = total_len / self.doc_count if self.doc_count > 0 else 1.0

    def search(self, query, top_k=10):
        """BM25 search with title boosting."""
        query_tokens = tokenize(query)
        if not query_tokens:
            return []

        scores = {}
        for pid in self.tf:
            score = 0.0
            dl = self.doc_lens[pid]

            for token in query_tokens:
                if token not in self.doc_freqs:
                    continue

                # IDF: log((N - n + 0.5) / (n + 0.5) + 1)
                n = self.doc_freqs[token]
                idf = math.log((self.doc_count - n + 0.5) / (n + 0.5) + 1.0)

                # TF in content with length normalization
                tf = self.tf[pid].get(token, 0)
                tf_norm = (tf * (self.k1 + 1)) / (tf + self.k1 * (1 - self.b + self.b * dl / self.avg_dl))
                score += idf * tf_norm

                # Title boost: if token appears in title, add boosted IDF
                title_tf = self.title_tf[pid].get(token, 0)
                if title_tf > 0:
                    score += idf * self.title_boost

            if score > 0:
                scores[pid] = score

        sorted_scores = sorted(scores.items(), key=lambda x: -x[1])
        return sorted_scores[:top_k]

# ── Intent Classification (Heuristic) ──────────────────────────────────────

def classify_intent(query):
    """Heuristic intent classification inspired by engraph."""
    q = query.lower()

    # Relationship queries
    if any(kw in q for kw in ["关系", "连接", "影响", "导致", "如何", "怎么",
                               "relationship", "connection", "connect", "influence",
                               "how did", "how does", "link between", "from", "led to", "path"]):
        return "relationship"

    # Exact queries (short, specific entity/concept names)
    tokens = tokenize(query)
    if len(tokens) <= 3 and not any(is_cjk(ch) for ch in query if len(query) < 20):
        return "exact"

    # Exploratory (why, what makes, what role)
    if any(kw in q for kw in ["why", "what makes", "what role", "what determines",
                               "为什么", "什么因素", "什么决定"]):
        return "exploratory"

    # Default: conceptual
    return "conceptual"

# ── Lane Weights by Intent ─────────────────────────────────────────────────

LANE_WEIGHTS = {
    "exact":        {"bm25": 1.5, "graph": 0.6},
    "conceptual":   {"bm25": 1.0, "graph": 1.2},
    "relationship": {"bm25": 0.7, "graph": 1.8},
    "exploratory":  {"bm25": 0.8, "graph": 1.5},
}

# ── Graph Expansion (same as baseline but returns ranked list) ─────────────

TYPE_AFFINITY = {
    "entity": {"concept": 1.2, "entity": 0.8, "source": 1.0, "synthesis": 1.0, "comparison": 0.8},
    "concept": {"entity": 1.2, "concept": 0.8, "source": 1.0, "synthesis": 1.2, "comparison": 1.0},
    "source": {"entity": 1.0, "concept": 1.0, "source": 0.5, "synthesis": 1.0, "comparison": 0.8},
    "synthesis": {"concept": 1.2, "entity": 1.0, "source": 1.0, "synthesis": 0.8, "comparison": 1.0},
    "comparison": {"concept": 1.0, "entity": 0.8, "source": 0.8, "synthesis": 1.0, "comparison": 0.5},
}

REL_WEIGHTS = {"direct_link": 3.0, "source_overlap": 4.0, "common_neighbor": 1.5, "type_affinity": 1.0}

def build_graph(pages):
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

def calc_relevance(a_id, b_id, pages, out_links, in_links):
    a, b = pages[a_id], pages[b_id]
    a_out, b_out = out_links.get(a_id, set()), out_links.get(b_id, set())
    a_in, b_in = in_links.get(a_id, set()), in_links.get(b_id, set())
    direct = ((1 if b_id in a_out else 0) + (1 if a_id in b_out else 0)) * REL_WEIGHTS["direct_link"]
    shared_src = len(set(a["sources"]) & set(b["sources"]))
    source_overlap = shared_src * REL_WEIGHTS["source_overlap"]
    a_nb, b_nb = a_out | a_in, b_out | b_in
    aa = 0
    for common in a_nb & b_nb:
        deg = len(out_links.get(common, set())) + len(in_links.get(common, set()))
        aa += 1 / math.log(max(deg, 2))
    common_neighbor = aa * REL_WEIGHTS["common_neighbor"]
    affinity = TYPE_AFFINITY.get(a["type"], {}).get(b["type"], 0.5)
    type_score = affinity * REL_WEIGHTS["type_affinity"]
    return direct + source_overlap + common_neighbor + type_score

def graph_expand(seed_ids, pages, out_links, in_links, top_k=15):
    """Expand with 2-hop traversal and relevance scoring."""
    candidates = {}
    seed_set = set(seed_ids)

    for seed_id in seed_ids:
        if seed_id not in pages:
            continue

        # 1-hop neighbors
        neighbors_1 = (out_links.get(seed_id, set()) | in_links.get(seed_id, set())) - seed_set
        for n1 in neighbors_1:
            rel = calc_relevance(seed_id, n1, pages, out_links, in_links)
            if n1 not in candidates or candidates[n1] < rel:
                candidates[n1] = rel

            # 2-hop neighbors (with decay)
            neighbors_2 = (out_links.get(n1, set()) | in_links.get(n1, set())) - seed_set - {n1}
            for n2 in neighbors_2:
                if n2 in candidates:
                    continue
                rel2 = calc_relevance(n1, n2, pages, out_links, in_links) * 0.5  # decay
                if n2 not in candidates or candidates[n2] < rel2:
                    candidates[n2] = rel2

    sorted_candidates = sorted(candidates.items(), key=lambda x: -x[1])
    return sorted_candidates[:top_k]

# ── RRF Fusion ─────────────────────────────────────────────────────────────

def rrf_fuse(lanes, weights, k=30):
    """
    Reciprocal Rank Fusion.
    lanes: dict of {lane_name: [(doc_id, score), ...]} — ordered by score desc
    weights: dict of {lane_name: float}
    Returns: [(doc_id, rrf_score)] sorted desc
    """
    scores = defaultdict(float)

    for lane_name, results in lanes.items():
        w = weights.get(lane_name, 1.0)
        for rank, (doc_id, _score) in enumerate(results, start=1):
            scores[doc_id] += w / (k + rank)

    sorted_results = sorted(scores.items(), key=lambda x: -x[1])
    return sorted_results

# ── Full V2 Search Pipeline ───────────────────────────────────────────────

def search_tokenized(query, pages, top_k=20):
    """Original tokenized substring search (high recall)."""
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
                score += 10
        if score > 0:
            scored.append((page_id, score))
    scored.sort(key=lambda x: -x[1])
    return scored[:top_k]

def search_v2(query, bm25_index, pages, out_links, in_links, top_k=10):
    """
    V2 Pipeline: 3-lane retrieval + RRF fusion
    1. Intent classification → lane weights
    2. Tokenized search (Lane 1 — high recall via substring match)
    3. BM25 search (Lane 2 — better ranking via IDF)
    4. Graph expansion from top results (Lane 3 — cross-domain discovery)
    5. RRF fusion with intent-adaptive weights
    """
    # Step 1: Intent classification
    intent = classify_intent(query)

    # Step 2: Tokenized search (original, high recall)
    token_results = search_tokenized(query, pages, top_k=top_k * 2)

    # Step 3: BM25 search (IDF-weighted ranking)
    bm25_results = bm25_index.search(query, top_k=top_k * 2)

    # Step 4: Graph expansion from combined top results
    seed_ids = list(dict.fromkeys(
        [pid for pid, _ in token_results[:3]] + [pid for pid, _ in bm25_results[:3]]
    ))
    graph_results = graph_expand(seed_ids, pages, out_links, in_links, top_k=top_k * 2)

    # Step 5: 3-lane RRF fusion with intent-adaptive weights
    lane_weights = {
        "exact":        {"token": 1.5, "bm25": 1.3, "graph": 0.4},
        "conceptual":   {"token": 1.2, "bm25": 1.0, "graph": 1.0},
        "relationship": {"token": 0.8, "bm25": 0.8, "graph": 1.8},
        "exploratory":  {"token": 1.0, "bm25": 0.9, "graph": 1.5},
    }
    weights = lane_weights[intent]

    lanes = {
        "token": token_results,
        "bm25": bm25_results,
        "graph": graph_results,
    }
    fused = rrf_fuse(lanes, weights)

    return [pid for pid, _ in fused[:top_k]]

# ── Evaluation (same as baseline) ─────────────────────────────────────────

def evaluate(results, expected, unexpected=None):
    expected_set = set(expected)
    unexpected_set = set(unexpected) if unexpected else set()
    results_set = set(results)
    found = expected_set & results_set
    recall = len(found) / len(expected_set) if expected_set else 1.0
    precision = len(found) / len(results) if results else 0.0
    mrr = 0.0
    for i, pid in enumerate(results):
        if pid in expected_set:
            mrr = 1.0 / (i + 1)
            break
    unexpected_hits = len(results_set & unexpected_set)
    return {"recall": recall, "precision": precision, "mrr": mrr, "unexpected_hits": unexpected_hits}

# ── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Loading wiki pages...")
    pages = load_wiki()
    print(f"  {len(pages)} pages loaded")

    print("Building BM25 index...")
    bm25 = BM25Index()
    bm25.index(pages)
    print(f"  {len(bm25.doc_freqs)} unique terms indexed")

    print("Building graph...")
    out_links, in_links = build_graph(pages)
    total_edges = sum(len(v) for v in out_links.values())
    print(f"  {total_edges} edges")

    print("Loading queries...")
    queries = json.loads(QUERIES_FILE.read_text(encoding="utf-8"))
    print(f"  {len(queries)} queries")

    print("\nRunning V2 benchmark (BM25 + Intent + RRF)...\n")

    TOP_K = 10
    level_labels = {
        1: "Direct Match", 2: "Synonym/Alternate", 3: "Cross-Domain",
        4: "Disambiguation", 5: "Implicit Association", 6: "Reasoning Chain",
        7: "Mixed Language",
    }

    level_metrics = defaultdict(lambda: {"recall": [], "precision": [], "mrr": [], "unexpected": []})
    all_metrics = {"recall": [], "precision": [], "mrr": [], "unexpected": []}

    # Also track intent distribution
    intent_counts = Counter()

    for q in queries:
        results = search_v2(q["query"], bm25, pages, out_links, in_links, top_k=TOP_K)
        m = evaluate(results, q["expected"], q.get("unexpected"))
        intent = classify_intent(q["query"])
        intent_counts[intent] += 1

        level = q["level"]
        for store in [level_metrics[level], all_metrics]:
            store["recall"].append(m["recall"])
            store["precision"].append(m["precision"])
            store["mrr"].append(m["mrr"])
            store["unexpected"].append(m["unexpected_hits"])

    # Print results
    print(f"{'Level':<30} {'Recall@{}'.format(TOP_K):>10} {'Prec@{}'.format(TOP_K):>10} {'MRR':>10} {'Unexp':>8} {'Count':>7}")
    print("-" * 77)

    for level in sorted(level_metrics.keys()):
        m = level_metrics[level]
        n = len(m["recall"])
        avg_r = sum(m["recall"]) / n
        avg_p = sum(m["precision"]) / n
        avg_m = sum(m["mrr"]) / n
        tot_u = sum(m["unexpected"])
        label = f"L{level}: {level_labels.get(level, '')}"
        print(f"{label:<30} {avg_r:>9.1%} {avg_p:>9.1%} {avg_m:>9.3f} {tot_u:>7d} {n:>7d}")

    print("-" * 77)
    n_all = len(all_metrics["recall"])
    print(f"{'OVERALL':<30} {sum(all_metrics['recall'])/n_all:>9.1%} {sum(all_metrics['precision'])/n_all:>9.1%} {sum(all_metrics['mrr'])/n_all:>9.3f} {sum(all_metrics['unexpected']):>7d} {n_all:>7d}")

    print(f"\nIntent distribution: {dict(intent_counts)}")

    # ── Comparison with baseline ───────────────────────────────────────────
    baseline_file = Path(__file__).parent / "fixtures" / "benchmark_results.json"
    if baseline_file.exists():
        baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
        baseline_by_level = defaultdict(list)
        for b in baseline:
            baseline_by_level[b["level"]].append(b["recall"])

        print(f"\n{'':=<77}")
        print(f"{'COMPARISON: V1 (baseline) vs V2 (BM25 + Intent + RRF)'}")
        print(f"{'':=<77}")
        print(f"{'Level':<30} {'V1 Recall':>10} {'V2 Recall':>10} {'Delta':>10}")
        print("-" * 62)

        for level in sorted(level_metrics.keys()):
            v1_recalls = baseline_by_level.get(level, [])
            v1_avg = sum(v1_recalls) / len(v1_recalls) if v1_recalls else 0
            v2_avg = sum(level_metrics[level]["recall"]) / len(level_metrics[level]["recall"])
            delta = v2_avg - v1_avg
            arrow = "↑" if delta > 0 else "↓" if delta < 0 else "="
            label = f"L{level}: {level_labels.get(level, '')}"
            print(f"{label:<30} {v1_avg:>9.1%} {v2_avg:>9.1%} {arrow}{abs(delta):>8.1%}")

        v1_all = [b["recall"] for b in baseline]
        v1_overall = sum(v1_all) / len(v1_all)
        v2_overall = sum(all_metrics["recall"]) / n_all
        delta = v2_overall - v1_overall
        arrow = "↑" if delta > 0 else "↓" if delta < 0 else "="
        print("-" * 62)
        print(f"{'OVERALL':<30} {v1_overall:>9.1%} {v2_overall:>9.1%} {arrow}{abs(delta):>8.1%}")
