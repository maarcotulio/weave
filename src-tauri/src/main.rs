use chrono::{Duration, Local, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::{Component, Path, PathBuf}, sync::Mutex};
use tauri::State;
use uuid::Uuid;

const DOCUMENT_FORMAT_VERSION: u8 = 1;

fn timestamp() -> String { Utc::now().to_rfc3339() }
fn id(prefix: &str) -> String { format!("{}-{}", prefix, Uuid::new_v4()) }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project { id: String, name: String, directory: String, schema_version: i64, created_at: String, updated_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Story { id: String, project_id: String, title: String, position: i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Chapter { id: String, story_id: String, title: String, position: i64, active_scene_set_id: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SceneSet { id: String, chapter_id: String, created_at: String, #[serde(skip_serializing_if = "Option::is_none")] source_revision_id: Option<String>, active: bool }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Scene { id: String, scene_set_id: String, title: String, position: i64, document_id: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldbuildingItem { id: String, project_id: String, kind: String, title: String, #[serde(default)] aliases: Vec<String>, #[serde(default)] properties: serde_json::Value, revision: i64, created_at: String, updated_at: String }
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorldbuildingInput { #[serde(default)] kind: String, title: String, #[serde(default)] aliases: Vec<String>, #[serde(default = "empty_properties")] properties: serde_json::Value }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DomainRelationship { id: String, source_id: String, target_id: String, #[serde(rename = "type")] relation_type: String, created_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentAnchor { document_id: String, block_id: String, start: i64, end: i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentLink { id: String, anchor: DocumentAnchor, #[serde(skip_serializing_if = "Option::is_none")] target_id: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] unresolved_label: Option<String>, created_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownNote { id: String, project_id: String, title: String, markdown: String, revision: i64, created_at: String, updated_at: String }
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownNoteInput { title: String, markdown: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteLink { id: String, note_id: String, #[serde(skip_serializing_if = "Option::is_none")] target_id: Option<String>, target_text: String, #[serde(skip_serializing_if = "Option::is_none")] label: Option<String>, start: i64, end: i64, occurrence: i64, created_at: String }
#[derive(Clone)]
struct ParsedWikiLink { target_text: String, label: Option<String>, start: i64, end: i64, occurrence: i64 }
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Backlink { Relationship { id: String, source_id: String, source_title: String, #[serde(rename = "type")] relation_type: String }, Document { id: String, source_id: String, source_title: String, anchor: DocumentAnchor }, Note { id: String, source_id: String, source_title: String, note_id: String, start: i64, end: i64, #[serde(skip_serializing_if = "Option::is_none")] label: Option<String> } }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasViewport { x: f64, y: f64, zoom: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasPosition { x: f64, y: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasTitleInput { title: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoryCanvas { id: String, story_id: String, title: String, viewport: CanvasViewport, #[serde(default = "default_canvas_engine")] engine: String, #[serde(default, skip_serializing_if = "Option::is_none")] excalidraw_state: Option<serde_json::Value>, revision: i64, created_at: String, updated_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasNode { id: String, canvas_id: String, entity_id: String, position: CanvasPosition }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasEdge { id: String, canvas_id: String, source_node_id: String, target_node_id: String, #[serde(default)] note_link_id: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasProjectionNode { id: String, canvas_id: String, entity_id: String, position: CanvasPosition, entity_kind: String, label: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasProjection { canvas: StoryCanvas, nodes: Vec<CanvasProjectionNode>, edges: Vec<CanvasEdge> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasPositionUpdate { id: String, position: CanvasPosition }
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRun { text: String, marks: Vec<String> }
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentBlock { id: String, kind: String, #[serde(skip_serializing_if = "Option::is_none")] heading_level: Option<u8>, #[serde(skip_serializing_if = "Option::is_none")] alignment: Option<String>, runs: Vec<TextRun> }
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document { format_version: u8, blocks: Vec<DocumentBlock> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Revision { id: String, document_id: String, number: i64, document: Document, created_at: String, reason: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentRecord { id: String, head_revision: i64, revisions: Vec<Revision> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionSummary { id: String, project_id: String, label: String, created_at: String, word_count: i64, scene_count: i64, chapter_count: i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionDocument { document_id: String, revision: Revision }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionSnapshot {
    #[serde(default)] stories: Vec<Story>, #[serde(default)] chapters: Vec<Chapter>, #[serde(default)] scene_sets: Vec<SceneSet>, #[serde(default)] scenes: Vec<Scene>, #[serde(default)] continuous_drafts: Vec<ContinuousDraft>, #[serde(default)] documents: Vec<ManuscriptVersionDocument>
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredManuscriptVersion { summary: ManuscriptVersionSummary, snapshot: ManuscriptVersionSnapshot }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionDetail { summary: ManuscriptVersionSummary, snapshot: ManuscriptVersionSnapshot }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionChange { kind: String, change: String, id: String, #[serde(skip_serializing_if = "Option::is_none")] label: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] before_label: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] after_label: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] before_document: Option<Document>, #[serde(skip_serializing_if = "Option::is_none")] after_document: Option<Document> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManuscriptVersionComparison { from: ManuscriptVersionSummary, to: ManuscriptVersionSummary, changes: Vec<ManuscriptVersionChange> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreManuscriptVersionResult { status: OperationStatus, backup: BackupRecord }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContinuousDraft { id: String, chapter_id: String, document_id: String, base_scene_set_id: String, source_revision_id: String, status: String, created_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRecord { id: String, path: String, created_at: String, integrity: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationStatus { state: String, message: String, at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextMargins { top: f64, right: f64, bottom: f64, left: f64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorStyleProfile { font_family: String, font_size_pt: f64, line_spacing: String, #[serde(default = "default_page_size")] page_size: String, #[serde(default = "default_text_margins")] text_margins: TextMargins }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingGoals { daily_target: i64, #[serde(default)] daily_word_counts: std::collections::HashMap<String, i64> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritingActivity { date: String, words: i64 }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritingStats { date: String, daily_target: i64, daily_words: i64, project_words: i64, sessions: i64, current_streak: i64, longest_streak: i64, average_words_per_day: i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    project: Option<Project>, stories: Vec<Story>, chapters: Vec<Chapter>, scene_sets: Vec<SceneSet>, scenes: Vec<Scene>, documents: Vec<DocumentRecord>, drafts: Vec<ContinuousDraft>, backups: Vec<BackupRecord>,
    #[serde(default)] worldbuilding_items: Vec<WorldbuildingItem>, #[serde(default)] relationships: Vec<DomainRelationship>, #[serde(default)] document_links: Vec<DocumentLink>, #[serde(default)] markdown_notes: Vec<MarkdownNote>, #[serde(default)] note_links: Vec<NoteLink>, #[serde(default)] canvases: Vec<StoryCanvas>, #[serde(default)] canvas_nodes: Vec<CanvasNode>, #[serde(default)] canvas_edges: Vec<CanvasEdge>, #[serde(default)] manuscript_versions: Vec<StoredManuscriptVersion>,
    #[serde(default = "default_style_profile")] style_profile: EditorStyleProfile,
    #[serde(default = "default_writing_goals")] writing_goals: WritingGoals,
    status: OperationStatus,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot { project: Project, stories: Vec<Story>, chapters: Vec<Chapter>, scene_sets: Vec<SceneSet>, scenes: Vec<Scene>, continuous_drafts: Vec<ContinuousDraft>, markdown_notes: Vec<MarkdownNote>, note_links: Vec<NoteLink>, canvases: Vec<StoryCanvas>, backups: Vec<BackupRecord>, style_profile: EditorStyleProfile, writing_stats: WritingStats, writing_activity: Vec<WritingActivity>, manuscript_versions: Vec<ManuscriptVersionSummary>, status: OperationStatus }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentHead { document_id: String, document: Document, revision: i64, revision_id: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult { revision: Revision, status: OperationStatus }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityReport { ok: bool, message: String, checked_at: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SplitResult { scene_set: SceneSet, scenes: Vec<Scene>, source_revision_id: String }

fn empty_properties() -> serde_json::Value { serde_json::json!({}) }
fn default_page_size() -> String { "letter".into() }
fn default_text_margins() -> TextMargins { TextMargins { top: 44.0, right: 72.0, bottom: 30.0, left: 72.0 } }
fn default_canvas_engine() -> String { "react-flow".into() }
fn valid_canvas_engine(value: &str) -> bool { value == "react-flow" || value == "excalidraw" }
fn default_style_profile() -> EditorStyleProfile { EditorStyleProfile { font_family: "Times New Roman".into(), font_size_pt: 12.0, line_spacing: "double".into(), page_size: default_page_size(), text_margins: default_text_margins() } }
fn default_writing_goals() -> WritingGoals { WritingGoals { daily_target: 500, daily_word_counts: std::collections::HashMap::new() } }
impl Default for OperationStatus { fn default() -> Self { Self { state: "idle".into(), message: "Ready".into(), at: timestamp() } } }
impl Default for Store { fn default() -> Self { Self { project: None, stories: vec![], chapters: vec![], scene_sets: vec![], scenes: vec![], documents: vec![], drafts: vec![], backups: vec![], worldbuilding_items: vec![], relationships: vec![], document_links: vec![], markdown_notes: vec![], note_links: vec![], canvases: vec![], canvas_nodes: vec![], canvas_edges: vec![], manuscript_versions: vec![], style_profile: default_style_profile(), writing_goals: default_writing_goals(), status: OperationStatus::default() } } }

struct AppState { root: Option<PathBuf>, store: Store }
impl Default for AppState { fn default() -> Self { Self { root: None, store: Store::default() } } }
impl AppState {
    fn db_path(&self) -> Result<PathBuf, String> {
        let root = self.root.as_ref().ok_or_else(|| "No project is open".to_string())?;
        safe_database_path(root, true)
    }
    fn persist(&self) -> Result<(), String> {
        let path = self.db_path()?;
        let json = serde_json::to_string(&self.store).map_err(|e| e.to_string())?;
        let connection = Connection::open(&path).map_err(|e| e.to_string())?;
        connection.execute("INSERT INTO project_state(id, state_json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at", params![json, timestamp()]).map_err(|e| e.to_string())?;
        let files = path.parent().ok_or_else(|| "Project database has no parent directory".to_string())?.join("files");
        ensure_existing_directory(&files, "project files directory")?;
        let latest = files.join("latest.json");
        ensure_safe_write_target(&latest, "latest project state")?;
        fs::write(latest, json).map_err(|e| e.to_string())
    }
}

fn validate_project_root(root: &Path) -> Result<(), String> {
    if root.as_os_str().is_empty() { return Err("A project directory is required".into()); }
    if root.to_string_lossy().contains('\0') { return Err("The project directory contains an invalid character".into()); }
    for component in root.components() {
        match component {
            Component::CurDir | Component::ParentDir => return Err("Choose a project directory without traversal aliases".into()),
            Component::Normal(value) if value == ".weave" => return Err("Choose the project directory, not its .weave folder".into()),
            _ => {}
        }
    }
    Ok(())
}

fn normalized_project_directory(root: &Path) -> Result<String, String> {
    validate_project_root(root)?;
    let mut normalized = PathBuf::new();
    for component in root.components() { normalized.push(component.as_os_str()); }
    Ok(normalized.to_string_lossy().into_owned())
}

/// Creates only non-symlink directories, checking every existing component.
/// These checks are not race-proof: another process can replace a path after
/// validation, so this remains a best-effort safeguard at the filesystem API boundary.
fn ensure_directory_chain(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(format!("Unsafe symlink in project path: {}", current.display())),
            Ok(metadata) if metadata.is_dir() => {}
            Ok(_) => return Err(format!("Project path is not a directory: {}", current.display())),
            Err(error) if error.kind() == ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| format!("Cannot create project directory {}: {error}", current.display()))?;
                let metadata = fs::symlink_metadata(&current).map_err(|error| error.to_string())?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() { return Err(format!("Unsafe project directory: {}", current.display())); }
            }
            Err(error) => return Err(format!("Cannot inspect project path {}: {error}", current.display())),
        }
    }
    Ok(())
}

fn ensure_existing_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| format!("Cannot inspect {label}: {error}"))?;
    if metadata.file_type().is_symlink() { return Err(format!("Unsafe symlink for {label}")); }
    if !metadata.is_dir() { return Err(format!("{label} is not a directory")); }
    Ok(())
}

fn ensure_safe_file(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!("Unsafe symlink for {label}")),
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(format!("{label} is not a regular file")),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(format!("{label} does not exist")),
        Err(error) => Err(format!("Cannot inspect {label}: {error}")),
    }
}

fn ensure_safe_write_target(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!("Unsafe symlink for {label}")),
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(format!("{label} is not a regular file")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot inspect {label}: {error}")),
    }
}

fn safe_database_path(root: &Path, require_existing: bool) -> Result<PathBuf, String> {
    validate_project_root(root)?;
    ensure_existing_directory(root, "project directory")?;
    let weave = root.join(".weave");
    ensure_existing_directory(&weave, ".weave directory")?;
    ensure_existing_directory(&weave.join("files"), "project files directory")?;
    ensure_existing_directory(&weave.join("backups"), "project backups directory")?;
    let db = weave.join("project.db");
    if require_existing { ensure_safe_file(&db, "project database")?; }
    for sidecar in ["project.db-wal", "project.db-shm"] {
        let path = weave.join(sidecar);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(format!("Unsafe symlink for database sidecar {sidecar}")),
            Ok(metadata) if !metadata.is_file() => return Err(format!("Database sidecar {sidecar} is not a regular file")),
            Ok(_) => {},
            Err(error) if error.kind() == ErrorKind::NotFound => {},
            Err(error) => return Err(format!("Cannot inspect database sidecar {sidecar}: {error}")),
        }
    }
    Ok(db)
}

fn database_for(root: &Path, allow_create: bool) -> Result<PathBuf, String> {
    validate_project_root(root)?;
    ensure_directory_chain(root)?;
    let weave = root.join(".weave");
    ensure_directory_chain(&weave.join("files"))?;
    ensure_directory_chain(&weave.join("backups"))?;
    let db = weave.join("project.db");
    match fs::symlink_metadata(&db) {
        Ok(metadata) if metadata.file_type().is_symlink() => return Err("Unsafe symlink for project database".into()),
        Ok(metadata) if !metadata.is_file() => return Err("Project database is not a regular file".into()),
        Ok(_) if !allow_create => {},
        Ok(_) => return Err("A Weave project already exists at this directory".into()),
        Err(error) if error.kind() == ErrorKind::NotFound && allow_create => {},
        Err(error) if error.kind() == ErrorKind::NotFound => return Err("No Weave project was found at this directory".into()),
        Err(error) => return Err(format!("Cannot inspect project database: {error}")),
    }
    // Validate SQLite sidecars before opening in WAL mode; SQLite may create or
    // use them during the connection, so symlinks must be rejected first.
    safe_database_path(root, false)?;
    let connection = Connection::open(&db).map_err(|e| e.to_string())?;
    ensure_safe_file(&db, "project database")?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_state(id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, path TEXT NOT NULL, created_at TEXT NOT NULL, integrity TEXT NOT NULL, state_json TEXT NOT NULL);").map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    Ok(db)
}
fn load_store(db: &Path) -> Result<Store, String> {
    let connection = Connection::open(db).map_err(|e| e.to_string())?;
    let value: Option<String> = connection.query_row("SELECT state_json FROM project_state WHERE id=1", [], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    value.map(|json| serde_json::from_str(&json).map_err(|e| e.to_string())).transpose().map(|store| store.unwrap_or_default())
}

fn status(state: &mut AppState, state_name: &str, message: &str) { state.store.status = OperationStatus { state: state_name.into(), message: message.into(), at: timestamp() }; }
fn story<'a>(store: &'a Store, key: &str) -> Result<&'a Story, String> { store.stories.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown story {key}")) }
fn chapter<'a>(store: &'a Store, key: &str) -> Result<&'a Chapter, String> { store.chapters.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown chapter {key}")) }
fn document_record<'a>(store: &'a Store, key: &str) -> Result<&'a DocumentRecord, String> { store.documents.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown document {key}")) }
fn document_mut<'a>(store: &'a mut Store, key: &str) -> Result<&'a mut DocumentRecord, String> { store.documents.iter_mut().find(|item| item.id == key).ok_or_else(|| format!("Unknown document {key}")) }
fn draft<'a>(store: &'a Store, key: &str) -> Result<&'a ContinuousDraft, String> { store.drafts.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown draft {key}")) }
fn draft_mut<'a>(store: &'a mut Store, key: &str) -> Result<&'a mut ContinuousDraft, String> { store.drafts.iter_mut().find(|item| item.id == key).ok_or_else(|| format!("Unknown draft {key}")) }
fn worldbuilding_item<'a>(store: &'a Store, key: &str) -> Result<&'a WorldbuildingItem, String> { store.worldbuilding_items.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown worldbuilding item {key}")) }
fn markdown_note<'a>(store: &'a Store, key: &str) -> Result<&'a MarkdownNote, String> { store.markdown_notes.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown Markdown note {key}")) }
fn relationship<'a>(store: &'a Store, key: &str) -> Result<&'a DomainRelationship, String> { store.relationships.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown relationship {key}")) }
fn canvas<'a>(store: &'a Store, key: &str) -> Result<&'a StoryCanvas, String> { store.canvases.iter().find(|item| item.id == key).ok_or_else(|| format!("Unknown canvas {key}")) }
fn canvas_node<'a>(store: &'a Store, canvas_id: &str, key: &str) -> Result<&'a CanvasNode, String> { store.canvas_nodes.iter().find(|item| item.canvas_id == canvas_id && item.id == key).ok_or_else(|| format!("Unknown canvas node {key}")) }
fn entity(store: &Store, key: &str) -> Result<(String, String), String> {
    if let Some(item) = store.worldbuilding_items.iter().find(|item| item.id == key) { return Ok((item.kind.clone(), item.title.clone())); }
    if let Some(item) = store.chapters.iter().find(|item| item.id == key) { return Ok(("chapter".into(), item.title.clone())); }
    if let Some(item) = store.scenes.iter().find(|item| item.id == key) { return Ok(("scene".into(), item.title.clone())); }
    if let Some(item) = store.markdown_notes.iter().find(|item| item.id == key) { return Ok(("note".into(), item.title.clone())); }
    Err(format!("Unknown relationship entity {key}"))
}
fn relationship_type(value: &str) -> bool { ["contains", "located-in", "appears-in", "knows", "allied-with", "opposes", "mentions", "related-to"].contains(&value) }
fn validate_relationship(store: &Store, source_id: &str, target_id: &str, relation_type: &str) -> Result<(), String> { if source_id == target_id { return Err("A relationship must connect two different items".into()); } entity(store, source_id)?; entity(store, target_id)?; if !relationship_type(relation_type) { return Err("Unsupported relationship type".into()); } Ok(()) }
fn validate_properties(kind: &str, title: &str, aliases: &[String], properties: &serde_json::Value) -> Result<(), String> {
    if !["world", "place", "character", "term"].contains(&kind) { return Err("Unsupported worldbuilding item type".into()); }
    if title.trim().is_empty() { return Err("A title is required".into()); }
    if aliases.iter().any(|alias| alias.trim().is_empty()) { return Err("Aliases cannot be empty".into()); }
    let fields = properties.as_object().ok_or_else(|| "Structured properties are required".to_string())?;
    let allowed: &[&str] = match kind { "world" => &["genre", "era", "summary"], "place" => &["placeType", "region", "description"], "character" => &["role", "pronouns", "summary"], "term" => &["category", "definition"], _ => &[] };
    for (key, value) in fields { if !allowed.contains(&key.as_str()) || !value.is_string() { return Err("Unsupported structured property".into()); } }
    Ok(())
}
fn validate_anchor(store: &Store, anchor: &DocumentAnchor) -> Result<(), String> { if anchor.start < 0 || anchor.end < anchor.start { return Err("Document link offsets are invalid".into()); } let record = document_record(store, &anchor.document_id)?; let document = record.revisions.last().ok_or_else(|| "Document has no revision".to_string())?; let block = document.document.blocks.iter().find(|block| block.id == anchor.block_id).ok_or_else(|| "Document link anchor does not point to the current structured document".to_string())?; if anchor.end as usize > block_text(block).encode_utf16().count() { return Err("Document link anchor does not point to the current structured document".into()); } Ok(()) }
fn document_title(store: &Store, document_id: &str) -> String { if let Some(scene) = store.scenes.iter().find(|scene| scene.document_id == document_id) { return scene.title.clone(); } if store.drafts.iter().any(|draft| draft.document_id == document_id) { return "Continuous draft".into(); } "Document".into() }
fn valid_position(position: &CanvasPosition) -> bool { position.x.is_finite() && position.y.is_finite() }
fn entity_in_story(store: &Store, entity_id: &str, story_id: &str) -> bool { if let Some(chapter) = store.chapters.iter().find(|chapter| chapter.id == entity_id) { return chapter.story_id == story_id; } if let Some(scene) = store.scenes.iter().find(|scene| scene.id == entity_id) { return store.scene_sets.iter().find(|set| set.id == scene.scene_set_id).and_then(|set| store.chapters.iter().find(|chapter| chapter.id == set.chapter_id)).map(|chapter| chapter.story_id == story_id).unwrap_or(false); } true }
/** Only bracket tokens are parsed; no surrounding prose is interpreted as a link. */
fn parse_wiki_links(markdown: &str) -> Vec<ParsedWikiLink> {
    let mut links = vec![]; let mut offset = 0; let mut occurrences: std::collections::HashMap<(String, Option<String>), i64> = std::collections::HashMap::new();
    while let Some(relative_start) = markdown[offset..].find("[[") {
        let start_byte = offset + relative_start; let content_start = start_byte + 2;
        let Some(relative_end) = markdown[content_start..].find("]]" ) else { break; };
        let end_byte = content_start + relative_end + 2; let content = &markdown[content_start..content_start + relative_end];
        if !content.contains('[') && !content.contains(']') && content.matches('|').count() <= 1 {
            let (target, label) = content.split_once('|').map(|(target, label)| (target.trim(), (!label.trim().is_empty()).then(|| label.trim().to_string()))).unwrap_or((content.trim(), None));
            if !target.is_empty() { let key = (target.to_string(), label.clone()); let occurrence = *occurrences.get(&key).unwrap_or(&0); occurrences.insert(key, occurrence + 1); links.push(ParsedWikiLink { target_text: target.into(), label, start: markdown[..start_byte].encode_utf16().count() as i64, end: markdown[..end_byte].encode_utf16().count() as i64, occurrence }); }
        }
        offset = end_byte;
    }
    links
}
fn resolve_wiki_target(store: &Store, target_text: &str) -> Option<String> { let target = target_text.trim().to_lowercase(); let mut candidates: Vec<String> = store.markdown_notes.iter().filter(|note| note.title.to_lowercase() == target).map(|note| note.id.clone()).collect(); (candidates.len() == 1).then(|| candidates.remove(0)) }
fn rebuild_note_links(store: &Store, note: &MarkdownNote, previous: &[NoteLink]) -> Vec<NoteLink> { parse_wiki_links(&note.markdown).into_iter().map(|parsed| { let existing = previous.iter().find(|link| link.target_text == parsed.target_text && link.label == parsed.label && link.occurrence == parsed.occurrence); let target_id = existing.and_then(|link| link.target_id.clone()).filter(|target_id| markdown_note(store, target_id).is_ok()).or_else(|| resolve_wiki_target(store, &parsed.target_text)); NoteLink { id: existing.map(|link| link.id.clone()).unwrap_or_else(|| id("note-link")), note_id: note.id.clone(), target_id, target_text: parsed.target_text, label: parsed.label, start: parsed.start, end: parsed.end, occurrence: parsed.occurrence, created_at: existing.map(|link| link.created_at.clone()).unwrap_or_else(timestamp) } }).collect() }
fn empty_document() -> Document { Document { format_version: DOCUMENT_FORMAT_VERSION, blocks: vec![DocumentBlock { id: id("block"), kind: "paragraph".into(), heading_level: None, alignment: None, runs: vec![TextRun { text: String::new(), marks: vec![] }] }] } }
fn validate_document(value: &Document) -> Result<(), String> { if value.format_version != DOCUMENT_FORMAT_VERSION { return Err("Unsupported document format".into()); } for block in &value.blocks { if !["paragraph", "heading", "scene-break"].contains(&block.kind.as_str()) { return Err("Unsupported block kind".into()); } } Ok(()) }
fn block_text(block: &DocumentBlock) -> String { block.runs.iter().map(|run| run.text.as_str()).collect() }
fn explicit_marker(block: &DocumentBlock) -> bool { block.kind == "paragraph" && ["***", "Nova cena"].contains(&block_text(block).trim()) }
fn word_count(value: &str) -> i64 { let mut count = 0; let mut in_word = false; for character in value.chars() { if character.is_alphanumeric() { if !in_word { count += 1; in_word = true; } } else if character != '\'' && character != '’' { in_word = false; } } count }
fn document_word_count(document: &Document) -> i64 { document.blocks.iter().filter(|block| block.kind != "scene-break" && !explicit_marker(block)).map(|block| word_count(&block_text(block))).sum() }
fn project_word_count(store: &Store) -> i64 {
    store.chapters.iter().map(|chapter| {
        let draft = store.drafts.iter().filter(|draft| draft.chapter_id == chapter.id && draft.status == "open").max_by(|left, right| left.created_at.cmp(&right.created_at));
        if let Some(draft) = draft { return document_record(store, &draft.document_id).ok().and_then(|record| record.revisions.last()).map(|revision| document_word_count(&revision.document)).unwrap_or(0); }
        store.scenes.iter().filter(|scene| scene.scene_set_id == chapter.active_scene_set_id).filter_map(|scene| document_record(store, &scene.document_id).ok()).filter_map(|record| record.revisions.last()).map(|revision| document_word_count(&revision.document)).sum()
    }).sum()
}
fn local_date() -> String { Local::now().format("%Y-%m-%d").to_string() }
fn valid_writing_date(value: &str) -> Option<NaiveDate> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' { return None; }
    if !bytes.iter().enumerate().all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit()) { return None; }
    // JavaScript's Date(year, ...) treats years 0..=99 as 1900..=1999; keep
    // the Rust adapter on the same date set as the domain's calendar check.
    let year = value[..4].parse::<i32>().ok()?;
    if year < 100 { return None; }
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    (date.format("%Y-%m-%d").to_string() == value).then_some(date)
}

