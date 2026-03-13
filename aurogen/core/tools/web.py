"""Web tools: web_search and web_fetch."""

import asyncio
import html
import json
import os
import re
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from loguru import logger

from core.tools.base import Tool

# Shared constants
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36"
MAX_REDIRECTS = 5  # Limit redirects to prevent DoS attacks


def _strip_tags(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<script[\s\S]*?</script>', '', text, flags=re.I)
    text = re.sub(r'<style[\s\S]*?</style>', '', text, flags=re.I)
    text = re.sub(r'<[^>]+>', '', text)
    return html.unescape(text).strip()


def _normalize(text: str) -> str:
    """Normalize whitespace."""
    text = re.sub(r'[ \t]+', ' ', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def _validate_url(url: str) -> tuple[bool, str]:
    """Validate URL: must be http(s) with valid domain."""
    try:
        p = urlparse(url)
        if p.scheme not in ('http', 'https'):
            return False, f"Only http/https allowed, got '{p.scheme or 'none'}'"
        if not p.netloc:
            return False, "Missing domain"
        return True, ""
    except Exception as e:
        return False, str(e)


class WebSearchTool(Tool):
    """Search the web using Brave Search API with DDG Lite fallback."""

    name = "web_search"
    description = (
        "Search the web. Uses Brave Search API when configured, otherwise falls back "
        "to DuckDuckGo Lite HTML search. Returns titles, URLs, and snippets."
    )
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query"},
            "count": {"type": "integer", "description": "Results (1-10)", "minimum": 1, "maximum": 10},
            "region": {
                "type": "string",
                "description": "Optional DuckDuckGo Lite region code like us-en, uk-en, au-en",
            },
        },
        "required": ["query"]
    }

    def __init__(self, api_key: str | None = None, max_results: int = 5, proxy: str | None = None):
        self._init_api_key = api_key
        self.max_results = max_results
        self.proxy = proxy

    @property
    def api_key(self) -> str:
        """Resolve API key at call time so env/config changes are picked up."""
        return self._init_api_key or os.environ.get("BRAVE_API_KEY", "")

    async def execute(
        self,
        query: str,
        count: int | None = None,
        region: str | None = None,
        **kwargs: Any,
    ) -> str:
        n = min(max(count or self.max_results, 1), 10)
        if self.api_key:
            try:
                return await self._search_brave(query, n)
            except httpx.ProxyError as e:
                logger.error("WebSearch proxy error: {}", e)
                return f"Proxy error: {e}"
            except Exception as e:
                logger.warning("Brave search failed for '{}', falling back to DuckDuckGo Lite: {}", query, e)

        return await asyncio.to_thread(self._search_ddg_lite, query, n, region)

    async def _search_brave(self, query: str, count: int) -> str:
        try:
            logger.debug("WebSearch: {}", "proxy enabled" if self.proxy else "direct connection")
            async with httpx.AsyncClient(proxy=self.proxy) as client:
                r = await client.get(
                    "https://api.search.brave.com/res/v1/web/search",
                    params={"q": query, "count": count},
                    headers={"Accept": "application/json", "X-Subscription-Token": self.api_key},
                    timeout=10.0
                )
                r.raise_for_status()

            results = r.json().get("web", {}).get("results", [])[:count]
            if not results:
                return f"No results for: {query}"

            normalized = [
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "description": item.get("description", ""),
                }
                for item in results
            ]
            return self._format_results(query, normalized, source="Brave Search")
        except Exception:
            raise

    def _search_ddg_lite(self, query: str, count: int, region: str | None) -> str:
        search_url = f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}"
        if region:
            search_url += f"&kl={quote_plus(region)}"

        fetcher = WebFetchTool(proxy=self.proxy)
        response_data = fetcher._fetch_sync(search_url, "auto")
        html_text = response_data["text"]
        results = self._parse_ddg_lite_results(html_text, count)
        if results:
            return self._format_results(query, results, source="DuckDuckGo Lite")

        fallback_text = _normalize(_strip_tags(html_text))
        if len(fallback_text) > 6000:
            fallback_text = fallback_text[:6000]
        return f"Search results for: {query}\n\n{fallback_text}"

    def _parse_ddg_lite_results(self, html_text: str, count: int) -> list[dict[str, str]]:
        from lxml import html as lxml_html

        tree = lxml_html.fromstring(html_text)
        anchors = tree.xpath("//a[@href]")
        results: list[dict[str, str]] = []

        for anchor in anchors:
            title = self._safe_node_text(anchor)
            href = (anchor.get("href") or "").strip() if hasattr(anchor, "get") else ""
            if not title or not href:
                continue
            if title.lower() in {"next page", "next", "previous", "prev"}:
                continue

            cleaned_url = self._clean_result_url(href)
            if not cleaned_url.startswith(("http://", "https://")):
                continue
            if "duckduckgo.com" in urlparse(cleaned_url).netloc and "uddg=" not in cleaned_url:
                continue

            row = anchor.xpath("ancestor::tr[1]")
            snippet = ""
            if row:
                current_row_text = self._safe_node_text(row[0])
                next_row = row[0].getnext()
                while next_row is not None and not self._is_element_node(next_row):
                    next_row = next_row.getnext()
                next_row_text = self._safe_node_text(next_row)
                snippet_parts = [part for part in [current_row_text, next_row_text] if part]
                snippet = " ".join(snippet_parts).strip()
                snippet = snippet.replace(title, "", 1).strip(" -\n\t")
                snippet = snippet.replace(cleaned_url, "", 1).strip(" -\n\t")

            results.append({
                "title": title,
                "url": cleaned_url,
                "description": snippet,
            })
            if len(results) >= count:
                break

        return results

    def _clean_result_url(self, href: str) -> str:
        parsed = urlparse(href)
        qs = parse_qs(parsed.query)
        if "uddg" in qs and qs["uddg"]:
            return unquote(qs["uddg"][0])
        return href

    def _is_element_node(self, node: Any) -> bool:
        return node is not None and isinstance(getattr(node, "tag", None), str)

    def _safe_node_text(self, node: Any) -> str:
        if not self._is_element_node(node):
            return ""
        try:
            return _normalize(node.text_content())
        except Exception:
            return ""

    def _format_results(self, query: str, results: list[dict[str, str]], source: str) -> str:
        if not results:
            return f"No results for: {query}"

        lines = [f"Results for: {query} ({source})\n"]
        for i, item in enumerate(results, 1):
            lines.append(f"{i}. {item.get('title', '')}\n   {item.get('url', '')}")
            if desc := item.get("description"):
                lines.append(f"   {desc}")
        return "\n".join(lines)


