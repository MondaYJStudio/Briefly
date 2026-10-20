# Article Publication

Briefly manages authored work from a private mutable Draft through immutable Publications, while keeping public visibility explicit and reversible. The public reader experience is either the Built-in Public Site or an Active Public Template that consumes the public content API.

## Language

**Article**:
A stable content identity that owns exactly one mutable Draft and zero or more immutable Publications. Its public visibility is determined by its Current Publication.
_Avoid_: Draft, Publication, post

**Draft**:
The sole mutable working state of an Article. A Draft remains private until an explicit Publish creates a Publication from an exact saved version.
_Avoid_: Publication, public version

**Draft Version**:
The identity of one exact saved state of a Draft. Preview and Publish name a Draft Version so unsaved or concurrently replaced content cannot be mistaken for that state.
_Avoid_: Publication Version, editor revision

**Publication**:
An immutable snapshot created from an exact saved Draft after publication preparation succeeds. A Publication is public only while it is the Article's Current Publication.
_Avoid_: Draft, revision

**Current Publication**:
The Publication currently selected as an Article's public representation. An Article may have no Current Publication.
_Avoid_: published status

**Byline**:
Public authorship metadata carried by a Draft and stored in each Publication. A Draft may override the Site Settings default; a Byline is independent of the Administrator identity.
_Avoid_: Administrator, user account, author login

**Site Settings**:
Site-wide public identity and default publication metadata. A default Byline or language participates in publication preparation only when the Draft does not provide an override. Site Settings also carry **Public Site Enabled**, the gate for public reader HTML.
_Avoid_: Administrator profile

**Public Site Enabled**:
Whether public reader HTML paths are served to visitors. When off, those paths redirect to Admin; the public content API and public media remain available.
_Avoid_: site published, maintenance mode, unpublish all Articles

**Administrator**:
The single account that authors and administers a Briefly site. It is the identity behind a sign-in session and is never public authorship metadata.
_Avoid_: Byline, author, user account

**Administrator Session**:
The signed-in state of the Administrator for one request, resolved from the request's session cookie. Resolving it is a query: only the endpoint the admin shell polls renews the session, so an ordinary admin request cannot extend it. Every admin surface refuses a request without an Administrator Session, but each refuses in its own terms — a JSON 401 for API and private media paths, a redirect for admin documents.
_Avoid_: login, authentication check, session cookie

**Preview**:
A private, non-mutating publication rehearsal of an exact saved Draft. A successful Preview means the Draft passes the same preparation checks as Publish at that moment; only a later concurrent change or commit failure may still prevent Publish.
_Avoid_: shareable preview, approximate render

**Publish**:
The explicit operation that creates a new immutable Publication from an exact saved Draft and selects it as the Article's Current Publication. Publishing again creates another Publication rather than changing an existing one.
_Avoid_: save, update Publication

**Publication Workflow**:
The private process shared by Preview and Publish that determines whether an exact saved Draft can become a Publication and, for Publish, makes it the Current Publication.
_Avoid_: publishing service, publication pipeline

**Publication Conflict**:
The zero-side-effect result when the requested Draft Version or expected Current Publication is no longer current by the time the Publication Workflow attempts to act.
_Avoid_: Publication Issue, operational failure

**Publication Issue**:
A structured explanation of why an exact saved Draft cannot complete publication preparation, located by a stable Draft domain path. Preview and Publish report the same Publication Issues for the same state; concurrency conflicts and operational failures are not Publication Issues.
_Avoid_: transport error, form error

**Interface Locale**:
The language used by Briefly's product chrome, navigation, controls, and
feedback. An Interface Locale is selected from the Application Locale Registry
and is independent of the content language stored on an Article Draft or
Publication.
_Avoid_: Article language, Byline language, browser language

**Application Locale Registry**:
The closed, canonical set of locales that Briefly can use for interface copy
and localized Site Settings. It currently contains `en`, `zh-Hans`, `zh-Hant`,
`ja`, and `ko`; `zh-CN` is accepted only as a compatibility alias for
`zh-Hans`.
_Avoid_: arbitrary BCP 47 input, browser locale list

**Site Description Translations**:
The optional Site Settings descriptions keyed by Application Locale. A request
selects one locale using the shared URL → persisted Cookie → `Accept-Language`
→ default precedence; an explicit switch writes the Cookie, and Paraglide may
also seed it from the first browser negotiation. A missing translation falls
back to English and then to empty.
_Avoid_: translated Article summary, interface message

**Article Content Language**:
The valid BCP 47 language tag stored on a Draft or Publication. It is separate
from the Application Locale Registry; the editor offers curated presets but
retains arbitrary valid tags so authored content is not rewritten by an
interface-language choice.
_Avoid_: Interface Locale, Site Description translation

**Channel**:
A named content partition on one Briefly installation, used so public API
consumers can request different Current Publication sets without sharing
Article tags. An Article belongs to at most one Channel, and may belong to
none. Channels are maintained as an Administrator-managed registry (stable
slug and display name), not as freeform Article metadata. Like other Draft
publication metadata, an Article's Channel is selected on the Draft and
becomes part of a Publication only through Publish. Channel is not a Site,
deployment, or tenant.
_Avoid_: Site, Tag, tenant, multi-site, multi-channel Article, required Channel,
live Draft override of public Channel filtering

**Connected App**:
An MCP client the Administrator has authorized through OAuth to act on their
behalf: read Articles and Channels, save Drafts, Preview, and Publish. Every
authorization passes an explicit consent page, and disconnecting a Connected
App revokes its tokens immediately. A Connected App is not an Administrator,
a Byline, or a second account.
_Avoid_: API key, integration, user, bot account

**Built-in Public Site**:
The product's own public reader UI. It serves public reader paths whenever no Active Public Template is selected.
_Avoid_: default template, official template, theme

**Public Template**:
A versioned static site package with a Template Manifest. It is installed from a local upload or a URL and renders the public reader experience by calling the public content API. Site Settings remain the source of site identity; a template's own settings cover only that template's presentation options.
_Avoid_: theme, skin, site theme, page template

**Template Manifest**:
The metadata declared by a Public Template package (stable id, version, display name, and template-specific presentation options).
_Avoid_: package.json, theme config

**Installed Public Template**:
A Public Template present on the site. Many may be installed; reinstalling the same manifest id replaces that installation in place.
_Avoid_: uploaded theme, template copy

**Active Public Template**:
The at-most-one Installed Public Template currently serving public reader paths (all non-API, non-admin public paths, with SPA fallback). Selecting or replacing it takes effect immediately for visitors. When none is active, the Built-in Public Site serves those paths.
_Avoid_: current theme, published template, enabled skin

### Simplified Chinese labels

The `zh-Hans` Interface Locale (with legacy `zh-CN` URL/cookie alias) uses
**文章** for Article, **草稿** for Draft,
**草稿版本** for Draft Version, **发布版本** for Publication, **当前公开版本**
for Current Publication, **作者署名** for Byline, and **站点设置** for Site
Settings. Identity terms use **管理员** for Administrator and **管理员会话** for
Administrator Session. The workflow verbs are **预览** (Preview) and **发布** (Publish);
`Changes pending` is **有待发布的修改**, and `Unpublished` is **未发布**.
Public presentation terms use **内建公开站** for Built-in Public Site,
**公开站开关** for Public Site Enabled,
**公开模板** for Public Template, **模板清单** for Template Manifest,
**已安装公开模板** for Installed Public Template, and **启用中的公开模板**
for Active Public Template. Content partition terms use **频道** for Channel. Agent access uses
**已连接应用** for Connected App.