fn writing_metrics(store: &Store, today: &str) -> (i64, i64, i64, i64) {
    let valid_entries: Vec<(NaiveDate, i64)> = store.writing_goals.daily_word_counts.iter()
        .filter_map(|(date, words)| valid_writing_date(date).map(|date| (date, (*words).max(0))))
        .collect();
    let mut dates: Vec<NaiveDate> = valid_entries.iter()
        .filter(|(_, words)| *words > 0)
        .map(|(date, _)| *date)
        .collect();
    dates.sort(); dates.dedup();
    if dates.is_empty() { return (0, 0, 0, 0); }
    let mut longest = 1_i64; let mut run = 1_i64;
    for pair in dates.windows(2) { if pair[1] - pair[0] == Duration::days(1) { run += 1; } else { run = 1; } longest = longest.max(run); }
    let today_date = valid_writing_date(today).unwrap_or_else(|| Local::now().date_naive());
    let mut current = 0_i64;
    if dates.last() == Some(&today_date) { current = 1; for pair in dates.windows(2).rev() { if pair[1] - pair[0] != Duration::days(1) { break; } current += 1; } }
    let total: i64 = valid_entries.iter().map(|(_, words)| *words).sum();
    (dates.len() as i64, current, longest, (total as f64 / dates.len() as f64).round() as i64)
}
fn make_writing_stats(store: &Store) -> WritingStats { let date = local_date(); let (sessions, current_streak, longest_streak, average_words_per_day) = writing_metrics(store, &date); WritingStats { date: date.clone(), daily_target: store.writing_goals.daily_target, daily_words: (*store.writing_goals.daily_word_counts.get(&date).unwrap_or(&0)).max(0), project_words: project_word_count(store), sessions, current_streak, longest_streak, average_words_per_day } }
fn make_writing_activity(store: &Store, days: usize) -> Vec<WritingActivity> {
    let mut values: Vec<WritingActivity> = store.writing_goals.daily_word_counts.iter().map(|(date, words)| WritingActivity { date: date.clone(), words: (*words).max(0) }).collect();
    values.sort_by(|left, right| left.date.cmp(&right.date));
    if values.len() > days { values.drain(0..values.len() - days); }
    values
}
fn manuscript_version_summaries(store: &Store) -> Vec<ManuscriptVersionSummary> {
    let mut values: Vec<ManuscriptVersionSummary> = store.manuscript_versions.iter().rev().map(|version| version.summary.clone()).collect();
    values.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    values
}
fn manuscript_version<'a>(store: &'a Store, version_id: &str) -> Result<&'a StoredManuscriptVersion, String> { store.manuscript_versions.iter().find(|version| version.summary.id == version_id).ok_or_else(|| format!("Unknown manuscript version {version_id}")) }
fn manuscript_version_detail(store: &Store, version_id: &str) -> Result<ManuscriptVersionDetail, String> { let version = manuscript_version(store, version_id)?; Ok(ManuscriptVersionDetail { summary: version.summary.clone(), snapshot: version.snapshot.clone() }) }
fn json_record_changes(kind: &str, before: Vec<serde_json::Value>, after: Vec<serde_json::Value>) -> Vec<ManuscriptVersionChange> {
    let mut left = std::collections::BTreeMap::new(); let mut right = std::collections::BTreeMap::new();
    for value in before { if let Some(id) = value.get("id").and_then(|value| value.as_str()) { left.insert(id.to_string(), value); } }
    for value in after { if let Some(id) = value.get("id").and_then(|value| value.as_str()) { right.insert(id.to_string(), value); } }
    let mut ids: Vec<String> = left.keys().chain(right.keys()).cloned().collect(); ids.sort(); ids.dedup();
    ids.into_iter().filter_map(|id| { let previous = left.get(&id); let next = right.get(&id); match (previous, next) {
        (None, Some(value)) => Some(ManuscriptVersionChange { kind: kind.into(), change: "added".into(), id, label: value.get("title").and_then(|value| value.as_str()).map(str::to_string), before_label: None, after_label: None, before_document: None, after_document: None }),
        (Some(value), None) => Some(ManuscriptVersionChange { kind: kind.into(), change: "removed".into(), id, label: value.get("title").and_then(|value| value.as_str()).map(str::to_string), before_label: None, after_label: None, before_document: None, after_document: None }),
        (Some(previous), Some(next)) if previous != next => Some(ManuscriptVersionChange { kind: kind.into(), change: "changed".into(), id, label: None, before_label: previous.get("title").and_then(|value| value.as_str()).map(str::to_string), after_label: next.get("title").and_then(|value| value.as_str()).map(str::to_string), before_document: None, after_document: None }),
        _ => None
    }}).collect()
}
fn manuscript_document_changes(before: &[ManuscriptVersionDocument], after: &[ManuscriptVersionDocument]) -> Vec<ManuscriptVersionChange> {
    let left: std::collections::BTreeMap<String, &ManuscriptVersionDocument> = before.iter().map(|value| (value.document_id.clone(), value)).collect();
    let right: std::collections::BTreeMap<String, &ManuscriptVersionDocument> = after.iter().map(|value| (value.document_id.clone(), value)).collect();
    let mut ids: Vec<String> = left.keys().chain(right.keys()).cloned().collect(); ids.sort(); ids.dedup();
    ids.into_iter().filter_map(|id| { let previous = left.get(&id).copied(); let next = right.get(&id).copied(); match (previous, next) {
        (None, Some(value)) => Some(ManuscriptVersionChange { kind: "document".into(), change: "added".into(), id, label: None, before_label: None, after_label: None, before_document: None, after_document: Some(value.revision.document.clone()) }),
        (Some(value), None) => Some(ManuscriptVersionChange { kind: "document".into(), change: "removed".into(), id, label: None, before_label: None, after_label: None, before_document: Some(value.revision.document.clone()), after_document: None }),
        (Some(previous), Some(next)) if previous.revision.document != next.revision.document => Some(ManuscriptVersionChange { kind: "document".into(), change: "changed".into(), id, label: None, before_label: None, after_label: None, before_document: Some(previous.revision.document.clone()), after_document: Some(next.revision.document.clone()) }),
        _ => None
    }}).collect()
}
fn compare_manuscript_version_values(store: &Store, from_id: &str, to_id: &str) -> Result<ManuscriptVersionComparison, String> {
    let from = manuscript_version(store, from_id)?; let to = manuscript_version(store, to_id)?; let left = &from.snapshot; let right = &to.snapshot;
    let mut changes = vec![];
    changes.extend(json_record_changes("story", left.stories.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?, right.stories.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?));
    changes.extend(json_record_changes("chapter", left.chapters.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?, right.chapters.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?));
    changes.extend(json_record_changes("scene-set", left.scene_sets.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?, right.scene_sets.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?));
    changes.extend(json_record_changes("scene", left.scenes.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?, right.scenes.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?));
    changes.extend(json_record_changes("continuous-draft", left.continuous_drafts.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?, right.continuous_drafts.iter().map(serde_json::to_value).collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?));
    changes.extend(manuscript_document_changes(&left.documents, &right.documents));
    Ok(ManuscriptVersionComparison { from: from.summary.clone(), to: to.summary.clone(), changes })
}
fn add_document(store: &mut Store, value: Document, reason: &str) -> Result<DocumentRecord, String> { validate_document(&value)?; let record_id = id("document"); let revision = Revision { id: id("revision"), document_id: record_id.clone(), number: 1, document: value, created_at: timestamp(), reason: reason.into() }; let record = DocumentRecord { id: record_id, head_revision: 1, revisions: vec![revision] }; store.documents.push(record.clone()); Ok(record) }
fn active_scenes(store: &Store, chapter_id: &str, set_id: &str) -> Vec<Scene> { let mut scenes: Vec<Scene> = store.scenes.iter().filter(|scene| scene.scene_set_id == set_id && store.chapters.iter().any(|chapter| chapter.id == chapter_id)).cloned().collect(); scenes.sort_by_key(|scene| scene.position); scenes }
fn reindex_scene_positions(scenes: &mut [Scene], scene_set_id: &str) {
    let mut order: Vec<usize> = scenes.iter().enumerate().filter(|(_, scene)| scene.scene_set_id == scene_set_id).map(|(index, _)| index).collect();
    order.sort_by_key(|&index| scenes[index].position);
    for (position, index) in order.into_iter().enumerate() { scenes[index].position = position as i64; }
}