class WebFetchTool(Tool):
    """Fetch and extract content from a URL using lightweight scraping stack."""

    name = "web_fetch"
    description = (
        "Fetch URL and extract readable content (HTML -> markdown/text). "
        "Uses curl_cffi first, then cloudscraper fallback, and trafilatura for extraction."
    )
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "URL to fetch"},
            "extractMode": {"type": "string", "enum": ["markdown", "text"], "default": "markdown"},
            "fetchMode": {
                "type": "string",
                "enum": ["auto", "curl", "cloudscraper"],
                "default": "auto",
                "description": "Transport mode: auto tries curl_cffi then cloudscraper fallback",
            },
            "maxChars": {"type": "integer", "minimum": 100},
        },
        "required": ["url"]
    }

    def __init__(self, max_chars: int = 50000, proxy: str | None = None):
        self.max_chars = max_chars
        self.proxy = proxy

    async def execute(
        self,
        url: str,
        extractMode: str = "markdown",
        fetchMode: str = "auto",
        maxChars: int | None = None,
        **kwargs: Any,
    ) -> str:
        max_chars = maxChars or self.max_chars
        is_valid, error_msg = _validate_url(url)
        if not is_valid:
            return json.dumps({"error": f"URL validation failed: {error_msg}", "url": url}, ensure_ascii=False)

        try:
            logger.debug(
                "WebFetch: {} via {}",
                "proxy enabled" if self.proxy else "direct connection",
                fetchMode,
            )
            response_data = await asyncio.to_thread(self._fetch_sync, url, fetchMode)

            ctype = response_data["content_type"]
            body = response_data["text"]

            if "application/json" in ctype:
                text, extractor = self._format_json(body), "json"
            elif "text/html" in ctype or body[:256].lower().startswith(("<!doctype", "<html")):
                text = self._extract_html(body, extractMode)
                extractor = "trafilatura"
            else:
                text, extractor = body, "raw"

            truncated = len(text) > max_chars
            if truncated:
                text = text[:max_chars]

            return json.dumps({
                "url": url,
                "finalUrl": response_data["final_url"],
                "status": response_data["status_code"],
                "fetcher": response_data["fetcher"],
                "extractor": extractor,
                "truncated": truncated,
                "length": len(text),
                "text": text,
            }, ensure_ascii=False)
        except Exception as e:
            logger.error("WebFetch error for {}: {}", url, e)
            return json.dumps({"error": str(e), "url": url}, ensure_ascii=False)

    def _fetch_sync(self, url: str, fetch_mode: str) -> dict[str, Any]:
        if fetch_mode not in {"auto", "curl", "cloudscraper"}:
            raise ValueError(f"Unsupported fetchMode: {fetch_mode}")

        attempts = ["curl"] if fetch_mode == "curl" else ["cloudscraper"] if fetch_mode == "cloudscraper" else ["curl", "cloudscraper"]
        last_error: Exception | None = None

        for fetcher in attempts:
            try:
                data = self._fetch_with_curl_cffi(url) if fetcher == "curl" else self._fetch_with_cloudscraper(url)
                if self._looks_like_block_page(data["text"]):
                    raise RuntimeError(f"{fetcher} returned an anti-bot challenge page")
                return data
            except Exception as exc:
                last_error = exc
                logger.warning("WebFetch {} failed for {}: {}", fetcher, url, exc)

        raise RuntimeError(str(last_error) if last_error else f"Failed to fetch {url}")

    def _fetch_with_curl_cffi(self, url: str) -> dict[str, Any]:
        from curl_cffi import requests as curl_requests

        proxies = {"http": self.proxy, "https": self.proxy} if self.proxy else None
        response = curl_requests.get(
            url,
            headers={"User-Agent": USER_AGENT},
            impersonate="chrome",
            allow_redirects=True,
            max_redirects=MAX_REDIRECTS,
            timeout=30,
            proxies=proxies,
        )
        response.raise_for_status()
        return {
            "fetcher": "curl_cffi",
            "status_code": response.status_code,
            "final_url": str(response.url),
            "content_type": response.headers.get("content-type", ""),
            "text": response.text,
        }

    def _fetch_with_cloudscraper(self, url: str) -> dict[str, Any]:
        import cloudscraper

        scraper = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "mobile": False})
        response = scraper.get(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=30,
            allow_redirects=True,
            proxies={"http": self.proxy, "https": self.proxy} if self.proxy else None,
        )
        response.raise_for_status()
        return {
            "fetcher": "cloudscraper",
            "status_code": response.status_code,
            "final_url": str(response.url),
            "content_type": response.headers.get("content-type", ""),
            "text": response.text,
        }

    def _extract_html(self, raw_html: str, extract_mode: str) -> str:
        import trafilatura

        output_format = "markdown" if extract_mode == "markdown" else "txt"
        extracted = trafilatura.extract(
            raw_html,
            output_format=output_format,
            include_links=extract_mode == "markdown",
            include_images=False,
            favor_precision=True,
        )
        if extracted:
            return extracted
        return self._to_markdown(raw_html) if extract_mode == "markdown" else _strip_tags(raw_html)

    def _format_json(self, body: str) -> str:
        try:
            return json.dumps(json.loads(body), indent=2, ensure_ascii=False)
        except Exception:
            return body

    def _looks_like_block_page(self, text: str) -> bool:
        snippet = text[:4000].lower()
        indicators = (
            "just a moment",
            "attention required",
            "verify you are human",
            "cf-challenge",
            "cloudflare",
            "captcha",
            "access denied",
        )
        return any(token in snippet for token in indicators)

    def _to_markdown(self, html: str) -> str:
        """Convert HTML to markdown."""
        # Convert links, headings, lists before stripping tags
        text = re.sub(r'<a\s+[^>]*href=["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>',
                      lambda m: f'[{_strip_tags(m[2])}]({m[1]})', html, flags=re.I)
        text = re.sub(r'<h([1-6])[^>]*>([\s\S]*?)</h\1>',
                      lambda m: f'\n{"#" * int(m[1])} {_strip_tags(m[2])}\n', text, flags=re.I)
        text = re.sub(r'<li[^>]*>([\s\S]*?)</li>', lambda m: f'\n- {_strip_tags(m[1])}', text, flags=re.I)
        text = re.sub(r'</(p|div|section|article)>', '\n\n', text, flags=re.I)
        text = re.sub(r'<(br|hr)\s*/?>', '\n', text, flags=re.I)
        return _normalize(_strip_tags(text))
