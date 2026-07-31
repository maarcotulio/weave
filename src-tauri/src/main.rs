use chrono::{Local, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
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
struct StoryCanvas { id: String, story_id: String, title: String, viewport: CanvasViewport, revision: i64, created_at: String, updated_at: String }
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
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextRun { text: String, marks: Vec<String> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentBlock { id: String, kind: String, #[serde(skip_serializing_if = "Option::is_none")] heading_level: Option<u8>, #[serde(skip_serializing_if = "Option::is_none")] alignment: Option<String>, runs: Vec<TextRun> }
#[derive(Clone, Serialize, Deserialize)]
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
struct ContinuousDraft { id: String, chapter_id: String, document_id: String, base_scene_set_id: String, source_revision_id: String, status: String, created_at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupRecord { id: String, path: String, created_at: String, integrity: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OperationStatus { state: String, message: String, at: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditorStyleProfile { font_family: String, font_size_pt: f64, line_spacing: String, #[serde(default = "default_page_size")] page_size: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WritingGoals { daily_target: i64, daily_word_counts: std::collections::HashMap<String, i64> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WritingStats { date: String, daily_target: i64, daily_words: i64, project_words: i64 }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Store {
    project: Option<Project>, stories: Vec<Story>, chapters: Vec<Chapter>, scene_sets: Vec<SceneSet>, scenes: Vec<Scene>, documents: Vec<DocumentRecord>, drafts: Vec<ContinuousDraft>, backups: Vec<BackupRecord>,
    #[serde(default)] worldbuilding_items: Vec<WorldbuildingItem>, #[serde(default)] relationships: Vec<DomainRelationship>, #[serde(default)] document_links: Vec<DocumentLink>, #[serde(default)] markdown_notes: Vec<MarkdownNote>, #[serde(default)] note_links: Vec<NoteLink>, #[serde(default)] canvases: Vec<StoryCanvas>, #[serde(default)] canvas_nodes: Vec<CanvasNode>, #[serde(default)] canvas_edges: Vec<CanvasEdge>,
    #[serde(default = "default_style_profile")] style_profile: EditorStyleProfile,
    #[serde(default = "default_writing_goals")] writing_goals: WritingGoals,
    status: OperationStatus,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot { project: Project, stories: Vec<Story>, chapters: Vec<Chapter>, scene_sets: Vec<SceneSet>, scenes: Vec<Scene>, continuous_drafts: Vec<ContinuousDraft>, markdown_notes: Vec<MarkdownNote>, note_links: Vec<NoteLink>, canvases: Vec<StoryCanvas>, style_profile: EditorStyleProfile, writing_stats: WritingStats, status: OperationStatus }
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
fn default_style_profile() -> EditorStyleProfile { EditorStyleProfile { font_family: "Times New Roman".into(), font_size_pt: 12.0, line_spacing: "double".into(), page_size: default_page_size() } }
fn default_writing_goals() -> WritingGoals { WritingGoals { daily_target: 500, daily_word_counts: std::collections::HashMap::new() } }
impl Default for OperationStatus { fn default() -> Self { Self { state: "idle".into(), message: "Ready".into(), at: timestamp() } } }
impl Default for Store { fn default() -> Self { Self { project: None, stories: vec![], chapters: vec![], scene_sets: vec![], scenes: vec![], documents: vec![], drafts: vec![], backups: vec![], worldbuilding_items: vec![], relationships: vec![], document_links: vec![], markdown_notes: vec![], note_links: vec![], canvases: vec![], canvas_nodes: vec![], canvas_edges: vec![], style_profile: default_style_profile(), writing_goals: default_writing_goals(), status: OperationStatus::default() } } }

struct AppState { root: Option<PathBuf>, store: Store }
impl Default for AppState { fn default() -> Self { Self { root: None, store: Store::default() } } }
impl AppState {
    fn db_path(&self) -> Result<PathBuf, String> { self.root.as_ref().map(|root| root.join(".weave").join("project.db")).ok_or_else(|| "No project is open".into()) }
    fn persist(&self) -> Result<(), String> {
        let path = self.db_path()?;
        let json = serde_json::to_string(&self.store).map_err(|e| e.to_string())?;
        let connection = Connection::open(&path).map_err(|e| e.to_string())?;
        connection.execute("INSERT INTO project_state(id, state_json, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at", params![json, timestamp()]).map_err(|e| e.to_string())?;
        let latest = path.parent().unwrap().join("files").join("latest.json");
        fs::write(latest, json).map_err(|e| e.to_string())
    }
}

fn database_for(root: &Path) -> Result<PathBuf, String> {
    let weave = root.join(".weave");
    fs::create_dir_all(weave.join("files")).map_err(|e| e.to_string())?;
    fs::create_dir_all(weave.join("backups")).map_err(|e| e.to_string())?;
    let db = weave.join("project.db");
    let connection = Connection::open(&db).map_err(|e| e.to_string())?;
    connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_state(id INTEGER PRIMARY KEY CHECK(id=1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, path TEXT NOT NULL, created_at TEXT NOT NULL, integrity TEXT NOT NULL, state_json TEXT NOT NULL);").map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
    connection.execute("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?1)", params![timestamp()]).map_err(|e| e.to_string())?;
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
fn make_writing_stats(store: &Store) -> WritingStats { let date = local_date(); WritingStats { date: date.clone(), daily_target: store.writing_goals.daily_target, daily_words: *store.writing_goals.daily_word_counts.get(&date).unwrap_or(&0), project_words: project_word_count(store) } }
fn add_document(store: &mut Store, value: Document, reason: &str) -> Result<DocumentRecord, String> { validate_document(&value)?; let record_id = id("document"); let revision = Revision { id: id("revision"), document_id: record_id.clone(), number: 1, document: value, created_at: timestamp(), reason: reason.into() }; let record = DocumentRecord { id: record_id, head_revision: 1, revisions: vec![revision] }; store.documents.push(record.clone()); Ok(record) }
fn active_scenes(store: &Store, chapter_id: &str, set_id: &str) -> Vec<Scene> { let mut scenes: Vec<Scene> = store.scenes.iter().filter(|scene| scene.scene_set_id == set_id && store.chapters.iter().any(|chapter| chapter.id == chapter_id)).cloned().collect(); scenes.sort_by_key(|scene| scene.position); scenes }
fn compose(store: &Store, chapter_id: &str) -> Result<Document, String> { let current = chapter(store, chapter_id)?; let scenes = active_scenes(store, chapter_id, &current.active_scene_set_id); let mut blocks = vec![]; for (index, scene) in scenes.iter().enumerate() { if index > 0 { blocks.push(DocumentBlock { id: id("scene-break"), kind: "scene-break".into(), heading_level: None, alignment: None, runs: vec![TextRun { text: String::new(), marks: vec![] }] }); } let record = document_record(store, &scene.document_id)?; let revision = record.revisions.last().ok_or_else(|| "Document has no revision".to_string())?; blocks.extend(revision.document.blocks.clone()); } Ok(Document { format_version: DOCUMENT_FORMAT_VERSION, blocks }) }

#[tauri::command]
fn create_project(directory: String, name: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let root = PathBuf::from(&directory); let _ = database_for(&root)?; state.root = Some(root); let project = Project { id: id("project"), name, directory, schema_version: 4, created_at: timestamp(), updated_at: timestamp() };  state.store = Store::default(); state.store.project = Some(project.clone()); status(&mut state, "saved", "Project created offline"); state.persist()?; Ok(project) }

#[tauri::command]
fn open_project(directory: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let root = PathBuf::from(&directory); let db = database_for(&root)?; state.store = load_store(&db)?; state.root = Some(root); if let Some(project) = state.store.project.as_mut() { project.schema_version = project.schema_version.max(4); } let note_ids: std::collections::HashSet<String> = state.store.markdown_notes.iter().map(|note| note.id.clone()).collect(); state.store.worldbuilding_items.clear(); state.store.relationships.clear(); state.store.document_links.clear(); state.store.canvas_nodes.retain(|node| note_ids.contains(&node.entity_id)); state.store.canvas_edges.clear(); let project = state.store.project.clone().ok_or_else(|| "Project metadata is missing".to_string())?; status(&mut state, "saved", "Project opened offline"); state.persist()?; Ok(project) }
#[tauri::command]
fn get_project(app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.project.clone().ok_or_else(|| "No project is open".into()) }
#[tauri::command]
fn create_story(title: String, app: State<'_, Mutex<AppState>>) -> Result<Story, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; let value = Story { id: id("story"), project_id: project.id, title, position: state.store.stories.len() as i64 }; state.store.stories.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn create_chapter(story_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Chapter, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; story(&state.store, &story_id)?; let chapter_id = id("chapter"); let set = SceneSet { id: id("scene-set"), chapter_id: chapter_id.clone(), created_at: timestamp(), source_revision_id: None, active: true }; let value = Chapter { id: chapter_id, story_id: story_id.clone(), title, position: state.store.chapters.iter().filter(|item| item.story_id == story_id).count() as i64, active_scene_set_id: set.id.clone() }; state.store.scene_sets.push(set); state.store.chapters.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn create_scene(chapter_id: String, title: String, document: Option<Document>, app: State<'_, Mutex<AppState>>) -> Result<Scene, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let chapter_value = chapter(&state.store, &chapter_id)?.clone(); let record = add_document(&mut state.store, document.unwrap_or_else(empty_document), "created")?; let position = state.store.scenes.iter().filter(|item| item.scene_set_id == chapter_value.active_scene_set_id).count() as i64; let value = Scene { id: id("scene"), scene_set_id: chapter_value.active_scene_set_id, title, position, document_id: record.id }; state.store.scenes.push(value.clone()); state.persist()?; Ok(value) }
#[tauri::command]
fn list_stories(app: State<'_, Mutex<AppState>>) -> Result<Vec<Story>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values = state.store.stories.clone(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn list_chapters(story_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<Chapter>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values: Vec<Chapter> = state.store.chapters.iter().filter(|item| story_id.as_ref().map(|id| &item.story_id == id).unwrap_or(true)).cloned().collect(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn list_scene_sets(chapter_id: String, app: State<'_, Mutex<AppState>>) -> Result<Vec<SceneSet>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let mut values: Vec<SceneSet> = state.store.scene_sets.iter().filter(|item| item.chapter_id == chapter_id).cloned().collect(); values.sort_by_key(|item| item.created_at.clone()); Ok(values) }
#[tauri::command]
fn list_scenes(chapter_id: String, scene_set_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<Scene>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let chapter_value = chapter(&state.store, &chapter_id)?; let set = scene_set_id.unwrap_or_else(|| chapter_value.active_scene_set_id.clone()); let mut values: Vec<Scene> = state.store.scenes.iter().filter(|item| item.scene_set_id == set).cloned().collect(); values.sort_by_key(|item| item.position); Ok(values) }
#[tauri::command]
fn rename_scene(scene_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<Scene, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let scene = state.store.scenes.iter_mut().find(|item| item.id == scene_id).ok_or_else(|| "Unknown scene".to_string())?; scene.title = title; let result = scene.clone(); state.persist()?; Ok(result) }
#[tauri::command]
fn reorder_scene(scene_id: String, position: i64, app: State<'_, Mutex<AppState>>) -> Result<Vec<Scene>, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let set_id = state.store.scenes.iter().find(|item| item.id == scene_id).ok_or_else(|| "Unknown scene".to_string())?.scene_set_id.clone(); let mut values: Vec<Scene> = state.store.scenes.iter().filter(|item| item.scene_set_id == set_id).cloned().collect(); values.sort_by_key(|item| item.position); let from = values.iter().position(|item| item.id == scene_id).ok_or_else(|| "Unknown scene".to_string())?; let moved = values.remove(from); let target = position.max(0).min(values.len() as i64) as usize; values.insert(target, moved); for (index, value) in values.iter().enumerate() { if let Some(original) = state.store.scenes.iter_mut().find(|item| item.id == value.id) { original.position = index as i64; } } state.persist()?; Ok(values.into_iter().enumerate().map(|(index, mut value)| { value.position = index as i64; value }).collect()) }

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
fn create_canvas(story_id: String, title: String, app: State<'_, Mutex<AppState>>) -> Result<StoryCanvas, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; story(&state.store, &story_id)?; if title.trim().is_empty() { return Err("Canvas title is required".into()); } let value = StoryCanvas { id: id("canvas"), story_id, title: title.trim().into(), viewport: CanvasViewport { x: 0.0, y: 0.0, zoom: 1.0 }, revision: 1, created_at: timestamp(), updated_at: timestamp() }; state.store.canvases.push(value.clone()); status(&mut state, "saved", "Story canvas saved"); state.persist()?; Ok(value) }
#[tauri::command]
fn list_canvases(story_id: Option<String>, app: State<'_, Mutex<AppState>>) -> Result<Vec<StoryCanvas>, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.canvases.iter().filter(|value| story_id.as_ref().map(|id| value.story_id == *id).unwrap_or(true)).cloned().collect()) }
#[tauri::command]
fn canvas_projection(canvas_id: String, app: State<'_, Mutex<AppState>>) -> Result<CanvasProjection, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let value = canvas(&state.store, &canvas_id)?.clone(); let nodes: Result<Vec<CanvasProjectionNode>, String> = state.store.canvas_nodes.iter().filter(|node| node.canvas_id == canvas_id).map(|node| markdown_note(&state.store, &node.entity_id).map(|note| CanvasProjectionNode { id: node.id.clone(), canvas_id: node.canvas_id.clone(), entity_id: node.entity_id.clone(), position: node.position.clone(), entity_kind: "note".into(), label: note.title.clone() })).collect(); let nodes = nodes?; let edges: Vec<CanvasEdge> = state.store.note_links.iter().filter_map(|link| { let target = link.target_id.as_ref()?; let source_node = nodes.iter().find(|node| node.entity_id == link.note_id)?; let target_node = nodes.iter().find(|node| node.entity_id == *target)?; Some(CanvasEdge { id: format!("canvas-note-link-{canvas_id}-{}", link.id), canvas_id: canvas_id.clone(), source_node_id: source_node.id.clone(), target_node_id: target_node.id.clone(), note_link_id: link.id.clone() }) }).collect(); Ok(CanvasProjection { canvas: value, nodes, edges }) }
#[tauri::command]
fn add_canvas_node(canvas_id: String, entity_id: String, position: CanvasPosition, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<CanvasNode, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let canvas_value = canvas(&state.store, &canvas_id)?.clone(); if canvas_value.revision != expected_revision { status(&mut state, "revision-conflict", "Save stopped: this canvas changed elsewhere"); state.persist()?; return Err(format!("Revision conflict: expected {expected_revision}, current {}", canvas_value.revision)); } markdown_note(&state.store, &entity_id)?; if !valid_position(&position) { return Err("Canvas position is invalid".into()); } if let Some(value) = state.store.canvas_nodes.iter().find(|node| node.canvas_id == canvas_id && node.entity_id == entity_id) { return Ok(value.clone()); } let value = CanvasNode { id: id("canvas-node"), canvas_id: canvas_id.clone(), entity_id, position }; state.store.canvas_nodes.push(value.clone()); let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); status(&mut state, "saved", "Markdown note added to canvas"); state.persist()?; Ok(value) }
#[tauri::command]
fn remove_canvas_node(canvas_id: String, node_id: String, expected_revision: i64, app: State<'_, Mutex<AppState>>) -> Result<(), String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let canvas_value = canvas(&state.store, &canvas_id)?.clone(); if canvas_value.revision != expected_revision { return Err(format!("Revision conflict: expected {expected_revision}, current {}", canvas_value.revision)); } canvas_node(&state.store, &canvas_id, &node_id)?; state.store.canvas_nodes.retain(|node| node.id != node_id); state.store.canvas_edges.retain(|edge| edge.source_node_id != node_id && edge.target_node_id != node_id); let canvas_mut = state.store.canvases.iter_mut().find(|item| item.id == canvas_id).unwrap(); canvas_mut.revision += 1; canvas_mut.updated_at = timestamp(); status(&mut state, "saved", "Canvas placement removed; Markdown note is unchanged"); state.persist()?; Ok(()) }
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
fn update_style_profile(profile: EditorStyleProfile, app: State<'_, Mutex<AppState>>) -> Result<EditorStyleProfile, String> { if profile.font_family.trim().is_empty() { return Err("Font family is required".into()); } if !(8.0..=72.0).contains(&profile.font_size_pt) { return Err("Font size must be between 8 and 72 pt".into()); } if !["single", "1.15", "1.5", "double"].contains(&profile.line_spacing.as_str()) { return Err("Unsupported line spacing".into()); } if !["letter", "a4", "legal"].contains(&profile.page_size.as_str()) { return Err("Unsupported page size".into()); } let mut state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.style_profile = profile.clone(); status(&mut state, "saved", "Writing style saved"); state.persist()?; Ok(profile) }
#[tauri::command]
fn writing_stats(app: State<'_, Mutex<AppState>>) -> Result<WritingStats, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(make_writing_stats(&state.store)) }
#[tauri::command]
fn set_daily_word_target(target: i64, app: State<'_, Mutex<AppState>>) -> Result<WritingGoals, String> { if target < 0 { return Err("Daily word target must be zero or greater".into()); } let mut state = app.lock().map_err(|_| "Project lock poisoned")?; state.store.writing_goals.daily_target = target; status(&mut state, "saved", "Daily writing goal saved"); state.persist()?; Ok(state.store.writing_goals.clone()) }

#[tauri::command]
fn integrity_check(app: State<'_, Mutex<AppState>>) -> Result<IntegrityReport, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; status(&mut state, "integrity-check", "Checking project integrity…"); let db = state.db_path()?; let connection = Connection::open(db).map_err(|e| e.to_string())?; let value: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|e| e.to_string())?; let checked_at = timestamp(); let report = if value == "ok" { IntegrityReport { ok: true, message: "Integrity check passed".into(), checked_at } } else { IntegrityReport { ok: false, message: value, checked_at } }; status(&mut state, if report.ok { "saved" } else { "failed" }, &report.message); state.persist()?; Ok(report) }
#[tauri::command]
fn create_backup(app: State<'_, Mutex<AppState>>) -> Result<BackupRecord, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let db = state.db_path()?; let backup_id = id("backup"); let path = state.root.as_ref().unwrap().join(".weave").join("backups").join(format!("{backup_id}.db")); let created_at = timestamp(); let value = BackupRecord { id: backup_id.clone(), path: path.to_string_lossy().into_owned(), created_at: created_at.clone(), integrity: "ok".into() }; state.store.backups.push(value.clone()); status(&mut state, "backup", "Backup captured"); state.persist()?; let checkpoint = Connection::open(&db).map_err(|e| e.to_string())?; checkpoint.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").map_err(|e| e.to_string())?; fs::copy(&db, &path).map_err(|e| e.to_string())?; let connection = Connection::open(&db).map_err(|e| e.to_string())?; let json = serde_json::to_string(&state.store).map_err(|e| e.to_string())?; connection.execute("INSERT OR REPLACE INTO backups(id, path, created_at, integrity, state_json) VALUES (?1, ?2, ?3, ?4, ?5)", params![&backup_id, &value.path, &created_at, "ok", &json]).map_err(|e| e.to_string())?; Ok(value) }
#[tauri::command]
fn recover_from_backup(backup_id: String, app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let connection = Connection::open(state.db_path()?).map_err(|e| e.to_string())?; let json: String = connection.query_row("SELECT state_json FROM backups WHERE id=?1", params![backup_id], |row| row.get(0)).map_err(|e| e.to_string())?; state.store = serde_json::from_str(&json).map_err(|e| e.to_string())?; let note_ids: std::collections::HashSet<String> = state.store.markdown_notes.iter().map(|note| note.id.clone()).collect(); state.store.worldbuilding_items.clear(); state.store.relationships.clear(); state.store.document_links.clear(); state.store.canvas_nodes.retain(|node| note_ids.contains(&node.entity_id)); state.store.canvas_edges.clear(); if let Some(project) = state.store.project.as_mut() { project.schema_version = project.schema_version.max(4); } status(&mut state, "recovered", "Recovered backup; verify the project before editing"); state.persist()?; Ok(state.store.status.clone()) }
#[tauri::command]
fn get_status(app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.status.clone()) }
#[tauri::command]
fn project_snapshot(app: State<'_, Mutex<AppState>>) -> Result<ProjectSnapshot, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; Ok(ProjectSnapshot { project, stories: state.store.stories.clone(), chapters: state.store.chapters.clone(), scene_sets: state.store.scene_sets.clone(), scenes: state.store.scenes.clone(), continuous_drafts: state.store.drafts.clone(), markdown_notes: state.store.markdown_notes.clone(), note_links: state.store.note_links.clone(), canvases: state.store.canvases.clone(), style_profile: state.store.style_profile.clone(), writing_stats: make_writing_stats(&state.store), status: state.store.status.clone() }) }
#[tauri::command]
fn write_export(filename: String, bytes: Vec<u8>, app: State<'_, Mutex<AppState>>) -> Result<String, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let root = state.root.as_ref().ok_or_else(|| "No project is open".to_string())?; let exports = root.join(".weave").join("exports"); fs::create_dir_all(&exports).map_err(|e| e.to_string())?; let safe = Path::new(&filename).file_name().ok_or_else(|| "Invalid export filename".to_string())?; let path = exports.join(safe); fs::write(&path, bytes).map_err(|e| e.to_string())?; Ok(path.to_string_lossy().into_owned()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().manage(Mutex::new(AppState::default())).invoke_handler(tauri::generate_handler![create_project, open_project, get_project, create_story, create_chapter, create_scene, list_stories, list_chapters, list_scene_sets, list_scenes, rename_scene, reorder_scene, create_markdown_note, update_markdown_note, delete_markdown_note, list_markdown_notes, search_markdown_notes, list_note_links, repair_note_link, create_canvas, list_canvases, canvas_projection, add_canvas_node, remove_canvas_node, save_canvas_layout, get_document, get_revision, save_document, get_style_profile, update_style_profile, writing_stats, set_daily_word_target, enter_continuous_draft, get_continuous_draft, keep_continuous_separate, automatically_split_continuous, compose_chapter, integrity_check, create_backup, recover_from_backup, get_status, project_snapshot, write_export]).run(tauri::generate_context!()).expect("error while running Weave"); }