fn reorder_chapter_positions(chapters: &mut [Chapter], chapter_id: &str, position: i64) -> Result<Vec<Chapter>, String> {
    let chapter = chapters.iter().find(|chapter| chapter.id == chapter_id).ok_or_else(|| format!("Unknown chapter {chapter_id}"))?;
    let story_id = chapter.story_id.clone();
    let mut order: Vec<usize> = chapters.iter().enumerate().filter(|(_, chapter)| chapter.story_id == story_id).map(|(index, _)| index).collect();
    order.sort_by_key(|&index| chapters[index].position);
    let from = order.iter().position(|&index| chapters[index].id == chapter_id).ok_or_else(|| format!("Chapter {chapter_id} is not in its story"))?;
    let moved = order.remove(from);
    let target = position.max(0).min(order.len() as i64) as usize;
    order.insert(target, moved);
    for (position, index) in order.iter().enumerate() { chapters[*index].position = position as i64; }
    Ok(order.into_iter().map(|index| chapters[index].clone()).collect())
}

fn reorder_scene_positions(scenes: &mut [Scene], scene_id: &str, position: i64) -> Result<Vec<Scene>, String> {
    let scene = scenes.iter().find(|scene| scene.id == scene_id).ok_or_else(|| format!("Unknown scene {scene_id}"))?;
    let scene_set_id = scene.scene_set_id.clone();
    let mut order: Vec<usize> = scenes.iter().enumerate().filter(|(_, scene)| scene.scene_set_id == scene_set_id).map(|(index, _)| index).collect();
    order.sort_by_key(|&index| scenes[index].position);
    let from = order.iter().position(|&index| scenes[index].id == scene_id).ok_or_else(|| format!("Scene {scene_id} is not in its scene set"))?;
    let moved = order.remove(from);
    let target = position.max(0).min(order.len() as i64) as usize;
    order.insert(target, moved);
    for (position, index) in order.iter().enumerate() { scenes[*index].position = position as i64; }
    Ok(order.into_iter().map(|index| scenes[index].clone()).collect())
}
fn validate_store(store: &Store) -> Result<(), String> {
    if store.project.is_none() { return Err("Project metadata is missing".into()); }
    for document in &store.documents { for revision in &document.revisions { validate_document(&revision.document)?; } }
    for chapter_value in &store.chapters {
        if !store.scene_sets.iter().any(|set| set.id == chapter_value.active_scene_set_id && set.chapter_id == chapter_value.id && set.active) { return Err(format!("Chapter {} has no active scene set", chapter_value.id)); }
    }
    for note in &store.markdown_notes { if note.title.trim().is_empty() || note.revision < 1 { return Err(format!("Markdown note {} is invalid", note.id)); } }
    for link in &store.note_links {
        markdown_note(store, &link.note_id)?;
        if let Some(target) = &link.target_id { markdown_note(store, target)?; }
        if link.target_text.trim().is_empty() || link.start < 0 || link.end < link.start { return Err(format!("Markdown link {} is invalid", link.id)); }
    }
    for canvas_value in &store.canvases {
        if !store.stories.iter().any(|story_value| story_value.id == canvas_value.story_id) { return Err(format!("Canvas {} has an unknown story", canvas_value.id)); }
        if !valid_canvas_engine(&canvas_value.engine) || canvas_value.revision < 1 { return Err(format!("Canvas {} is invalid", canvas_value.id)); }
    }
    for node in &store.canvas_nodes {
        if !store.canvases.iter().any(|canvas_value| canvas_value.id == node.canvas_id) || !store.markdown_notes.iter().any(|note| note.id == node.entity_id) || !valid_position(&node.position) { return Err(format!("Canvas node {} is invalid", node.id)); }
    }
    for edge in &store.canvas_edges {
        if !store.canvas_nodes.iter().any(|node| node.canvas_id == edge.canvas_id && node.id == edge.source_node_id) || !store.canvas_nodes.iter().any(|node| node.canvas_id == edge.canvas_id && node.id == edge.target_node_id) { return Err(format!("Canvas edge {} is invalid", edge.id)); }
    }
    Ok(())
}
fn ensure_unique_ids<I>(values: I, kind: &str) -> Result<(), String> where I: Iterator<Item = String> {
    let mut seen = std::collections::HashSet::new();
    for value in values { if !seen.insert(value.clone()) { return Err(format!("Duplicate {kind} {value}")); } }
    Ok(())
}
fn replace_manuscript_snapshot(store: &mut Store, snapshot: &ManuscriptVersionSnapshot) -> Result<(), String> {
    let mut candidate = store.clone();
    ensure_unique_ids(snapshot.stories.iter().map(|value| value.id.clone()), "story")?;
    ensure_unique_ids(snapshot.chapters.iter().map(|value| value.id.clone()), "chapter")?;
    ensure_unique_ids(snapshot.scene_sets.iter().map(|value| value.id.clone()), "scene set")?;
    ensure_unique_ids(snapshot.scenes.iter().map(|value| value.id.clone()), "scene")?;
    ensure_unique_ids(snapshot.continuous_drafts.iter().map(|value| value.id.clone()), "continuous draft")?;
    ensure_unique_ids(snapshot.documents.iter().map(|value| value.document_id.clone()), "document")?;
    let project = candidate.project.as_ref().ok_or_else(|| "Project metadata is missing".to_string())?;
    let story_ids: std::collections::HashSet<String> = snapshot.stories.iter().map(|value| value.id.clone()).collect();
    for story in &snapshot.stories { if story.project_id != project.id { return Err(format!("Story {} belongs to a different project", story.id)); } }
    let chapter_ids: std::collections::HashSet<String> = snapshot.chapters.iter().map(|value| value.id.clone()).collect();
    for chapter_value in &snapshot.chapters { if !story_ids.contains(&chapter_value.story_id) { return Err(format!("Chapter {} refers to a missing story", chapter_value.id)); } if !snapshot.scene_sets.iter().any(|set| set.id == chapter_value.active_scene_set_id && set.chapter_id == chapter_value.id && set.active) { return Err(format!("Chapter {} has no active scene set", chapter_value.id)); } }
    let set_ids: std::collections::HashSet<String> = snapshot.scene_sets.iter().map(|value| value.id.clone()).collect();
    for set in &snapshot.scene_sets { if !chapter_ids.contains(&set.chapter_id) { return Err(format!("Scene set {} refers to a missing chapter", set.id)); } }
    let document_ids: std::collections::HashSet<String> = snapshot.documents.iter().map(|value| value.document_id.clone()).collect();
    for scene in &snapshot.scenes { if !set_ids.contains(&scene.scene_set_id) || !document_ids.contains(&scene.document_id) { return Err(format!("Scene {} has an invalid manuscript reference", scene.id)); } }
    for draft in &snapshot.continuous_drafts { if !chapter_ids.contains(&draft.chapter_id) || !set_ids.contains(&draft.base_scene_set_id) || !document_ids.contains(&draft.document_id) { return Err(format!("Continuous draft {} has an invalid manuscript reference", draft.id)); } }
    for entry in &snapshot.documents { if entry.document_id != entry.revision.document_id || entry.revision.number < 1 { return Err(format!("Document {} has an invalid revision", entry.document_id)); } validate_document(&entry.revision.document)?; }
    candidate.stories = snapshot.stories.clone(); candidate.chapters = snapshot.chapters.clone(); candidate.scene_sets = snapshot.scene_sets.clone(); candidate.scenes = snapshot.scenes.clone(); candidate.drafts = snapshot.continuous_drafts.clone(); candidate.documents = snapshot.documents.iter().map(|entry| DocumentRecord { id: entry.document_id.clone(), head_revision: entry.revision.number, revisions: vec![entry.revision.clone()] }).collect();
    // Canvases and their projection data are explicitly outside manuscript restore. Exclude
    // them from manuscript validation so historical story deletions do not block restore.
    candidate.canvases.clear(); candidate.canvas_nodes.clear(); candidate.canvas_edges.clear();
    validate_store(&candidate)?;
    *store = { let mut restored = candidate; restored.canvases = store.canvases.clone(); restored.canvas_nodes = store.canvas_nodes.clone(); restored.canvas_edges = store.canvas_edges.clone(); restored };
    Ok(())
}
fn compose(store: &Store, chapter_id: &str) -> Result<Document, String> { let current = chapter(store, chapter_id)?; let scenes = active_scenes(store, chapter_id, &current.active_scene_set_id); let mut blocks = vec![]; for (index, scene) in scenes.iter().enumerate() { if index > 0 { blocks.push(DocumentBlock { id: id("scene-break"), kind: "scene-break".into(), heading_level: None, alignment: None, runs: vec![TextRun { text: String::new(), marks: vec![] }] }); } let record = document_record(store, &scene.document_id)?; let revision = record.revisions.last().ok_or_else(|| "Document has no revision".to_string())?; blocks.extend(revision.document.blocks.clone()); } Ok(Document { format_version: DOCUMENT_FORMAT_VERSION, blocks }) }

