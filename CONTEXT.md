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
Site-wide public identity and default publication metadata. A default Byline or language participates in publication preparation only when the Draft does not provide an override.
_Avoid_: Administrator profile

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
feedback. An Interface Locale is independent of the content language stored on
an Article Draft or Publication.
_Avoid_: Article language, Byline language, browser language

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

The `zh-CN` Interface Locale uses **文章** for Article, **草稿** for Draft,
**草稿版本** for Draft Version, **发布版本** for Publication, **当前公开版本**
for Current Publication, **作者署名** for Byline, and **站点设置** for Site
Settings. The workflow verbs are **预览** (Preview) and **发布** (Publish);
`Changes pending` is **有待发布的修改**, and `Unpublished` is **未发布**.
Public presentation terms use **内建公开站** for Built-in Public Site,
**公开模板** for Public Template, **模板清单** for Template Manifest,
**已安装公开模板** for Installed Public Template, and **启用中的公开模板**
for Active Public Template.
