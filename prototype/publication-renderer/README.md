# Publication renderer workerd evidence

Ticket 02 established a viable path: strict Zod validation, ProseMirror
schema validation through Tiptap, and Tiptap's DOM-free static HTML renderer.
The renderer accepts only versioned ProseMirror JSON; it does not accept or
parse HTML and does not need a sanitizer or DOM shim.

Ticket 09 productionized this path as the single `renderPublication` operation
in `src/articles/publication-renderer.server.ts`. Renderer Version `1` uses the
exact dependencies and compatibility requirements recorded below.

## Reproduce

Run from the repository root with the pinned Node.js and pnpm versions:

```sh
pnpm install --frozen-lockfile
pnpm vitest run test/publication-renderer.test.ts
pnpm typecheck
pnpm prototype:renderer:bundle
```

The focused suite is part of the repository's Cloudflare Vitest pool, not a
Node test environment. On 2026-07-29 it reported 23 passing tests on workerd.
The dry-run command writes its Worker bundle and esbuild metadata under
`.output/publication-renderer-prototype/`.

## Exact tested versions

Runtime and tooling:

- Node.js 24.15.0 and pnpm 10.30.3
- compatibility date `2026-07-28` with the repository's `nodejs_compat` flag
- workerd 1.20260722.1, Miniflare 4.20260722.0
- `@cloudflare/vitest-pool-workers` 0.18.8, Vitest 4.1.10
- Wrangler 4.114.0

Validation, schema, and rendering:

- Zod 4.4.3
- `@tiptap/core` 3.29.2
- `@tiptap/pm` 3.29.2
- `@tiptap/static-renderer` 3.29.2, using the `pm/html-string` entry point
- orderedmap 2.1.1
- prosemirror-model 1.25.11
- prosemirror-transform 1.12.0
- prosemirror-state 1.4.4
- prosemirror-commands 1.7.1
- prosemirror-view 1.42.2
- prosemirror-keymap 1.2.3
- prosemirror-schema-list 1.5.1

Those are the Tiptap/ProseMirror inputs present in the reproducible bundle
metadata. There is no HTML parsing dependency, sanitizer dependency, JSDOM, or
linkedom. Sanitization is instead safe-by-construction: a strict typed JSON
schema rejects unknown data, semantic policies allowlist URLs and provider
identifiers, Asset facts are validated, text and attributes are escaped by the
static renderer, and iframe markup is generated only from fixed templates.

## Bundle and runtime behavior

`pnpm prototype:renderer:bundle` produced:

- uncompressed Worker file: 984,475 bytes
- Wrangler upload: 961.01 KiB
- gzip: 171.36 KiB
- bindings: none

The workerd suite observes `navigator.userAgent === "Cloudflare-Workers"`, no
global `document`, and no global `DOMParser`. The renderer itself requires the
standard Web `URL` API plus ordinary ECMAScript Promise/collection APIs. It
imports no `node:` module and requires no compatibility flag beyond the
project-wide `nodejs_compat` baseline.

## Provisional operation

The tested public seam is:

```ts
renderPublication(
  {
    documentSchemaVersion: number,
    doc: unknown,
  },
  {
    resolveAsset: (
      assetId: string,
    ) => Promise<ResolvedPublicationAsset | null>,
  },
): Promise<
  | {
      ok: true;
      value: {
        rendererVersion: 1;
        html: string;
        referencedAssets: ResolvedPublicationAsset[];
        referencedProviders: Array<{
          provider: "youtube" | "bilibili";
          id: string;
        }>;
      };
    }
  | {
      ok: false;
      issues: Array<{ code: string; path: string; message: string }>;
    }
>;
```

The operation returns deduplicated reference facts in first-document order.
An error result has no `value` or `html`, including when some earlier content
or Asset resolutions were valid.

Validation order is owned by the operation:

1. reject unsupported Document Schema Versions;
2. validate the strict JSON envelope, node/mark attributes, URL policies,
   figure accessibility, and provider identifiers with Zod;
3. materialize the document and validate nesting with the ProseMirror schema;
4. collect and resolve every referenced Asset, then validate its identity,
   absolute HTTPS URL, and intrinsic dimensions;
5. render the trusted model with the static renderer and fixed figure/provider
   mappings;
6. return the complete HTML fragment and reference facts.

The production refinements to the spec's provisional seam are the explicit
`documentSchemaVersion` name, asynchronous Asset resolver, and independent
`rendererVersion`. The all-or-nothing result and responsibility for validation
ordering are unchanged.

## Successful artifact

The representative workerd test renders paragraphs; h2-h4 headings; nested
ordered/unordered lists; blockquotes; code blocks; horizontal rules; hard
breaks; bold, italic, strike, inline code, and links; a resolved figure; and
YouTube/Bilibili embeds. Its deliberately stable fragment is:

```html
<h2>语义化 Publication</h2>
<h3>Portable</h3>
<h4>Safe</h4>
<p>
  <strong>Bold</strong> <em>Italic</em> <s>Strike</s>
  <code>inline &lt;code&gt;</code><br /><a
    href="https://example.com/a?b=1"
    rel="noopener noreferrer"
    >safe link</a
  >
</p>
<ul>
  <li>
    <p>Outer</p>
    <ol start="3">
      <li><p>Nested</p></li>
    </ol>
  </li>
</ul>
<blockquote><p>Quoted &amp; escaped</p></blockquote>
<pre><code data-language="typescript">&lt;script&gt;alert('no')&lt;/script&gt;</code></pre>
<hr />
<figure>
  <img
    src="https://media.example.com/assets/moon.webp"
    width="1200"
    height="800"
    alt="Moon over water"
  />
  <figcaption>Night &amp; tide</figcaption>
</figure>
<iframe
  src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
  title="YouTube example"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="encrypted-media; picture-in-picture; fullscreen"
  allowfullscreen=""
></iframe
><iframe
  src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"
  title="Bilibili example"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="fullscreen"
  allowfullscreen=""
></iframe>
```

It is an HTML fragment, not a complete document. The contract contains no
HeroUI, Tailwind, Tiptap, or ProseMirror classes; inline styles; event
attributes; React data; or author-controlled iframe attributes. Text, code,
captions, and attributes are escaped. Only the fixed
`https://www.youtube-nocookie.com/embed/` and
`https://player.bilibili.com/player.html?bvid=` provider locations are emitted.

## Hostile evidence

The workerd suite proves rejection of unsupported schema versions, raw HTML,
arbitrary iframe nodes and attributes, unknown nodes/marks, h1 content,
injected classes/styles/event handlers, JavaScript/data/control-character URL
schemes, malformed YouTube/Bilibili identifiers, invalid nesting, missing or
unsafe Asset facts, and missing non-decorative alt text. It also proves that
decorative figures force `alt=""` and that multiple Asset issues are returned
without partial HTML.

## Rejected paths

- Tiptap's built-in `generateHTML` path is DOM-dependent. The committed
  workerd probe fails concretely with `window is not defined` before it can
  serialize the document.
- Browser-DOM renderers and DOM-based sanitizers cannot run in the tested
  runtime as-is: both `document` and `DOMParser` are absent. Adding a DOM shim
  would expand the trusted code and bundle without helping this constrained
  source model, so this prototype does not select that path.
- Rendering permissive JSON and sanitizing afterward was rejected because it
  would silently normalize unsupported nodes/attributes instead of producing
  the actionable Publication issues required by the spec. Strict source
  rejection occurs before ProseMirror materialization and rendering.

The production renderer uses this static renderer path. Dependency upgrades
must rerun the workerd suite and bundle probe because the runtime and security
conclusions are version-specific.