#[tauri::command]
fn create_project(directory: String, name: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let root = PathBuf::from(directory.trim()); let directory = normalized_project_directory(&root)?; let _ = database_for(&root, true)?; state.root = Some(root); let project = Project { id: id("project"), name, directory, schema_version: 5, created_at: timestamp(), updated_at: timestamp() };  state.store = Store::default(); state.store.project = Some(project.clone()); status(&mut state, "saved", "Project created offline"); state.persist()?; Ok(project) }

#[tauri::command]
fn open_project(directory: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let root = PathBuf::from(directory.trim());
    validate_project_root(&root)?;
    ensure_existing_directory(&root, "project directory")?;
    let db_path = root.join(".weave").join("project.db");
    ensure_safe_file(&db_path, "project database")?;
    let db = database_for(&root, false)?;
    let mut store = load_store(&db)?;
    if let Some(project) = store.project.as_mut() { project.schema_version = project.schema_version.max(5); }
    for canvas in &mut store.canvases { if canvas.engine.is_empty() { canvas.engine = default_canvas_engine(); } }
    let note_ids: std::collections::HashSet<String> = store.markdown_notes.iter().map(|note| note.id.clone()).collect();
    store.worldbuilding_items.clear(); store.relationships.clear(); store.document_links.clear();
    store.canvas_nodes.retain(|node| note_ids.contains(&node.entity_id)); store.canvas_edges.clear();
    let project = store.project.clone().ok_or_else(|| "Project metadata is missing".to_string())?;
    if normalized_project_directory(Path::new(&project.directory))? != normalized_project_directory(&root)? { return Err("Project metadata does not match the selected directory".into()); }
    state.store = store; state.root = Some(root);
    status(&mut state, "saved", "Project opened offline"); state.persist()?; Ok(project)
}
#[tauri::command]
fn get_project(app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.project.clone().ok_or_else(|| "No project is open".into()) }
#[tauri::command]
fn create_story(title: String, app: State<'_, Mutex<AppState>>) -> Result<Story, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; let value = Story { id: id("story"), project_id: project.id, title, position: state.store.stories.len() as i64 }; state.store.stories.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn create_chapter(story_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Chapter, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; story(&state.store, &story_id)?; let chapter_id = id("chapter"); let set = SceneSet { id: id("scene-set"), chapter_id: chapter_id.clone(), created_at: timestamp(), source_revision_id: None, active: true }; let value = Chapter { id: chapter_id, story_id: story_id.clone(), title, position: state.store.chapters.iter().filter(|item| item.story_id == story_id).count() as i64, active_scene_set_id: set.id.clone() }; state.store.scene_sets.push(set); state.store.chapters.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn create_scene(chapter_id: String, title: String, document: Option<Document>, app: State<'_, Mutex<AppState>>) -> Result<Scene, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let chapter_value = chapter(&state.store, &chapter_id)?.clone(); let record = add_document(&mut state.store, document.unwrap_or_else(empty_document), "created")?; let position = state.store.scenes.iter().filter(|item| item.scene_set_id == chapter_value.active_scene_set_id).count() as i64; let value = Scene { id: id("scene"), scene_set_id: chapter_value.active_scene_set_id, title, position, document_id: record.id }; state.store.scenes.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn rename_story(story_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Story, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    if title.trim().is_empty() { return Err("A story title is required".into()); }
    let story = state.store.stories.iter_mut().find(|item| item.id == story_id).ok_or_else(|| format!("Unknown story {story_id}"))?;
    story.title = title.trim().into();
    let result = story.clone();
    status(&mut state, "saved", "Story title saved");
    state.persist()?;
    Ok(result)
}

#[tauri::command]
fn rename_chapter(chapter_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Chapter, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    if title.trim().is_empty() { return Err("A chapter title is required".into()); }
    let chapter = state.store.chapters.iter_mut().find(|item| item.id == chapter_id).ok_or_else(|| format!("Unknown chapter {chapter_id}"))?;
    chapter.title = title.trim().into();
    let result = chapter.clone();
    status(&mut state, "saved", "Chapter title saved");
    state.persist()?;
    Ok(result)
}

#[tauri::command]
fn delete_story(story_id: String, app: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let story = state.store.stories.iter().find(|item| item.id == story_id).cloned().ok_or_else(|| format!("Unknown story {story_id}"))?;
    let chapter_ids: std::collections::HashSet<String> = state.store.chapters.iter().filter(|item| item.story_id == story_id).map(|item| item.id.clone()).collect();
    let scene_set_ids: std::collections::HashSet<String> = state.store.scene_sets.iter().filter(|item| chapter_ids.contains(&item.chapter_id)).map(|item| item.id.clone()).collect();
    let scene_ids: std::collections::HashSet<String> = state.store.scenes.iter().filter(|item| scene_set_ids.contains(&item.scene_set_id)).map(|item| item.id.clone()).collect();
    let mut document_ids: std::collections::HashSet<String> = state.store.scenes.iter().filter(|item| scene_ids.contains(&item.id)).map(|item| item.document_id.clone()).collect();
    state.store.drafts.retain(|draft| { if !chapter_ids.contains(&draft.chapter_id) { true } else { document_ids.insert(draft.document_id.clone()); false } });
    let canvas_ids: std::collections::HashSet<String> = state.store.canvases.iter().filter(|canvas| canvas.story_id == story_id).map(|canvas| canvas.id.clone()).collect();
    state.store.relationships.retain(|value| !chapter_ids.contains(&value.source_id) && !chapter_ids.contains(&value.target_id) && !scene_ids.contains(&value.source_id) && !scene_ids.contains(&value.target_id));
    state.store.document_links.retain(|value| !document_ids.contains(&value.anchor.document_id));
    state.store.canvas_edges.retain(|edge| !canvas_ids.contains(&edge.canvas_id));
    state.store.canvas_nodes.retain(|node| !canvas_ids.contains(&node.canvas_id) && !chapter_ids.contains(&node.entity_id) && !scene_ids.contains(&node.entity_id));
    let remaining_nodes: std::collections::HashSet<String> = state.store.canvas_nodes.iter().map(|node| node.id.clone()).collect();
    state.store.canvas_edges.retain(|edge| remaining_nodes.contains(&edge.source_node_id) && remaining_nodes.contains(&edge.target_node_id));
    state.store.canvases.retain(|canvas| !canvas_ids.contains(&canvas.id));
    state.store.documents.retain(|document| !document_ids.contains(&document.id));
    state.store.scenes.retain(|scene| !scene_ids.contains(&scene.id));
    state.store.scene_sets.retain(|set| !scene_set_ids.contains(&set.id));
    state.store.chapters.retain(|chapter| !chapter_ids.contains(&chapter.id));
    state.store.stories.retain(|candidate| candidate.id != story_id);
    state.store.stories.sort_by_key(|candidate| candidate.position);
    for (position, candidate) in state.store.stories.iter_mut().enumerate() { candidate.position = position as i64; }
    status(&mut state, "saved", &format!("Story “{}” and its manuscript content deleted", story.title));
    state.persist()
}

