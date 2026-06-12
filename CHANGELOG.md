# Changelog

All notable changes to MoKnow are documented in this file.

The format follows Keep a Changelog, and versions follow Semantic Versioning.

## [Unreleased]

### Added

- Chinese Makefile help and one-command project startup entries.
- Real local repository creation, opening, file tree loading, Markdown reading, and saving.
- Diary-first workflow with auto-open today, diary templates, date variables, calendar status, recent files, pinned files, favorites, inbox, and organize view.
- Safer writing with autosave, draft recovery, external change detection, conflict handling, and copy-on-conflict.
- Markdown editing improvements including shortcuts, task toggles, attachments, outline navigation, focus writing, typewriter mode, fullscreen writing, synced split scrolling, advanced rendering, and wiki links/backlinks.
- Metadata, frontmatter, tags, full-text search, command palette, and global tag maintenance.
- App lock, HTML export, zip backup, and restore-latest-backup flow.
- General settings panel with persisted theme preference, system theme, and custom appearance basics.
- Release workflow for tagged GitHub Releases with macOS, Windows, and Linux Tauri bundle builds.
- Manual Release dry-run workflow for macOS, Windows, and Linux bundle validation before tagging.
- GitHub CLI `release:dry-run` automation for dispatching the workflow, waiting for completion, downloading artifacts, and running download verification.
- Local release check scripts and Makefile release targets for version, changelog, workflow, test, frontend build, and optional desktop build verification.
- AI provider E2E verification script that records real OpenAI-compatible smoke test results without storing API keys.
- AI provider preflight script that records missing endpoint/model/key prerequisites without calling a real model or storing credentials.
- Local OpenAI-compatible mock AI E2E harness for validating authentication, non-streaming JSON parsing, and streaming SSE parsing before real provider runs.
- Release artifact verification script, GitHub Actions artifact upload, and Tauri updater plugin wiring for release readiness checks.
- Release metadata generation for updater `latest.json`, download checksums, and Homebrew cask templates.
- Release install smoke verification script for checking generated app/installer entry points and writing manual open/read-write checklists.
- Release signing verification script for macOS codesign/Gatekeeper/stapler checks and Windows Authenticode verification.
- Release CI preflight script for checking GitHub CLI auth, local workflow coverage, git tracking, and remote workflow availability before dry-run dispatch.
- CI release workflows now generate and upload install smoke and signing verification reports alongside platform bundles.
- In-app command palette entry for checking Tauri desktop app updates, with browser-preview unsupported-state handling.
- Tauri updater config preparation script for injecting release pubkey and endpoints during CI builds without committing secrets or placeholder keys.
- Downloaded artifact verification script that scans dry-run or release artifact folders and writes JSON/Markdown verification reports.
- External release readiness report for redacted AI, updater, signing, notarization, distribution URL, and Homebrew tap environment checks.

### Changed

- Split frontend build chunks so the main application entry stays smaller while heavy Markdown, KaTeX, Mermaid, Ant Design, and highlighting code live in separate chunks.
- Split the KaTeX formula runtime into smaller on-demand chunks by loading the min runtime entry.
- Moved the Mermaid runtime out of the Vite application chunk graph into a generated static vendor runtime that is loaded only when Mermaid diagrams are present.
- Documented current verification status and remaining product gaps in `README.md` and `项目文档/项目进度.md`.

### Known Gaps

- External AI provider credentials, remote CI release dry runs, signing/notarization credentials, updater signing keys, and release distribution channels still require real external configuration before final release.
