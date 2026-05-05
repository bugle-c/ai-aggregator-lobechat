#!/usr/bin/env python3
"""
Logic-level tests for the inlined Python snippets in generate-article.sh and
generate-hype-article.sh. These exercise the dedup heuristic, the Claude CLI
output parser, and the keyword-skipping payload — the three pieces that
caused the regressions tracked in issue #21.

Run: python3 scripts/blog/tests/test_blog_generation.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ARTICLE_SCRIPT = REPO_ROOT / "scripts/blog/generate-article.sh"
HYPE_SCRIPT = REPO_ROOT / "scripts/blog/generate-hype-article.sh"


# ---------- Reimplementation of inlined logic -----------------------------
# These functions mirror the embedded Python in the bash scripts. The bash
# scripts are tested at the contract level via grep below; these functions
# let us assert the contract behaves correctly.

def is_topical_duplicate(keyword: str, existing_titles: list[str]) -> str | None:
    """Mirror of the dedup pre-check inlined in generate-article.sh.

    Returns the matching title line on a hit, None otherwise.
    """
    kw = keyword.lower()
    kw_words = set(re.findall(r"[а-яёa-z0-9]{4,}", kw))
    if len(kw_words) < 2:
        return None
    for title in existing_titles:
        title_norm = title.strip().lstrip("- ").lower()
        title_words = set(re.findall(r"[а-яёa-z0-9]{4,}", title_norm))
        if not title_words:
            continue
        overlap = len(kw_words & title_words)
        if overlap >= max(2, int(len(kw_words) * 0.8)):
            return title.strip()
    return None


def parse_claude_article_json(raw_output: str, force_category: str = "news") -> dict:
    """Mirror of the parse block in generate-hype-article.sh / generate-article.sh."""
    data = json.loads(raw_output)
    result = data.get("result", "").strip()
    result = re.sub(r"^```(?:json)?\s*\n?", "", result)
    result = re.sub(r"\n?```\s*$", "", result)
    result = result.strip()
    start = result.find("{")
    end = result.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found")
    article = json.loads(result[start : end + 1])
    article["category"] = force_category
    if force_category == "news":
        mk = article.get("meta_keywords", "") or ""
        if "source:hype" not in mk:
            article["meta_keywords"] = (mk + ",source:hype").lstrip(",") if mk else "source:hype"
    required = ["title", "slug", "content", "category"]
    missing = [f for f in required if not article.get(f)]
    if missing:
        raise ValueError(f"Missing fields: {missing}")
    return article


# ---------- Tests ----------------------------------------------------------

class TopicalDuplicateTests(unittest.TestCase):
    """The exact scenario that caused the production loop, plus near-misses."""

    REVIEWS_TITLES = [
        "- ChatGPT бесплатно на русском без VPN: полное руководство на 2026 год",
        "- Лучшие нейросети для генерации изображений 2026",
        "- Обзор Claude 4: что нового и как использовать",
    ]

    def test_production_stuck_keyword_detected_as_duplicate(self):
        """The keyword that blocked 8 slots/day for several days must be detected."""
        kw = "впн на компьютер бесплатно 2026"
        match = is_topical_duplicate(kw, self.REVIEWS_TITLES)
        self.assertIsNotNone(match, "stuck keyword must be flagged as a duplicate")
        self.assertIn("ChatGPT бесплатно на русском без VPN", match)

    def test_unique_keyword_passes(self):
        """A keyword with no overlap should not be flagged."""
        kw = "midjourney промпты для аниме 2026"
        match = is_topical_duplicate(kw, self.REVIEWS_TITLES)
        self.assertIsNone(match)

    def test_short_keyword_skipped(self):
        """Keywords with < 2 long words are skipped (too noisy to dedup)."""
        kw = "ai"
        match = is_topical_duplicate(kw, self.REVIEWS_TITLES)
        self.assertIsNone(match)

    def test_partial_overlap_below_threshold_passes(self):
        """One overlapping word out of many shouldn't trigger a dup."""
        kw = "промпты для генерации видео sora"
        match = is_topical_duplicate(kw, self.REVIEWS_TITLES)
        self.assertIsNone(match)