#[tauri::command]
fn delete_chapter(chapter_id: String, app: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let chapter_value = state.store.chapters.iter().find(|item| item.id == chapter_id).cloned().ok_or_else(|| format!("Unknown chapter {chapter_id}"))?;
    let scene_set_ids: std::collections::HashSet<String> = state.store.scene_sets.iter().filter(|item| item.chapter_id == chapter_id).map(|item| item.id.clone()).collect();
    let scene_ids: std::collections::HashSet<String> = state.store.scenes.iter().filter(|item| scene_set_ids.contains(&item.scene_set_id)).map(|item| item.id.clone()).collect();
    let mut document_ids: std::collections::HashSet<String> = state.store.scenes.iter().filter(|item| scene_ids.contains(&item.id)).map(|item| item.document_id.clone()).collect();
    state.store.drafts.retain(|draft| { if draft.chapter_id != chapter_id { true } else { document_ids.insert(draft.document_id.clone()); false } });
    state.store.relationships.retain(|value| value.source_id != chapter_id && value.target_id != chapter_id && !scene_ids.contains(&value.source_id) && !scene_ids.contains(&value.target_id));
    state.store.document_links.retain(|value| !document_ids.contains(&value.anchor.document_id));
    state.store.canvas_nodes.retain(|node| node.entity_id != chapter_id && !scene_ids.contains(&node.entity_id));
    let remaining_nodes: std::collections::HashSet<String> = state.store.canvas_nodes.iter().map(|node| node.id.clone()).collect();
    state.store.canvas_edges.retain(|edge| remaining_nodes.contains(&edge.source_node_id) && remaining_nodes.contains(&edge.target_node_id));
    state.store.documents.retain(|document| !document_ids.contains(&document.id));
    state.store.scenes.retain(|scene| !scene_ids.contains(&scene.id));
    state.store.scene_sets.retain(|set| !scene_set_ids.contains(&set.id));
    state.store.chapters.retain(|candidate| candidate.id != chapter_id);
    state.store.chapters.sort_by_key(|candidate| candidate.position);
    let mut position = 0i64;
    for candidate in state.store.chapters.iter_mut().filter(|candidate| candidate.story_id == chapter_value.story_id) { candidate.position = position; position += 1; }
    status(&mut state, "saved", &format!("Chapter “{}” and its scenes deleted", chapter_value.title));
    state.persist()
}

#[tauri::command]
fn delete_scene(scene_id: String, app: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let scene = state.store.scenes.iter().find(|item| item.id == scene_id).cloned().ok_or_else(|| format!("Unknown scene {scene_id}"))?;
    state.store.relationships.retain(|value| value.source_id != scene_id && value.target_id != scene_id);
    state.store.document_links.retain(|value| value.anchor.document_id != scene.document_id);
    state.store.canvas_nodes.retain(|node| node.entity_id != scene_id);
    let remaining_nodes: std::collections::HashSet<String> = state.store.canvas_nodes.iter().map(|node| node.id.clone()).collect();
    state.store.canvas_edges.retain(|edge| remaining_nodes.contains(&edge.source_node_id) && remaining_nodes.contains(&edge.target_node_id));
    state.store.documents.retain(|document| document.id != scene.document_id);
    state.store.scenes.retain(|candidate| candidate.id != scene_id);
    reindex_scene_positions(&mut state.store.scenes, &scene.scene_set_id);
    status(&mut state, "saved", &format!("Scene “{}” deleted", scene.title));
    state.persist()
}

