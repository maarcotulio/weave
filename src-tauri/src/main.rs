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
    #[serde(default = "default_style_profile")] style_profile: EditorStyleProfile,
    #[serde(default = "default_writing_goals")] writing_goals: WritingGoals,
    status: OperationStatus,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSnapshot { project: Project, stories: Vec<Story>, chapters: Vec<Chapter>, scene_sets: Vec<SceneSet>, scenes: Vec<Scene>, continuous_drafts: Vec<ContinuousDraft>, style_profile: EditorStyleProfile, writing_stats: WritingStats, status: OperationStatus }
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

fn default_page_size() -> String { "letter".into() }
fn default_style_profile() -> EditorStyleProfile { EditorStyleProfile { font_family: "Times New Roman".into(), font_size_pt: 12.0, line_spacing: "double".into(), page_size: default_page_size() } }
fn default_writing_goals() -> WritingGoals { WritingGoals { daily_target: 500, daily_word_counts: std::collections::HashMap::new() } }
impl Default for OperationStatus { fn default() -> Self { Self { state: "idle".into(), message: "Ready".into(), at: timestamp() } } }
impl Default for Store { fn default() -> Self { Self { project: None, stories: vec![], chapters: vec![], scene_sets: vec![], scenes: vec![], documents: vec![], drafts: vec![], backups: vec![], style_profile: default_style_profile(), writing_goals: default_writing_goals(), status: OperationStatus::default() } } }

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
fn create_project(directory: String, name: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let root = PathBuf::from(&directory); let _ = database_for(&root)?; state.root = Some(root); let project = Project { id: id("project"), name, directory, schema_version: 1, created_at: timestamp(), updated_at: timestamp() }; state.store = Store::default(); state.store.project = Some(project.clone()); status(&mut state, "saved", "Project created offline"); state.persist()?; Ok(project) }

#[tauri::command]
fn open_project(directory: String, app: State<'_, Mutex<AppState>>) -> Result<Project, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let root = PathBuf::from(&directory); let db = database_for(&root)?; state.store = load_store(&db)?; state.root = Some(root); let project = state.store.project.clone().ok_or_else(|| "Project metadata is missing".to_string())?; status(&mut state, "saved", "Project opened offline"); state.persist()?; Ok(project) }
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
fn recover_from_backup(backup_id: String, app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let mut state = app.lock().map_err(|_| "Project lock poisoned")?; let connection = Connection::open(state.db_path()?).map_err(|e| e.to_string())?; let json: String = connection.query_row("SELECT state_json FROM backups WHERE id=?1", params![backup_id], |row| row.get(0)).map_err(|e| e.to_string())?; state.store = serde_json::from_str(&json).map_err(|e| e.to_string())?; status(&mut state, "recovered", "Recovered backup; verify the project before editing"); state.persist()?; Ok(state.store.status.clone()) }
#[tauri::command]
fn get_status(app: State<'_, Mutex<AppState>>) -> Result<OperationStatus, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; Ok(state.store.status.clone()) }
#[tauri::command]
fn project_snapshot(app: State<'_, Mutex<AppState>>) -> Result<ProjectSnapshot, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let project = state.store.project.clone().ok_or_else(|| "No project is open".to_string())?; Ok(ProjectSnapshot { project, stories: state.store.stories.clone(), chapters: state.store.chapters.clone(), scene_sets: state.store.scene_sets.clone(), scenes: state.store.scenes.clone(), continuous_drafts: state.store.drafts.clone(), style_profile: state.store.style_profile.clone(), writing_stats: make_writing_stats(&state.store), status: state.store.status.clone() }) }
#[tauri::command]
fn write_export(filename: String, bytes: Vec<u8>, app: State<'_, Mutex<AppState>>) -> Result<String, String> { let state = app.lock().map_err(|_| "Project lock poisoned")?; let root = state.root.as_ref().ok_or_else(|| "No project is open".to_string())?; let exports = root.join(".weave").join("exports"); fs::create_dir_all(&exports).map_err(|e| e.to_string())?; let safe = Path::new(&filename).file_name().ok_or_else(|| "Invalid export filename".to_string())?; let path = exports.join(safe); fs::write(&path, bytes).map_err(|e| e.to_string())?; Ok(path.to_string_lossy().into_owned()) }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() { tauri::Builder::default().manage(Mutex::new(AppState::default())).invoke_handler(tauri::generate_handler![create_project, open_project, get_project, create_story, create_chapter, create_scene, list_stories, list_chapters, list_scene_sets, list_scenes, rename_scene, reorder_scene, get_document, get_revision, save_document, get_style_profile, update_style_profile, writing_stats, set_daily_word_target, enter_continuous_draft, get_continuous_draft, keep_continuous_separate, automatically_split_continuous, compose_chapter, integrity_check, create_backup, recover_from_backup, get_status, project_snapshot, write_export]).run(tauri::generate_context!()).expect("error while running Weave"); }