class ParseClaudeArticleJsonTests(unittest.TestCase):
    """Mirrors the parse path that broke the May 5 hype run."""

    def _wrap(self, payload: str) -> str:
        return json.dumps({"result": payload})

    def test_happy_path(self):
        article = {
            "title": "Заголовок",
            "slug": "slug-en",
            "description": "опис",
            "content": "<p>html</p>",
            "category": "news",
            "meta_title": "т",
            "meta_description": "д",
            "meta_keywords": "a,b",
        }
        out = parse_claude_article_json(self._wrap(json.dumps(article, ensure_ascii=False)))
        self.assertEqual(out["title"], "Заголовок")
        self.assertIn("source:hype", out["meta_keywords"])

    def test_fenced_code_block_is_stripped(self):
        article = {
            "title": "Z",
            "slug": "z",
            "content": "<p>x</p>",
            "category": "news",
            "meta_keywords": "k1",
        }
        wrapped = "```json\n" + json.dumps(article) + "\n```"
        out = parse_claude_article_json(self._wrap(wrapped))
        self.assertEqual(out["category"], "news")
        self.assertTrue(out["meta_keywords"].endswith("source:hype"))

    def test_missing_required_field_raises(self):
        """The May-5 production failure: result has no title/slug/content."""
        article = {"category": "news", "meta_keywords": "x"}
        with self.assertRaises(ValueError) as cm:
            parse_claude_article_json(self._wrap(json.dumps(article)))
        self.assertIn("Missing fields", str(cm.exception))

    def test_no_json_object_at_all(self):
        """When Claude errors out with a tiny error string, parse must reject."""
        with self.assertRaises(ValueError):
            parse_claude_article_json(self._wrap("Error: rate limit exceeded"))

    def test_force_category_overrides_llm(self):
        article = {
            "title": "T",
            "slug": "s",
            "content": "<p/>",
            "category": "wrong-cat",
            "meta_keywords": "k",
        }
        out = parse_claude_article_json(
            self._wrap(json.dumps(article)), force_category="reviews"
        )
        self.assertEqual(out["category"], "reviews")


class ScriptContractTests(unittest.TestCase):
    """Asserts the bash scripts use the right values & retry shape.

    Catches regressions where someone reintroduces the bad 'duplicate'
    status or removes the retry loop.
    """

    def setUp(self):
        self.article = ARTICLE_SCRIPT.read_text(encoding="utf-8")
        self.hype = HYPE_SCRIPT.read_text(encoding="utf-8")

    def test_article_uses_skipped_status_not_duplicate(self):
        # The exact bug from issue #21: 'duplicate' fails check constraint.
        # The PATCH body lives inside a bash double-quoted string so quotes are
        # backslash-escaped on disk: \"status\":\"skipped\".
        self.assertNotIn(
            r'\"status\":\"duplicate\"',
            self.article,
            "PATCH must not use 'duplicate' (rejected by blog_keywords_status_check)",
        )
        self.assertIn(
            r'\"status\":\"skipped\"',
            self.article,
            "PATCH must use a status value valid in blog_keywords (e.g., 'skipped')",
        )

    def test_article_keyword_attempts_are_bounded(self):
        self.assertIn("MAX_KEYWORD_ATTEMPTS", self.article)

    def test_article_patch_errors_are_logged(self):
        """The previous code had `>/dev/null 2>&1 || true` swallowing errors."""
        self.assertNotIn(
            ">/dev/null 2>&1 || true",
            self.article,
            "PATCH errors must surface, not be silenced",
        )
        self.assertIn("WARN: failed to mark keyword", self.article)

    def test_article_claude_cli_has_retry(self):
        self.assertIn("MAX_CLAUDE_ATTEMPTS", self.article)

    def test_hype_claude_cli_has_retry(self):
        self.assertIn("MAX_CLAUDE_ATTEMPTS", self.hype)

    def test_hype_does_not_attempt_parse_on_cli_failure(self):
        """When CLI exits non-zero AND output is missing, parse must be skipped."""
        self.assertIn("Claude CLI try", self.hype)
        # The parse block must come after the retry loop, not run unconditionally.
        retry_pos = self.hype.find("MAX_CLAUDE_ATTEMPTS=")
        self.assertGreater(retry_pos, 0)
        # The exit-on-failure check must reference the attempt counter.
        self.assertIn("after ${MAX_CLAUDE_ATTEMPTS} attempts", self.hype)


class BashSyntaxTests(unittest.TestCase):
    def test_article_script_parses(self):
        r = subprocess.run(["bash", "-n", str(ARTICLE_SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())

    def test_hype_script_parses(self):
        r = subprocess.run(["bash", "-n", str(HYPE_SCRIPT)], capture_output=True)
        self.assertEqual(r.returncode, 0, r.stderr.decode())


if __name__ == "__main__":
    unittest.main(verbosity=2)