#[tauri::command]
fn list_stories(app: State<'_, Mutex<AppState>>) -> Result<Vec<Story>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values = state.store.stories.clone(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn list_chapters(story_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<Chapter>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values: Vec<Chapter> = state.store.chapters.iter().filter(|item| story_id.as_ref().map(|id| &item.story_id == id).unwrap_or(true)).cloned().collect(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn list_scene_sets(chapter_id: String, app: State<'_, Mutex<AppState>>) -> Result<Vec<SceneSet>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values: Vec<SceneSet> = state.store.scene_sets.iter().filter(|item| item.chapter_id == chapter_id).cloned().collect(); values.sort_by_key(|item| item.created_at.clone()); Ok(values) }
#[tauri::command]
fn list_scenes(chapter_id: String, scene_set_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<Scene>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let chapter_value = chapter(&state.store, &chapter_id)?; let set = scene_set_id.unwrap_or_else(|| chapter_value.active_scene_set_id.clone()); let mut values: Vec<Scene> = state.store.scenes.iter().filter(|item| item.scene_set_id == set).cloned().collect(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn rename_scene(scene_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Scene, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; if title.trim().is_empty() { return Err("A scene title is required".into()); } let scene = state.store.scenes.iter_mut().find(|item| item.id == scene_id).ok_or_else(|| "Unknown scene".to_string())?; scene.title = title.trim().into(); let result = scene.clone(); status(&mut state, "saved", "Scene title saved"); state.persist()?; Ok(result) }
#[tauri::command]
fn reorder_chapter(chapter_id: String, position: i64, app: State<'_, Mutex<AppState>>) -> Result<Vec<Chapter>, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let values = reorder_chapter_positions(&mut state.store.chapters, &chapter_id, position)?; status(&mut state, "saved", "Chapter order saved"); state.persist()?; Ok(values) }
#[tauri::command]
fn reorder_scene(scene_id: String, position: i64, app: State<'_, Mutex<AppState>>) -> Result<Vec<Scene>, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let values = reorder_scene_positions(&mut state.store.scenes, &scene_id, position)?; status(&mut state, "saved", "Scene order saved"); state.persist()?; Ok(values) }

#[tauri::command]
fn create_worldbuilding_item(input: WorldbuildingInput, app: State<'_, Mutex<AppState>>) -> Result<WorldbuildingItem, String> {
    validate_properties(&input.kind, &input.title, &input.aliases, &input.properties)?;
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?;
    let mut aliases: Vec<String> = input.aliases.into_iter().map(|alias| alias.trim().to_string()).filter(|alias| !alias.is_empty()).collect(); aliases.sort(); aliases.dedup();
    let value = WorldbuildingItem { id: id("world-item"), project_id: project.id, kind: input.kind, title: input.title.trim().into(), aliases, properties: input.properties, revision: 1, created_at: timestamp(), updated_at: timestamp() };
    state.store.worldbuilding_items.push(value.clone()); status(&mut state, "saved", "Worldbuilding item saved"); state.persist()?; Ok(value)
}
#[tauri::command]
fn update_worldbuilding_item(item_id: String, input: WorldbuildingInput, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<WorldbuildingItem, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let current = worldbuilding_item(&state.store, &item_id)?.clone();
    validate_properties(&current.kind, &input.title, &input.aliases, &input.properties)?;
    if current.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this item changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); }
    let item = state.store.worldbuilding_items.iter_mut().find(|item| item.id == item_id).ok_or_else(|| "Unknown worldbuilding item".to_string())?;
    let previous_title = item.title.clone(); let next_title = input.title.trim().to_string();
    let mut aliases: Vec<String> = input.aliases.into_iter().map(|alias| alias.trim().to_string()).filter(|alias| !alias.is_empty()).collect(); if previous_title != next_title { aliases.push(previous_title); } aliases.sort(); aliases.dedup();
    item.title = next_title; item.aliases = aliases; item.properties = input.properties; item.revision += 1; item.updated_at = timestamp(); let value = item.clone(); status(&mut state, "saved", "Worldbuilding item saved"); state.persist()?; Ok(value)
}
#[tauri::command]
fn delete_worldbuilding_item(item_id: String, expected_revision: i64, mode: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let item = worldbuilding_item(&state.store, &item_id)?.clone();
    if item.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this item changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", item.revision)); }
    let relationships: Vec<String> = state.store.relationships.iter().filter(|value| value.source_id == item_id || value.target_id == item_id).map(|value| value.id.clone()).collect();
    let nodes: Vec<String> = state.store.canvas_nodes.iter().filter(|value| value.entity_id == item_id).map(|value| value.id.clone()).collect();
    let links = state.store.document_links.iter().filter(|value| value.target_id.as_deref() == Some(&item_id)).count();
    let note_links = state.store.note_links.iter().filter(|value| value.target_id.as_deref() == Some(&item_id)).count();
    if mode.as_deref().unwrap_or("reject") != "remove-references" && (!relationships.is_empty() || !nodes.is_empty() || links > 0 || note_links > 0) { return Err(format!("Cannot delete {}: {} relationship(s), {} document link(s), {} Markdown link(s), and {} canvas node(s) still refer to it. Choose remove-references to keep unresolved links repairable.", item.title, relationships.len(), links, note_links, nodes.len())); }
    if mode.as_deref() == Some("remove-references") {
        state.store.relationships.retain(|value| !relationships.contains(&value.id));
        state.store.document_links.iter_mut().filter(|value| value.target_id.as_deref() == Some(&item_id)).for_each(|value| { value.target_id = None; value.unresolved_label = Some(item.title.clone()); });
        state.store.note_links.iter_mut().filter(|value| value.target_id.as_deref() == Some(&item_id)).for_each(|value| { value.target_id = None; });
        state.store.canvas_nodes.retain(|value| !nodes.contains(&value.id));
        state.store.canvas_edges.retain(|value| !nodes.contains(&value.source_node_id) && !nodes.contains(&value.target_node_id));
    }
    state.store.worldbuilding_items.retain(|value| value.id != item_id); status(&mut state, "saved", "Worldbuilding item deleted safely"); state.persist()?; Ok(())
}
#[tauri::command]
fn list_worldbuilding_items(kind: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<WorldbuildingItem>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values: Vec<WorldbuildingItem> = state.store.worldbuilding_items.iter().filter(|item| kind.as_ref().map(|kind| &item.kind == kind).unwrap_or(true)).cloned().collect(); values.sort_by(|left, right| left.title.cmp(&right.title)); Ok(values) }
#[tauri::command]
fn search_worldbuilding(query: String, app: State<'_, Mutex<AppState>>) -> Result<Vec<WorldbuildingItem>, String> {
    let state = app.lock().map_err(|_| "Project lock poisoned")?; let needle = query.trim().to_lowercase(); if needle.is_empty() { let mut values = state.store.worldbuilding_items.clone(); values.sort_by(|left, right| left.title.cmp(&right.title)); return Ok(values); }
    let linked: Vec<String> = state.store.relationships.iter().filter(|relationship| relationship.relation_type.contains(needle.as_str()) || entity(&state.store, &relationship.source_id).map(|value| value.1.to_lowercase().contains(&needle)).unwrap_or(false) || entity(&state.store, &relationship.target_id).map(|value| value.1.to_lowercase().contains(&needle)).unwrap_or(false)).flat_map(|relationship| vec![relationship.source_id.clone(), relationship.target_id.clone()]).collect();
    let mut values: Vec<WorldbuildingItem> = state.store.worldbuilding_items.iter().filter(|item| item.title.to_lowercase().contains(&needle) || item.aliases.iter().any(|alias| alias.to_lowercase().contains(&needle)) || item.properties.as_object().map(|properties| properties.values().any(|value| value.as_str().map(|value| value.to_lowercase().contains(&needle)).unwrap_or(false))).unwrap_or(false) || linked.contains(&item.id)).cloned().collect(); values.sort_by(|left, right| left.title.cmp(&right.title)); Ok(values)
}
#[tauri::command]
fn create_relationship(source_id: String, target_id: String, relation_type: String, app: State<'_, Mutex<AppState>>) -> Result<DomainRelationship, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?; validate_relationship(&state.store, &source_id, &target_id, &relation_type)?;
    if let Some(value) = state.store.relationships.iter().find(|value| value.source_id == source_id && value.target_id == target_id && value.relation_type == relation_type) { return Ok(value.clone()); }
    let value = DomainRelationship { id: id("relationship"), source_id, target_id, relation_type, created_at: timestamp() }; state.store.relationships.push(value.clone()); status(&mut state, "saved", "Relationship saved"); state.persist()?; Ok(value)
}
#[tauri::command]
fn delete_relationship(relationship_id: String, app: State<'_, Mutex<AppState>>) -> Result<(), String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; relationship(&state.store, &relationship_id)?; state.store.relationships.retain(|value| value.id != relationship_id); status(&mut state, "saved", "Relationship removed"); state.persist()?; Ok(()) }
#[tauri::command]
fn list_relationships(entity_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<DomainRelationship>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.relationships.iter().filter(|value| entity_id.as_ref().map(|id| value.source_id == *id || value.target_id == *id).unwrap_or(true)).cloned().collect()) }
#[tauri::command]
fn list_backlinks(target_id: String, app: State<'_, Mutex<AppState>>) -> Result<Vec<Backlink>, String> {
    let state = app.lock().map_err(|_| "Project lock poisoned")?; entity(&state.store, &target_id)?; let mut values: Vec<Backlink> = state.store.relationships.iter().filter(|value| value.target_id == target_id).filter_map(|value| entity(&state.store, &value.source_id).ok().map(|source| Backlink::Relationship { id: value.id.clone(), source_id: value.source_id.clone(), source_title: source.1, relation_type: value.relation_type.clone() })).collect();
    values.extend(state.store.document_links.iter().filter(|value| value.target_id.as_deref() == Some(&target_id)).map(|value| Backlink::Document { id: value.id.clone(), source_id: value.anchor.document_id.clone(), source_title: document_title(&state.store, &value.anchor.document_id), anchor: value.anchor.clone() }));
    values.extend(state.store.note_links.iter().filter(|value| value.target_id.as_deref() == Some(&target_id)).filter_map(|value| markdown_note(&state.store, &value.note_id).ok().map(|note| Backlink::Note { id: value.id.clone(), source_id: value.note_id.clone(), source_title: note.title.clone(), note_id: value.note_id.clone(), start: value.start, end: value.end, label: value.label.clone() })); Ok(values)
}
#[tauri::command]
fn create_document_link(anchor: DocumentAnchor, target_id: Option<String>, unresolved_label: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<DocumentLink, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; validate_anchor(&state.store, &anchor)?; if let Some(target) = &target_id { worldbuilding_item(&state.store, target)?; } else if unresolved_label.as_ref().map(|value| value.trim().is_empty()).unwrap_or(true) { return Err("An unresolved document link needs a visible label".into()); } let value = DocumentLink { id: id("document-link"), anchor, target_id, unresolved_label: unresolved_label.map(|value| value.trim().into()).filter(|value: &String| !value.is_empty()), created_at: timestamp() }; state.store.document_links.push(value.clone()); status(&mut state, "saved", "Document link saved"); state.persist()?; Ok(value) }
#[tauri::command]
fn repair_document_link(link_id: String, target_id: String, app: State<'_, Mutex<AppState>>) -> Result<DocumentLink, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; worldbuilding_item(&state.store, &target_id)?; let link = state.store.document_links.iter_mut().find(|value| value.id == link_id).ok_or_else(|| "Unknown document link".to_string())?; link.target_id = Some(target_id); link.unresolved_label = None; let value = link.clone(); status(&mut state, "saved", "Document link repaired"); state.persist()?; Ok(value) }
#[tauri::command]
fn list_document_links(document_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<DocumentLink>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.document_links.iter().filter(|value| document_id.as_ref().map(|id| value.anchor.document_id == *id).unwrap_or(true)).cloned().collect()) }
#[tauri::command]
fn create_markdown_note(title: String, markdown: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<MarkdownNote, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; if title.trim().is_empty() { return Err("A note title is required".into()); } let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; let note = MarkdownNote { id: id("note"), project_id: project.id, title: title.trim().into(), markdown: markdown.unwrap_or_default(), revision: 1, created_at: timestamp(), updated_at: timestamp() }; let links = rebuild_note_links(&state.store, &note, &[]); state.store.markdown_notes.push(note.clone()); state.store.note_links.extend(links); status(&mut state, "saved", "Markdown note saved"); state.persist()?; Ok(note) }
#[tauri::command]
fn update_markdown_note(note_id: String, input: MarkdownNoteInput, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<MarkdownNote, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let current = markdown_note(&state.store, &note_id)?.clone(); if current.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this note changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); } if input.title.trim().is_empty() { return Err("A note title is required".into()); } let mut note = current.clone(); note.title = input.title.trim().into(); note.markdown = input.markdown; note.revision += 1; note.updated_at = timestamp(); let previous: Vec<NoteLink> = state.store.note_links.iter().filter(|link| link.note_id == note_id).cloned().collect(); let links = rebuild_note_links(&state.store, &note, &previous); let stored = state.store.markdown_notes.iter_mut().find(|candidate| candidate.id == note_id).unwrap(); *stored = note.clone(); state.store.note_links.retain(|link| link.note_id != note_id); state.store.note_links.extend(links); status(&mut state, "saved", "Markdown note and deterministic links saved"); state.persist()?; Ok(note) }
#[tauri::command]
fn delete_markdown_note(note_id: String, expected_revision: i64, mode: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<(), String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let note = markdown_note(&state.store, &note_id)?.clone(); if note.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this note changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", note.revision)); } let incoming = state.store.note_links.iter().filter(|value| value.note_id != note_id && value.target_id.as_deref() == Some(&note_id)).count(); let links: Vec<String> = state.store.note_links.iter().filter(|value| value.note_id == note_id).map(|value| value.id.clone()).collect(); let nodes: Vec<String> = state.store.canvas_nodes.iter().filter(|value| value.entity_id == note_id).map(|value| value.id.clone()).collect(); if mode.as_deref().unwrap_or("reject") != "remove-references" && (incoming > 0 || !nodes.is_empty()) { return Err(format!("Cannot delete {}: references remain. Choose remove-references to preserve unresolved Markdown links.", note.title)); } state.store.note_links.retain(|value| value.note_id != note_id); if mode.as_deref() == Some("remove-references") { state.store.note_links.iter_mut().filter(|value| value.target_id.as_deref() == Some(&note_id)).for_each(|value| value.target_id = None); } state.store.canvas_nodes.retain(|value| !nodes.contains(&value.id)); state.store.canvas_edges.retain(|value| !links.contains(&value.note_link_id) && !nodes.contains(&value.source_node_id) && !nodes.contains(&value.target_node_id)); state.store.markdown_notes.retain(|value| value.id != note_id); status(&mut state, "saved", "Markdown note deleted safely"); state.persist()?; Ok(()) }
#[tauri::command]
fn list_markdown_notes(app: State<'_, Mutex<AppState>>) -> Result<Vec<MarkdownNote>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut notes = state.store.markdown_notes.clone(); notes.sort_by(|left, right| left.title.cmp(&right.title)); Ok(notes) }
#[tauri::command]
fn search_markdown_notes(query: String, app: State<'_, Mutex<AppState>>) -> Result<Vec<MarkdownNote>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let needle = query.trim().to_lowercase(); let mut notes: Vec<MarkdownNote> = state.store.markdown_notes.iter().filter(|note| needle.is_empty() || note.title.to_lowercase().contains(needle.as_str()) || note.markdown.to_lowercase().contains(needle.as_str()) || state.store.note_links.iter().any(|link| link.note_id == note.id && (link.target_text.to_lowercase().contains(needle.as_str()) || link.label.as_ref().map(|label| label.to_lowercase().contains(needle.as_str())).unwrap_or(false)))).cloned().collect(); notes.sort_by(|left, right| left.title.cmp(&right.title)); Ok(notes) }
#[tauri::command]
fn list_note_links(note_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<NoteLink>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut links: Vec<NoteLink> = state.store.note_links.iter().filter(|link| note_id.as_ref().map(|id| link.note_id == *id).unwrap_or(true)).cloned().collect(); links.sort_by_key(|link| link.start); Ok(links) }
#[tauri::command]
fn repair_note_link(link_id: String, target_id: String, app: State<'_, Mutex<AppState>>) -> Result<NoteLink, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; markdown_note(&state.store, &target_id)?; let link = state.store.note_links.iter_mut().find(|link| link.id == link_id).ok_or_else(|| "Unknown Markdown link".to_string())?; link.target_id = Some(target_id); let value = link.clone(); status(&mut state, "saved", "Markdown link repaired by stable ID"); state.persist()?; Ok(value) }

#[tauri::command]
fn create_canvas(story_id: String, title: String, engine: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<StoryCanvas, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; story(&state.store, &story_id)?; if title.trim().is_empty() { return Err("Canvas title is required".into()); } let engine = engine.unwrap_or_else(default_canvas_engine); if !valid_canvas_engine(&engine) { return Err(format!("Unsupported canvas engine: {engine}")); } let excalidraw_state = (engine == "excalidraw").then(|| serde_json::json!({ "elements": [], "appState": { "viewBackgroundColor": "#ffffff", "scrollX": 0, "scrollY": 0, "zoom": { "value": 1 } }, "files": {} })); let value = StoryCanvas { id: id("canvas"), story_id, title: title.trim().into(), viewport: CanvasViewport { x: 0.0, y: 0.0, zoom: 1.0 }, engine, excalidraw_state, revision: 1, created_at: timestamp(), updated_at: timestamp() }; state.store.canvases.push(value.clone()); status(&mut state, "saved", "Story canvas saved"); state.persist()?; Ok(value) }
#[tauri::command]
fn update_canvas(canvas_id: String, input: CanvasTitleInput, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<StoryCanvas, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let current = canvas(&state.store, &canvas_id)?.clone(); if current.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this canvas changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); } if input.title.trim().is_empty() { return Err("Canvas title is required".into()); } let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.title = input.title.trim().into(); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); let value = canvas_mut.clone(); status(&mut state, "saved", "Canvas title saved"); state.persist()?; Ok(value) }
#[tauri::command]
fn delete_canvas(canvas_id: String, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<(), String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let current = canvas(&state.store, &canvas_id)?.clone(); if current.revision != expected_revision { status(&mut state, "revision-conflict", "Delete stopped: this canvas changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); } let node_ids: std::collections::HashSet<String> = state.store.canvas_nodes.iter().filter(|node| node.canvas_id == canvas_id).map(|node| node.id.clone()).collect(); state.store.canvas_nodes.retain(|node| node.canvas_id != canvas_id); state.store.canvas_edges.retain(|edge| edge.canvas_id != canvas_id && !node_ids.contains(&edge.source_node_id) && !node_ids.contains(&edge.target_node_id)); state.store.canvases.retain(|item| item.id != canvas_id); status(&mut state, "saved", &format!("Canvas “{}” deleted; Markdown notes are unchanged", current.title)); state.persist()?; Ok(()) }
#[tauri::command]
fn list_canvases(story_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<StoryCanvas>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.canvases.iter().filter(|value| story_id.as_ref().map(|id| value.story_id == *id).unwrap_or(true)).cloned().map(|mut value| { if value.engine.is_empty() { value.engine = default_canvas_engine(); } value }).collect()) }
#[tauri::command]
fn canvas_projection(canvas_id: String, app: State<'_, Mutex<AppState>>) -> Result<CanvasProjection, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut value = canvas(&state.store, &canvas_id)?.clone(); if value.engine.is_empty() { value.engine = default_canvas_engine(); } let nodes: Result<Vec<CanvasProjectionNode>, String> = state.store.canvas_nodes.iter().filter(|node| node.canvas_id == canvas_id).map(|node| markdown_note(&state.store, &node.entity_id).map(|note| CanvasProjectionNode { id: node.id.clone(), canvas_id: node.canvas_id.clone(), entity_id: node.entity_id.clone(), position: node.position.clone(), entity_kind: "note".into(), label: note.title.clone() })).collect(); let nodes = nodes?; let edges: Vec<CanvasEdge> = state.store.note_links.iter().filter_map(|link| { let target = link.target_id.as_ref()?; let source_node = nodes.iter().find(|node| node.entity_id == link.note_id)?; let target_node = nodes.iter().find(|node| node.entity_id == *target)?; Some(CanvasEdge { id: format!("canvas-note-link-{canvas_id}-{}", link.id), canvas_id: canvas_id.clone(), source_node_id: source_node.id.clone(), target_node_id: target_node.id.clone(), note_link_id: link.id.clone() }) }).collect(); Ok(CanvasProjection { canvas: value, nodes, edges }) }
#[tauri::command]
fn add_canvas_node(canvas_id: String, entity_id: String, position: CanvasPosition, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<CanvasNode, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let canvas_value = canvas(&state.store, &canvas_id)?.clone(); if canvas_value.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this canvas changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", canvas_value.revision)); } markdown_note(&state.store, &entity_id)?; if !valid_position(&position) { return Err("Canvas position is invalid".into()); } if let Some(value) = state.store.canvas_nodes.iter().find(|node| node.canvas_id == canvas_id && node.entity_id == entity_id) { return Ok(value.clone()); } let value = CanvasNode { id: id("canvas-node"), canvas_id: canvas_id.clone(), entity_id, position }; state.store.canvas_nodes.push(value.clone()); let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); status(&mut state, "saved", "Markdown note added to canvas"); state.persist()?; Ok(value) }
#[tauri::command]
fn remove_canvas_node(canvas_id: String, node_id: String, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<(), String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let canvas_value = canvas(&state.store, &canvas_id)?.clone(); if canvas_value.revision != expected_revision { return Err(format!("Revision conflict: expected {expected_revision}, current {}", canvas_value.revision)); } canvas_node(&state.store, &canvas_id, &node_id)?; state.store.canvas_nodes.retain(|node| node.id != node_id); state.store.canvas_edges.retain(|edge| edge.source_node_id != node_id && edge.target_node_id != node_id); let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); status(&mut state, "saved", "Canvas placement removed; Markdown note is unchanged"); state.persist()?; Ok(()) }
#[tauri::command]
fn save_excalidraw_scene(canvas_id: String, scene: serde_json::Value, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<StoryCanvas, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let current = canvas(&state.store, &canvas_id)?.clone(); if current.revision != expected_revision { return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); } if current.engine != "excalidraw" { return Err("Excalidraw scene state can only be saved on an Excalidraw canvas".into()); } if !scene.get("elements").map(|value| value.is_array()).unwrap_or(false) || !scene.get("appState").map(|value| value.is_object()).unwrap_or(false) || !scene.get("files").map(|value| value.is_object()).unwrap_or(false) { return Err("Excalidraw scene state is invalid".into()); } let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.excalidraw_state = Some(scene); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); let value = canvas_mut.clone(); status(&mut state, "saved", "Excalidraw scene saved"); state.persist()?; Ok(value) }

#[tauri::command]
fn save_canvas_layout(canvas_id: String, positions: Vec<CanvasPositionUpdate>, viewport: CanvasViewport, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<StoryCanvas, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let current = canvas(&state.store, &canvas_id)?.clone(); if current.revision != expected_revision { return Err(format!("Revision conflict: expected {expected_revision}, current {}", current.revision)); } if !viewport.x.is_finite() || !viewport.y.is_finite() || !viewport.zoom.is_finite() || viewport.zoom <= 0.0 { return Err("Canvas viewport is invalid".into()); } for update in &positions { if !valid_position(&update.position) { return Err("Canvas position is invalid".into()); } let node = state.store.canvas_nodes.iter_mut().find(|node| node.canvas_id == canvas_id && node.id == update.id).ok_or_else(|| format!("Unknown canvas node {}", update.id))?; node.position = update.position.clone(); } let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.viewport = viewport; canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); let value = canvas_mut.clone(); status(&mut state, "saved", "Canvas arrangement saved; Markdown note content is unchanged"); state.persist()?; Ok(value) }

#[tauri::command]
fn get_document(document_id: String, app: State<'_, Mutex<AppState>>) -> Result<DocumentHead, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let record = document_record(&state.store, &document_id)?; let revision = record.revisions.last().ok_or_else(|| "Document has no revision".to_string())?; Ok(DocumentHead { document_id, document: revision.document.clone(), revision: record.head_revision, revision_id: revision.id.clone() }) }
#[tauri::command]
fn get_revision(revision_id: String, app: State<'_, Mutex<AppState>>) -> Result<Revision, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.documents.iter().flat_map(|record| record.revisions.iter()).find(|item| item.id == revision_id).cloned().ok_or_else(|| "Unknown revision".into()) }
#[tauri::command]
fn save_document(document_id: String, document: Document, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<SaveResult, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; status(&mut state, "saving", "Saving revision…"); validate_document(&document)?; let current_revision = document_record(&state.store, &document_id)?.head_revision; if current_revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this document changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {current_revision}")); } let project_words_before = project_word_count(&state.store); let (revision, head_revision) = { let record = document_mut(&mut state.store, &document_id)?; record.head_revision += 1; let head_revision = record.head_revision; let revision = Revision { id: id("revision"), document_id, number: head_revision, document, created_at: timestamp(), reason: "edit".into() }; record.revisions.push(revision.clone()); (revision, head_revision) }; let delta = project_word_count(&state.store) - project_words_before; if delta != 0 { let date = local_date(); let value = state.store.writing_goals.daily_word_counts.entry(date).or_insert(0); *value = (*value + delta).max(0); } status(&mut state, "saved", &format!("Saved revision {head_revision}")); state.persist()?; Ok(SaveResult { revision, status: state.store.status.clone() }) }

#[tauri::command]
fn enter_continuous_draft(chapter_id: String, app: State<'_, Mutex<AppState>>) -> Result<ContinuousDraft, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let chapter_value = chapter(&state.store, &chapter_id)?.clone(); let composed = compose(&state.store, &chapter_id)?; let record = add_document(&mut state.store, composed, "continuous-draft")?; let source = record.revisions.last().unwrap().clone(); let value = ContinuousDraft { id: id("draft"), chapter_id, document_id: record.id, base_scene_set_id: chapter_value.active_scene_set_id, source_revision_id: source.id, status: "open".into(), created_at: timestamp() }; state.store.drafts.push(value.clone()); status(&mut state, "saved", "Continuous draft opened from a scene snapshot"); state.persist()?; Ok(value) }
#[tauri::command]
fn get_continuous_draft(draft_id: String, app: State<'_, Mutex<AppState>>) -> Result<ContinuousDraft, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(draft(&state.store, &draft_id)?.clone()) }
#[tauri::command]
fn keep_continuous_separate(draft_id: String, app: State<'_, Mutex<AppState>>) -> Result<ContinuousDraft, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let value = draft_mut(&mut state.store, &draft_id)?; if value.status != "open" { return Err(format!("Draft is already {}", value.status)); } value.status = "kept-separate".into(); let output = value.clone(); status(&mut state, "saved", "Continuous draft kept separately; scenes unchanged"); state.persist()?; Ok(output) }
#[tauri::command]
fn automatically_split_continuous(draft_id: String, app: State<'_, Mutex<AppState>>) -> Result<SplitResult, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let before = state.store.clone(); let result = (|| { let draft_value = draft(&state.store, &draft_id)?.clone(); if draft_value.status != "open" { return Err(format!("Draft is already {}", draft_value.status)); } let source = document_record(&state.store, &draft_value.document_id)?.revisions.last().ok_or_else(|| "Draft has no revision".to_string())?.document.clone(); let mut groups: Vec<Vec<DocumentBlock>> = vec![vec![]]; let mut markers = 0; for block in source.blocks { if explicit_marker(&block) { markers += 1; groups.push(vec![]); } else { groups.last_mut().unwrap().push(block); } } if markers == 0 { return Err("No explicit scene marker found. Use *** or Nova cena.".into()); } let groups: Vec<Vec<DocumentBlock>> = groups.into_iter().filter(|group| !group.is_empty()).collect(); let chapter_value = chapter(&state.store, &draft_value.chapter_id)?.clone(); let old_set = state.store.scene_sets.iter_mut().find(|item| item.id == chapter_value.active_scene_set_id).ok_or_else(|| "Active scene set is missing".to_string())?; old_set.active = false; let set = SceneSet { id: id("scene-set"), chapter_id: chapter_value.id.clone(), created_at: timestamp(), source_revision_id: Some(draft_value.source_revision_id.clone()), active: true }; state.store.scene_sets.push(set.clone()); let mut scenes = vec![]; for (position, blocks) in groups.into_iter().enumerate() { let record = add_document(&mut state.store, Document { format_version: DOCUMENT_FORMAT_VERSION, blocks }, "automatic-split")?; scenes.push(Scene { id: id("scene"), scene_set_id: set.id.clone(), title: format!("Scene {}", position + 1), position: position as i64, document_id: record.id }); } state.store.scenes.extend(scenes.clone()); let chapter_mut = state.store.chapters.iter_mut().find(|item| item.id == chapter_value.id).unwrap(); chapter_mut.active_scene_set_id = set.id.clone(); draft_mut(&mut state.store, &draft_id)?.status = "split".into(); status(&mut state, "saved", &format!("Created {} scenes from explicit markers", scenes.len())); Ok(SplitResult { scene_set: set, scenes, source_revision_id: draft_value.source_revision_id }) })(); match result { Ok(value) => { state.persist()?; Ok(value) }, Err(error) => { state.store = before; status(&mut state, "failed", &error); let _ = state.persist(); Err(error) } } }
#[tauri::command]
fn compose_chapter(chapter_id: String, app: State<'_, Mutex<AppState>>) -> Result<Document, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; compose(&state.store, &chapter_id) }

#[tauri::command]
fn get_style_profile(app: State<'_, Mutex<AppState>>) -> Result<EditorStyleProfile, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.style_profile.clone()) }
#[tauri::command]
fn update_style_profile(profile: EditorStyleProfile, app: State<'_, Mutex<AppState>>) -> Result<EditorStyleProfile, String> { if profile.font_family.trim().is_empty() { return Err("Font family is required".into()); } if !(8.0..=72.0).contains(&profile.font_size_pt) { return Err("Font size must be between 8 and 72 pt".into()); } if !["single", "1.15", "1.5", "double"].contains(&profile.line_spacing.as_str()) { return Err("Unsupported line spacing".into()); } if !["letter", "a4", "legal"].contains(&profile.page_size.as_str()) { return Err("Unsupported page size".into()); } for value in [profile.text_margins.top, profile.text_margins.right, profile.text_margins.bottom, profile.text_margins.left] { if !value.is_finite() || !(12.0..=240.0).contains(&value) { return Err("Text margins must be between 12 and 240 px".into()); } } let mut state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.style_profile = profile.clone(); status(&mut state, "saved", "Writing style saved"); state.persist()?; Ok(profile) }
#[tauri::command]
fn writing_stats(app: State<'_, Mutex<AppState>>) -> Result<WritingStats, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(make_writing_stats(&state.store)) }
#[tauri::command]
fn writing_activity(days: Option<i64>, app: State<'_, Mutex<AppState>>) -> Result<Vec<WritingActivity>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(make_writing_activity(&state.store, days.unwrap_or(365).max(1) as usize)) }
#[tauri::command]
fn save_manuscript_version(label: String, app: State<'_, Mutex<AppState>>) -> Result<ManuscriptVersionSummary, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?;
    let clean_label = label.trim();
    if clean_label.is_empty() { return Err("A version label is required".into()); }
    if clean_label.chars().count() > 160 { return Err("A version label must be 160 characters or fewer".into()); }
    let summary = ManuscriptVersionSummary { id: id("manuscript-version"), project_id: project.id, label: clean_label.into(), created_at: timestamp(), word_count: project_word_count(&state.store), scene_count: state.store.scenes.len() as i64, chapter_count: state.store.chapters.len() as i64 };
    let documents = state.store.documents.iter().filter_map(|record| record.revisions.last().map(|revision| ManuscriptVersionDocument { document_id: record.id.clone(), revision: revision.clone() })).collect();
    let snapshot = ManuscriptVersionSnapshot { stories: state.store.stories.clone(), chapters: state.store.chapters.clone(), scene_sets: state.store.scene_sets.clone(), scenes: state.store.scenes.clone(), continuous_drafts: state.store.drafts.clone(), documents };
    state.store.manuscript_versions.push(StoredManuscriptVersion { summary: summary.clone(), snapshot });
    status(&mut state, "saved", &format!("Manuscript version “{}” saved", summary.label));
    state.persist()?;
    Ok(summary)
}
#[tauri::command]
fn list_manuscript_versions(app: State<'_, Mutex<AppState>>) -> Result<Vec<ManuscriptVersionSummary>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(manuscript_version_summaries(&state.store)) }
#[tauri::command]
fn get_manuscript_version(version_id: String, app: State<'_, Mutex<AppState>>) -> Result<ManuscriptVersionDetail, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; manuscript_version_detail(&state.store, &version_id) }
#[tauri::command]
fn compare_manuscript_versions(from_version_id: String, to_version_id: String, app: State<'_, Mutex<AppState>>) -> Result<ManuscriptVersionComparison, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; compare_manuscript_version_values(&state.store, &from_version_id, &to_version_id) }
#[tauri::command]
fn restore_manuscript_version(version_id: String, app: State<'_, Mutex<AppState>>) -> Result<RestoreManuscriptVersionResult, String> {
    let mut state = app.lock().map_err(|_| "Project lock poisoned")?;
    let detail = manuscript_version_detail(&state.store, &version_id)?;
    let before = state.store.clone();
    let backup = capture_backup(&mut state)?;
    match replace_manuscript_snapshot(&mut state.store, &detail.snapshot) {
        Ok(()) => { status(&mut state, "recovered", &format!("Restored manuscript version “{}”; backup captured first", detail.summary.label)); match state.persist() { Ok(()) => Ok(RestoreManuscriptVersionResult { status: state.store.status.clone(), backup }), Err(error) => { state.store = before; state.store.backups.push(backup.clone()); let _ = state.persist(); Err(error) } } }
        Err(error) => { state.store = before; state.store.backups.push(backup.clone()); status(&mut state, "failed", &error); let _ = state.persist(); Err(error) }
    }
}
#[tauri::command]
fn set_daily_word_target(target: i64, app: State<'_, Mutex<AppState>>) -> Result<WritingGoals, String> { if target < 0 { return Err("Daily word target must be zero or greater".into()); } let mut state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.writing_goals.daily_target = target; status(&mut state, "saved", "Daily writing goal saved"); state.persist()?; Ok(state.store.writing_goals.clone()) }

#[tauri::command]
fn integrity_check(app: State<'_, Mutex<AppState>>) -> Result<IntegrityReport, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; status(&mut state, "integrity-check", "Checking project integrity…"); let db = state.db_path()?; let connection = Connection::open(db).map_err(|e| e.to_string())?; let value: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|e| e.to_string())?; let checked_at = timestamp(); let report = if value != "ok" { IntegrityReport { ok: false, message: format!("SQLite integrity check: {value}"), checked_at } } else if let Err(message) = validate_store(&state.store) { IntegrityReport { ok: false, message, checked_at } } else { IntegrityReport { ok: true, message: "Integrity check passed".into(), checked_at } }; status(&mut state, if report.ok { "saved" } else { "failed" }, &report.message); state.persist()?; Ok(report) }
#[tauri::command]
fn capture_backup(state: &mut AppState) -> Result<BackupRecord, String> { let db = state.db_path()?; let backup_id = id("backup"); let backups = db.parent().ok_or_else(|| "Project database has no parent directory".to_string())?.join("backups"); ensure_existing_directory(&backups, "project backups directory")?; let path = backups.join(format!("{backup_id}.db")); ensure_safe_write_target(&path, "backup file")?; let created_at = timestamp(); let value = BackupRecord { id: backup_id.clone(), path: path.to_string_lossy().into_owned(), created_at: created_at.clone(), integrity: "ok".into() }; state.store.backups.push(value.clone()); status(state, "backup", "Backup captured"); state.persist()?; let checkpoint = Connection::open(&db).map_err(|e| e.to_string())?; checkpoint.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").map_err(|e| e.to_string())?; ensure_safe_write_target(&path, "backup file")?; fs::copy(&db, &path).map_err(|e| e.to_string())?; let connection = Connection::open(&db).map_err(|e| e.to_string())?; let json = serde_json::to_string(&state.store).map_err(|e| e.to_string())?; connection.execute("INSERT OR REPLACE INTO backups(id, path, created_at, integrity, state_json) VALUES (?1, ?2, ?3, ?4, ?5)", params![&backup_id, &value.path, &created_at, "ok", &json]).map_err(|e| e.to_string())?; Ok(value) }
#[tauri::command]
fn create_backup(app: State<'_, Mutex<AppState>>) -> Result<BackupRecord, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; capture_backup(&mut state) }
#[tauri::command]
fn recover_from_backup(backup_id: String, app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let connection = Connection::open(state.db_path()?).map_err(|e| e.to_string())?; let json: String = connection.query_row("SELECT state_json FROM backups WHERE id=?1", params![backup_id], |row| row.get(0)).map_err(|e| e.to_string())?; state.store = serde_json::from_str(&json).map_err(|e| e.to_string())?; let note_ids: std::collections::HashSet<String> = state.store.markdown_notes.iter().map(|note| note.id.clone()).collect(); state.store.worldbuilding_items.clear(); state.store.relationships.clear(); state.store.document_links.clear(); state.store.canvas_nodes.retain(|node| note_ids.contains(&node.entity_id)); state.store.canvas_edges.clear(); if let Some(project) = state.store.project.as_mut() { project.schema_version = project.schema_version.max(5); } for canvas in &mut state.store.canvases { if canvas.engine.is_empty() { canvas.engine = default_canvas_engine(); } } status(&mut state, "recovered", "Recovered backup; verify the project before editing"); state.persist()?; Ok(state.store.status.clone()) }
#[tauri::command]
fn get_status(app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.status.clone()) }
#[tauri::command]
fn project_snapshot(app: State<'_, Mutex<AppState>>) -> Result<ProjectSnapshot, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; Ok(ProjectSnapshot { project, stories: state.store.stories.clone(), chapters: state.store.chapters.clone(), scene_sets: state.store.scene_sets.clone(), scenes: state.store.scenes.clone(), continuous_drafts: state.store.drafts.clone(), markdown_notes: state.store.markdown_notes.clone(), note_links: state.store.note_links.clone(), canvases: state.store.canvases.clone(), backups: state.store.backups.clone(), style_profile: state.store.style_profile.clone(), writing_stats: make_writing_stats(&state.store), writing_activity: make_writing_activity(&state.store, 365), manuscript_versions: manuscript_version_summaries(&state.store), status: state.store.status.clone() }) }
#[tauri::command]
fn write_export(filename: String, bytes: Vec<u8>, app: State<'_, Mutex<AppState>>) -> Result<String, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let root = state.root.as_ref().ok_or_else(|| "No project is open".to_string())?; let weave = root.join(".weave"); ensure_existing_directory(&weave, ".weave directory")?; let exports = weave.join("exports"); ensure_directory_chain(&exports)?; let safe = Path::new(&filename).file_name().filter(|value| *value != "." && *value != "..").ok_or_else(|| "Invalid export filename".to_string())?; let path = exports.join(safe); ensure_safe_write_target(&path, "export file")?; fs::write(&path, bytes).map_err(|e| e.to_string())?; Ok(path.to_string_lossy().into_owned()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().manage(Mutex::new(AppState::default())).invoke_handler(tauri::generate_handler![create_project, open_project, get_project, create_story, create_chapter, create_scene, rename_story, rename_chapter, delete_story, delete_chapter, delete_scene, list_stories, list_chapters, list_scene_sets, list_scenes, rename_scene, reorder_chapter, reorder_scene, create_markdown_note, update_markdown_note, delete_markdown_note, list_markdown_notes, search_markdown_notes, list_note_links, repair_note_link, create_canvas, update_canvas, delete_canvas, list_canvases, canvas_projection, save_excalidraw_scene, add_canvas_node, remove_canvas_node, save_canvas_layout, get_document, get_revision, get_style_profile, update_style_profile, writing_stats, writing_activity, save_manuscript_version, list_manuscript_versions, get_manuscript_version, compare_manuscript_versions, restore_manuscript_version, set_daily_word_target, enter_continuous_draft, get_continuous_draft, keep_continuous_separate, automatically_split_continuous, compose_chapter, integrity_check, create_backup, recover_from_backup, get_status, project_snapshot, write_export]).run(tauri::generate_context!()).expect("error while running Weave"); }

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(id: &str, position: i64) -> Scene {
        Scene { id: id.into(), scene_set_id: "set".into(), title: id.into(), position, document_id: format!("document-{id}") }
    }

    #[test]
    fn reindex_scene_positions_uses_existing_ordered_positions() {
        let mut scenes = vec![scene("third", 1), scene("first", 2), scene("second", 0)];
        reindex_scene_positions(&mut scenes, "set");
        assert_eq!(scenes.iter().find(|scene| scene.id == "second").unwrap().position, 0);
        assert_eq!(scenes.iter().find(|scene| scene.id == "third").unwrap().position, 1);
        assert_eq!(scenes.iter().find(|scene| scene.id == "first").unwrap().position, 2);
    }

    #[test]
    fn duplicate_restore_ids_are_rejected() {
        let result = ensure_unique_ids(vec!["story-1".to_string(), "story-1".to_string()].into_iter(), "story");
        assert_eq!(result.unwrap_err(), "Duplicate story story-1");
    }

    #[test]
    fn normalizes_project_directory_without_accepting_traversal() {
        assert_eq!(normalized_project_directory(Path::new("/tmp//weave-project")).unwrap(), "/tmp/weave-project");
        assert!(normalized_project_directory(Path::new("/tmp/weave-project/../other")).is_err());
    }

    #[test]
    fn creating_a_database_twice_is_rejected() {
        let root = std::env::temp_dir().join(format!("weave-test-{}", Uuid::new_v4()));
        database_for(&root, true).unwrap();
        let error = database_for(&root, true).unwrap_err();
        assert!(error.contains("already exists"));
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_weave_directory() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("weave-test-{}", Uuid::new_v4()));
        let outside = std::env::temp_dir().join(format!("weave-outside-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, root.join(".weave")).unwrap();
        let error = database_for(&root, true).unwrap_err();
        assert!(error.contains("symlink"));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn reorder_chapter_positions_only_reorders_siblings() {
        let chapter = |id: &str, story_id: &str, position: i64| Chapter { id: id.into(), story_id: story_id.into(), title: id.into(), position, active_scene_set_id: format!("set-{id}") };
        let mut chapters = vec![chapter("first", "story-a", 0), chapter("second", "story-a", 1), chapter("other-story", "story-b", 0)];
        let ordered = reorder_chapter_positions(&mut chapters, "second", 0).unwrap();
        assert_eq!(ordered.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(), vec!["second", "first"]);
        assert_eq!(chapters.iter().find(|item| item.id == "other-story").unwrap().position, 0);
    }

    #[test]
    fn reorder_scene_positions_persists_order_for_both_directions_and_clamps() {
        let mut scenes = vec![scene("first", 0), scene("second", 1), scene("third", 2), scene("other-set", 0)];
        scenes[3].scene_set_id = "other".into();
        let ordered = reorder_scene_positions(&mut scenes, "third", 1).unwrap();
        assert_eq!(ordered.iter().map(|scene| scene.id.as_str()).collect::<Vec<_>>(), vec!["first", "third", "second"]);
        assert_eq!(scenes.iter().filter(|scene| scene.scene_set_id == "set").map(|scene| scene.position).collect::<Vec<_>>(), vec![0, 2, 1]);
        let ordered = reorder_scene_positions(&mut scenes, "first", 99).unwrap();
        assert_eq!(ordered.iter().map(|scene| scene.id.as_str()).collect::<Vec<_>>(), vec!["third", "second", "first"]);
        assert_eq!(scenes.iter().filter(|scene| scene.scene_set_id == "set").map(|scene| scene.position).collect::<Vec<_>>(), vec![2, 1, 0]);
        assert_eq!(scenes.iter().find(|scene| scene.id == "other-set").unwrap().position, 0);
    }

    #[test]
    fn writing_metrics_ignores_malformed_activity_in_average() {
        let mut store = Store::default();
        store.writing_goals.daily_word_counts.insert("2025-01-01".into(), 100);
        store.writing_goals.daily_word_counts.insert("2025-02-30".into(), 1_000);
        store.writing_goals.daily_word_counts.insert("2025-1-01".into(), 2_000);
        store.writing_goals.daily_word_counts.insert("legacy-date".into(), 3_000);

        assert_eq!(writing_metrics(&store, "2025-01-01"), (1, 1, 1, 100));
    }
}
