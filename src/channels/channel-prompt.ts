/**
 * Build a self-contained prompt that tells an LLM agent how to read one
 * Channel's Current Publications from the public content API.
 */
export function channelIntegrationPrompt(input: {
  origin: string;
  name: string;
  slug: string;
  locale: string;
}): string {
  const origin = input.origin.replace(/\/+$/, "");
  const channel = encodeURIComponent(input.slug);
  const list = `${origin}/api/articles?channel=${channel}`;
  const detail = `${origin}/api/articles/{slug}`;
  const openApi = `${origin}/api/openapi.json`;

  if (input.locale.toLowerCase().startsWith("zh")) {
    return `你需要接入 Briefly 站点 ${origin} 的「${input.name}」频道（slug: ${input.slug}），获取该频道已发布的文章。

## 接口
公开、匿名、允许跨域，无需任何认证。
- 文章列表：GET ${list}&limit=20
  - limit 默认 20，最大 100。
  - 返回 { "items": [...], "nextCursor": string | null }，按发布时间倒序。
  - 翻页：保持相同的 channel 参数，追加 &cursor=<nextCursor>，直到 nextCursor 为 null。
  - 可选筛选：tag（标签）、language（BCP 47 语言代码，如 zh-CN）。
- 文章详情：GET ${detail}
  - 在列表字段基础上多一个 html（正文 HTML）。
  - 若返回 308，请跟随 Location 跳转到新的规范地址。
- 完整契约：GET ${openApi}（OpenAPI 3.1）

## 列表项字段
id, slug, title, summary (可能为 null), tags (string[]), byline, language, channel { slug, name }, cover { url, width, height, alt } 或 null, publishedAt, updatedAt（ISO 8601）。

## 注意事项
- 列表为空表示该频道暂无已发布文章（或 slug 不存在），不是错误。
- 400 且 code 为 ARTICLE_LIST_CURSOR_STALE 时，从第一页重新开始。
- 响应带 ETag，可用 If-None-Match 做条件请求以节省流量。
- 不要抓取 HTML 页面，只使用上述 JSON 接口。

请先请求第一页确认可用，再按需求实现。`;
  }

  return `Integrate with the "${input.name}" Channel (slug: ${input.slug}) of the Briefly site at ${origin} and fetch its published articles.

## Endpoints
Public, anonymous, CORS-enabled; no authentication.
- Article list: GET ${list}&limit=20
  - limit defaults to 20, maximum 100.
  - Returns { "items": [...], "nextCursor": string | null }, newest first.
  - Paginate by keeping the same channel parameter and appending &cursor=<nextCursor> until nextCursor is null.
  - Optional filters: tag, language (BCP 47 tag such as en-US).
- Article detail: GET ${detail}
  - Same fields as a list item plus html (the rendered body).
  - On 308, follow the Location header to the current canonical URL.
- Full contract: GET ${openApi} (OpenAPI 3.1)

## List item fields
id, slug, title, summary (may be null), tags (string[]), byline, language, channel { slug, name }, cover { url, width, height, alt } or null, publishedAt, updatedAt (ISO 8601).

## Notes
- An empty list means the Channel has no published articles (or the slug does not exist); it is not an error.
- On 400 with code ARTICLE_LIST_CURSOR_STALE, restart from the first page.
- Responses carry ETags; send If-None-Match for conditional requests.
- Do not scrape HTML pages; use only the JSON endpoints above.

Request the first page to confirm access, then implement what you need.`;
}
