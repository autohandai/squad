//! Rebuildable local text-feature retrieval for the bridge's memory library.
//!
//! Saved member/team records remain authoritative in the bridge. This process
//! owns only a derived TurboVec index, never visibility decisions: each query
//! must provide the IDs approved by the caller. Features intentionally match
//! native Squad's lexical index; no model, API key or network is involved.

use anyhow::{anyhow, ensure, Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use turbovec::IdMapIndex;

pub const DIMENSIONS: usize = 1536;
pub const BIT_WIDTH: usize = 4;
pub const ENCODER: &str = "squad-lexical-tokens-bigrams-v1";
pub const TURBOVEC_VERSION: &str = "1.1.2";
pub const MAX_DOCUMENTS: usize = 20_000;
pub const MAX_DOCUMENT_BYTES: usize = 32 * 1024;
pub const MAX_QUERY_BYTES: usize = 16 * 1024;
pub const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const MAX_CACHE_BYTES: usize = 128 * 1024 * 1024;
const INDEX_FILE: &str = "memory.tvim";
const MANIFEST_FILE: &str = "memory-index.json";

#[derive(Debug, Parser)]
#[command(name = "autohand-squad-daemon")]
#[command(about = "Squad private local memory index pipe")]
pub struct MemoryIndexArgs {
    #[arg(long, required = true)]
    pub memory_index: bool,
    #[arg(long)]
    pub index_dir: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Document {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    #[serde(default)]
    id: Value,
    op: String,
    #[serde(default)]
    documents: Vec<Document>,
    #[serde(default)]
    query: String,
    #[serde(default)]
    allowed_ids: Vec<String>,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    20
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u8,
    encoder: String,
    dimensions: usize,
    bit_width: usize,
    fingerprint: String,
    index_sha256: String,
    documents: Vec<Document>,
}

#[derive(Debug, Serialize)]
pub struct Hit {
    pub id: String,
    pub score: f32,
}

pub struct MemoryIndex {
    directory: PathBuf,
    index: IdMapIndex,
    documents: BTreeMap<String, String>,
    names: HashMap<u64, String>,
    fingerprint: String,
    warnings: Vec<String>,
    cache_dirty: bool,
}

impl MemoryIndex {
    pub fn open(directory: impl AsRef<Path>) -> Result<Self> {
        let directory = directory.as_ref().to_path_buf();
        // The path is supplied by the trusted bridge, not by a memory tool.
        if directory.exists() {
            let metadata = fs::symlink_metadata(&directory)?;
            ensure!(
                metadata.is_dir() && !metadata.file_type().is_symlink(),
                "memory index directory must be a real directory"
            );
        } else {
            fs::create_dir_all(&directory).context("creating memory index directory")?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
            }
        }
        let mut state = Self {
            directory,
            index: new_index()?,
            documents: BTreeMap::new(),
            names: HashMap::new(),
            fingerprint: fingerprint(&BTreeMap::new()),
            warnings: Vec::new(),
            cache_dirty: false,
        };
        let manifest_path = state.directory.join(MANIFEST_FILE);
        let index_path = state.directory.join(INDEX_FILE);
        if !manifest_path.exists() && !index_path.exists() {
            return Ok(state);
        }
        // Decode bounded saved documents first. An invalid manifest is not
        // authoritative memory: fail closed to empty until the bridge syncs.
        let manifest = read_bounded(&manifest_path, MAX_CACHE_BYTES)
            .and_then(|bytes| {
                serde_json::from_slice::<Manifest>(&bytes).context("decoding memory index manifest")
            })
            .and_then(|manifest| {
                ensure!(
                    manifest.version == 1
                        && manifest.encoder == ENCODER
                        && manifest.dimensions == DIMENSIONS
                        && manifest.bit_width == BIT_WIDTH,
                    "memory index format changed"
                );
                let documents = validate_documents(manifest.documents.clone())?;
                ensure!(
                    fingerprint(&documents) == manifest.fingerprint,
                    "memory manifest fingerprint differs"
                );
                Ok((manifest, documents))
            });
        let (manifest, documents) = match manifest {
            Ok(value) => value,
            Err(_) => {
                state.warnings.push("The derived memory manifest was unreadable or incompatible. Waiting for saved memories to be collected again.".into());
                state.cache_dirty = true;
                return Ok(state);
            }
        };
        let names = names_for(&documents)?;
        let loaded = read_bounded(&index_path, MAX_CACHE_BYTES).and_then(|bytes| {
            ensure!(
                digest(&bytes) == manifest.index_sha256,
                "memory vector checksum differs"
            );
            let index = IdMapIndex::from_bytes(&bytes).context("decoding TurboVec memory index")?;
            ensure!(
                index.dim_opt() == Some(DIMENSIONS)
                    && index.bit_width() == BIT_WIDTH
                    && index.len() == names.len(),
                "memory vector shape differs"
            );
            ensure!(
                names.keys().all(|id| index.contains(*id)),
                "memory vector IDs differ"
            );
            Ok(index)
        });
        state.index = match loaded {
            Ok(index) => index,
            Err(_) => {
                state.warnings.push("The derived TurboVec index was unreadable or incompatible and was rebuilt from its saved memory snapshot.".into());
                state.cache_dirty = true;
                build_index(&documents)?
            }
        };
        state.documents = documents;
        state.names = names;
        state.fingerprint = manifest.fingerprint;
        if state.cache_dirty {
            state.persist_or_warn();
        }
        Ok(state)
    }

    pub fn status(&self) -> Value {
        json!({
            "engine": "turbovec", "version": TURBOVEC_VERSION,
            "encoder": ENCODER, "dimensions": DIMENSIONS, "bitWidth": BIT_WIDTH,
            "itemCount": self.documents.len(), "fingerprint": self.fingerprint,
            "cached": !self.cache_dirty, "warnings": self.warnings,
            "limits": {"documents": MAX_DOCUMENTS, "documentBytes": MAX_DOCUMENT_BYTES,
                "queryBytes": MAX_QUERY_BYTES, "requestBytes": MAX_REQUEST_BYTES,
                "collectionTextBytes": MAX_REQUEST_BYTES / 2,
                "documentTokens": 4096, "queryTokens": 512, "results": 100},
        })
    }

    pub fn sync(&mut self, documents: Vec<Document>) -> Result<Value> {
        let next = validate_documents(documents)?;
        let next_fingerprint = fingerprint(&next);
        if next_fingerprint == self.fingerprint {
            // A successful authoritative collection resolves startup cache
            // warnings; only a still-failing cache write should remain.
            self.warnings.clear();
            if self.cache_dirty {
                self.persist_or_warn();
            }
            let mut status = self.status();
            status["added"] = json!(0);
            status["updated"] = json!(0);
            status["removed"] = json!(0);
            status["unchanged"] = json!(next.len());
            return Ok(status);
        }
        let names = names_for(&next)?;
        let removed: Vec<_> = self
            .documents
            .keys()
            .filter(|id| !next.contains_key(*id))
            .cloned()
            .collect();
        let changed: Vec<_> = next
            .iter()
            .filter(|(id, text)| self.documents.get(*id) != Some(*text))
            .collect();
        let added = changed
            .iter()
            .filter(|(id, _)| !self.documents.contains_key(*id))
            .count();
        let updated = changed.len() - added;
        // All validation happens before native mutations. Stable external IDs
        // survive TurboVec's swap-remove slots and process restarts.
        for id in removed.iter().chain(changed.iter().map(|(id, _)| *id)) {
            self.index.remove(vector_id(id));
        }
        for chunk in changed.chunks(128) {
            let mut vectors = Vec::with_capacity(chunk.len() * DIMENSIONS);
            let mut added_ids = Vec::with_capacity(chunk.len());
            for (id, text) in chunk {
                vectors.extend(features(text, 4096).unwrap_or_else(|| vec![0.; DIMENSIONS]));
                added_ids.push(vector_id(id));
            }
            if let Err(error) = self.index.add_with_ids(&vectors, &added_ids) {
                self.index = build_index(&self.documents)?;
                return Err(anyhow!("indexing memory text features: {error}"));
            }
        }
        self.documents = next;
        self.names = names;
        self.fingerprint = next_fingerprint;
        self.cache_dirty = true;
        self.warnings.clear();
        self.persist_or_warn();
        let mut status = self.status();
        status["added"] = json!(added);
        status["updated"] = json!(updated);
        status["removed"] = json!(removed.len());
        status["unchanged"] = json!(self.documents.len() - added - updated);
        Ok(status)
    }

    pub fn search(&self, query: &str, allowed_ids: &[String], limit: usize) -> Result<Vec<Hit>> {
        ensure!(
            query.len() <= MAX_QUERY_BYTES,
            "memory query exceeds {MAX_QUERY_BYTES} bytes"
        );
        ensure!(
            allowed_ids.len() <= MAX_DOCUMENTS,
            "too many allowed memory IDs"
        );
        ensure!(
            limit <= 100,
            "memory search limit must be between 0 and 100"
        );
        // An omitted or empty allowlist always means none, never all. Unknown
        // IDs are stale caller metadata and cannot broaden the search.
        if allowed_ids.is_empty() || limit == 0 || self.documents.is_empty() {
            return Ok(Vec::new());
        }
        let mut allowed: Vec<_> = allowed_ids
            .iter()
            .filter(|id| self.documents.contains_key(*id))
            .map(|id| vector_id(id))
            .collect();
        allowed.sort_unstable();
        allowed.dedup();
        if allowed.is_empty() {
            return Ok(Vec::new());
        }
        let Some(query) = features(query, 512) else {
            return Ok(Vec::new());
        };
        let found = self
            .index
            .try_search_with_allowlist(&query, limit.min(allowed.len()), Some(&allowed))
            .map_err(|error| anyhow!("TurboVec memory search: {error}"))?;
        ensure!(
            found.nq == 1 && found.ids.len() == found.scores.len() && found.ids.len() == found.k,
            "unexpected memory search result shape"
        );
        let allowed: HashSet<_> = allowed.into_iter().collect();
        let mut hits = Vec::with_capacity(found.ids.len());
        for (id, score) in found.ids.into_iter().zip(found.scores) {
            ensure!(
                allowed.contains(&id) && score.is_finite(),
                "memory search returned an invalid or inaccessible result"
            );
            if score > 0. {
                hits.push(Hit {
                    id: self
                        .names
                        .get(&id)
                        .context("memory vector ID has no saved document")?
                        .clone(),
                    score,
                });
            }
        }
        Ok(hits)
    }

    fn persist_or_warn(&mut self) {
        match self.persist() {
            Ok(()) => self.cache_dirty = false,
            Err(failure) => {
                self.cache_dirty = true;
                // The bridge shows a calm retry message; the private worker's
                // stderr preserves the I/O cause for local diagnosis.
                eprintln!("Squad memory index cache could not be persisted: {failure:#}");
                let warning = "Memory retrieval is available, but its derived index could not be cached. The next collection will retry.";
                if !self.warnings.iter().any(|item| item == warning) {
                    self.warnings.push(warning.into());
                }
            }
        }
    }

    fn persist(&self) -> Result<()> {
        let bytes = self.index.to_bytes();
        ensure!(
            bytes.len() <= MAX_CACHE_BYTES,
            "memory vector cache exceeds its limit"
        );
        let manifest = Manifest {
            version: 1,
            encoder: ENCODER.into(),
            dimensions: DIMENSIONS,
            bit_width: BIT_WIDTH,
            fingerprint: self.fingerprint.clone(),
            index_sha256: digest(&bytes),
            documents: self
                .documents
                .iter()
                .map(|(id, text)| Document {
                    id: id.clone(),
                    text: text.clone(),
                })
                .collect(),
        };
        // Checksummed pair. A crash between the two atomic replacements leaves
        // an unmatched derived cache, rebuilt from the committed manifest.
        let manifest_bytes = serde_json::to_vec(&manifest)?;
        ensure!(
            manifest_bytes.len() <= MAX_CACHE_BYTES,
            "memory manifest exceeds its size limit"
        );
        atomic_write(&self.directory, INDEX_FILE, &bytes)?;
        atomic_write(&self.directory, MANIFEST_FILE, &manifest_bytes)?;
        Ok(())
    }
}

fn new_index() -> Result<IdMapIndex> {
    IdMapIndex::new(DIMENSIONS, BIT_WIDTH)
        .map_err(|error| anyhow!("creating TurboVec memory index: {error}"))
}

fn validate_documents(documents: Vec<Document>) -> Result<BTreeMap<String, String>> {
    ensure!(
        documents.len() <= MAX_DOCUMENTS,
        "memory collection exceeds {MAX_DOCUMENTS} documents"
    );
    let mut output = BTreeMap::new();
    let mut bytes = 0usize;
    for document in documents {
        ensure!(
            !document.id.is_empty()
                && document.id.len() <= 256
                && !document.id.chars().any(char::is_control),
            "memory ID must contain 1-256 bytes without control characters"
        );
        ensure!(
            document.text.len() <= MAX_DOCUMENT_BYTES,
            "memory {} exceeds {MAX_DOCUMENT_BYTES} text bytes",
            document.id
        );
        bytes = bytes
            .saturating_add(document.id.len())
            .saturating_add(document.text.len());
        ensure!(
            bytes <= MAX_REQUEST_BYTES / 2,
            "memory collection text exceeds {} bytes",
            MAX_REQUEST_BYTES / 2
        );
        ensure!(
            !output.contains_key(&document.id),
            "duplicate memory ID {}",
            document.id
        );
        output.insert(document.id, document.text);
    }
    // Resolve the exceedingly unlikely truncated-hash collision before any
    // vector mutation; never alias two records at the access boundary.
    names_for(&output)?;
    Ok(output)
}

fn names_for(documents: &BTreeMap<String, String>) -> Result<HashMap<u64, String>> {
    let mut names = HashMap::with_capacity(documents.len());
    for id in documents.keys() {
        ensure!(
            names.insert(vector_id(id), id.clone()).is_none(),
            "memory IDs have a vector hash collision"
        );
    }
    Ok(names)
}

fn vector_id(id: &str) -> u64 {
    let hash = Sha256::digest(id.as_bytes());
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&hash[..8]);
    u64::from_le_bytes(bytes)
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn fingerprint(documents: &BTreeMap<String, String>) -> String {
    let mut hash = Sha256::new();
    hash.update(ENCODER.as_bytes());
    for (id, text) in documents {
        for field in [id, text] {
            hash.update((field.len() as u64).to_le_bytes());
            hash.update(field.as_bytes());
        }
    }
    format!("{:x}", hash.finalize())
}

fn features(text: &str, max_tokens: usize) -> Option<Vec<f32>> {
    let mut vector = vec![0.; DIMENSIONS];
    let mut previous: Option<String> = None;
    for token in text
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .take(max_tokens)
    {
        let token: String = token
            .chars()
            .take(64)
            .flat_map(char::to_lowercase)
            .collect();
        add_feature(&mut vector, &format!("token:{token}"), 1.);
        if let Some(previous) = previous {
            add_feature(&mut vector, &format!("pair:{previous} {token}"), 0.5);
        }
        previous = Some(token);
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm <= f32::EPSILON || !norm.is_finite() {
        return None;
    }
    for value in &mut vector {
        *value /= norm;
    }
    Some(vector)
}

fn add_feature(vector: &mut [f32], text: &str, weight: f32) {
    let hash = digest(text.as_bytes());
    let key = hash.bytes().take(16).fold(0u64, |key, byte| {
        key.wrapping_mul(33).wrapping_add(u64::from(byte))
    });
    let sign = if key & (1 << 63) == 0 { 1. } else { -1. };
    vector[(key as usize) % DIMENSIONS] += sign * weight;
}

fn build_index(documents: &BTreeMap<String, String>) -> Result<IdMapIndex> {
    let mut index = new_index()?;
    // Bound temporary full-precision storage; the live index is compressed.
    for chunk in documents.iter().collect::<Vec<_>>().chunks(128) {
        let mut vectors = Vec::with_capacity(chunk.len() * DIMENSIONS);
        let mut ids = Vec::with_capacity(chunk.len());
        for (id, text) in chunk {
            vectors.extend(features(text, 4096).unwrap_or_else(|| vec![0.; DIMENSIONS]));
            ids.push(vector_id(id));
        }
        index
            .add_with_ids(&vectors, &ids)
            .map_err(|error| anyhow!("rebuilding memory index: {error}"))?;
    }
    Ok(index)
}

fn read_bounded(path: &Path, cap: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    ensure!(
        metadata.is_file() && !metadata.file_type().is_symlink(),
        "memory cache must be a regular file"
    );
    ensure!(
        metadata.len() <= cap as u64,
        "memory cache exceeds its size limit"
    );
    let mut bytes = Vec::new();
    File::open(path)?
        .take(cap as u64 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= cap,
        "memory cache grew beyond its size limit"
    );
    Ok(bytes)
}

fn atomic_write(directory: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let temporary = directory.join(format!(".{name}.{}.{stamp}.tmp", std::process::id()));
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, directory.join(name))?;
        if let Ok(parent) = File::open(directory) {
            let _ = parent.sync_all();
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn handle_request(state: &mut MemoryIndex, request: Request) -> Result<Value> {
    match request.op.as_str() {
        "status" => Ok(state.status()),
        "sync" => state.sync(request.documents),
        "search" => Ok(
            json!({"hits": state.search(&request.query, &request.allowed_ids, request.limit)?, "engine": "turbovec", "encoder": ENCODER}),
        ),
        _ => Err(anyhow!(
            "unknown memory index operation; use sync, search or status"
        )),
    }
}

/// Read newline-delimited JSON without ever allocating beyond the request cap.
/// A malformed/oversized line yields an error and does not terminate the pipe.
pub fn run_stdio(directory: &Path) -> Result<()> {
    let mut state = MemoryIndex::open(directory)?;
    serve(
        &mut state,
        &mut io::stdin().lock(),
        &mut io::stdout().lock(),
    )
}

fn serve(state: &mut MemoryIndex, input: &mut impl BufRead, output: &mut impl Write) -> Result<()> {
    let mut line = Vec::new();
    loop {
        line.clear();
        let mut oversized = false;
        let mut received = false;
        loop {
            let bytes = input.fill_buf()?;
            if bytes.is_empty() {
                break;
            }
            received = true;
            let newline = bytes.iter().position(|byte| *byte == b'\n');
            let count = newline.map_or(bytes.len(), |position| position + 1);
            if !oversized {
                if line.len().saturating_add(count) > MAX_REQUEST_BYTES {
                    oversized = true;
                    line.clear();
                } else {
                    line.extend_from_slice(&bytes[..count]);
                }
            }
            input.consume(count);
            if newline.is_some() {
                break;
            }
        }
        if !received {
            break;
        }
        let response = if oversized {
            json!({"id": null, "success": false, "error": format!("memory index request exceeds {MAX_REQUEST_BYTES} bytes")})
        } else {
            match serde_json::from_slice::<Request>(&line) {
                Ok(request) => {
                    let id = request.id.clone();
                    match handle_request(state, request) {
                        Ok(data) => json!({"id": id, "success": true, "data": data}),
                        Err(error) => {
                            json!({"id": id, "success": false, "error": format!("{error:#}")})
                        }
                    }
                }
                Err(error) => {
                    json!({"id": null, "success": false, "error": format!("invalid memory index request: {error}")})
                }
            }
        };
        serde_json::to_writer(&mut *output, &response)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("squad-memory-index-{}-{stamp}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn doc(id: &str, text: &str) -> Document {
        Document {
            id: id.into(),
            text: text.into(),
        }
    }
    fn ids(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).into()).collect()
    }

    #[test]
    fn memory_index_add_update_delete_reload_and_allowlist() {
        let root = Scratch::new();
        let mut state = MemoryIndex::open(&root.0).unwrap();
        let result = state
            .sync(vec![
                doc("team:release", "release evidence required"),
                doc("private:a", "release evidence required private secret note"),
                doc("project:db", "database migration guide"),
            ])
            .unwrap();
        assert_eq!(result["added"], 3);
        assert_eq!(result["cached"], true, "{result}");
        let hits = state
            .search(
                "release evidence",
                &ids(&["team:release", "project:db"]),
                10,
            )
            .unwrap();
        assert_eq!(hits[0].id, "team:release");
        assert!(hits.iter().all(|hit| hit.id != "private:a"));
        assert!(state.search("release", &[], 10).unwrap().is_empty());
        assert!(state
            .search("release", &ids(&["missing"]), 10)
            .unwrap()
            .is_empty());
        assert!(state
            .search("...", &ids(&["team:release"]), 10)
            .unwrap()
            .is_empty());
        let reloaded = MemoryIndex::open(&root.0).unwrap();
        assert_eq!(
            reloaded
                .search("release evidence", &ids(&["team:release"]), 10)
                .unwrap()[0]
                .id,
            "team:release"
        );
        let result = state
            .sync(vec![
                doc("private:a", "release evidence required private secret note"),
                doc("project:db", "updated database backup guide"),
            ])
            .unwrap();
        assert_eq!(result["updated"], 1);
        assert_eq!(result["removed"], 1);
        assert_eq!(result["unchanged"], 1);
        assert!(state
            .search("release evidence", &ids(&["team:release"]), 10)
            .unwrap()
            .is_empty());
        let reloaded = MemoryIndex::open(&root.0).unwrap();
        assert!(!reloaded.index.contains(vector_id("team:release")));
        assert_eq!(
            reloaded
                .search("updated database backup", &ids(&["project:db"]), 1)
                .unwrap()[0]
                .id,
            "project:db"
        );
        assert_eq!(
            state
                .sync(vec![
                    doc("private:a", "release evidence required private secret note"),
                    doc("project:db", "updated database backup guide")
                ])
                .unwrap()["unchanged"],
            2
        );
        state.sync(vec![]).unwrap();
        assert_eq!(MemoryIndex::open(&root.0).unwrap().status()["itemCount"], 0);
    }

    #[test]
    fn memory_index_corruption_is_rebuilt_or_empty_until_sync() {
        let root = Scratch::new();
        let mut state = MemoryIndex::open(&root.0).unwrap();
        let documents = vec![doc("one", "correct deployment evidence")];
        state.sync(documents.clone()).unwrap();
        fs::write(root.0.join(INDEX_FILE), b"corrupt").unwrap();
        let repaired = MemoryIndex::open(&root.0).unwrap();
        assert!(repaired
            .warnings
            .iter()
            .any(|warning| warning.contains("rebuilt")));
        assert_eq!(
            repaired
                .search("correct deployment", &ids(&["one"]), 5)
                .unwrap()[0]
                .id,
            "one"
        );
        assert!(IdMapIndex::load(root.0.join(INDEX_FILE)).is_ok());
        fs::write(root.0.join(MANIFEST_FILE), b"corrupt").unwrap();
        let mut repaired = MemoryIndex::open(&root.0).unwrap();
        assert!(repaired
            .search("correct deployment", &ids(&["one"]), 5)
            .unwrap()
            .is_empty());
        assert!(repaired.cache_dirty);
        repaired.sync(documents).unwrap();
        assert_eq!(
            repaired
                .search("correct deployment", &ids(&["one"]), 5)
                .unwrap()[0]
                .id,
            "one"
        );
    }

    #[test]
    fn memory_index_validation_does_not_change_previous_state() {
        let root = Scratch::new();
        let mut state = MemoryIndex::open(&root.0).unwrap();
        state.sync(vec![doc("one", "release guide")]).unwrap();
        let before = state.fingerprint.clone();
        assert!(state
            .sync(vec![doc("one", "new"), doc("one", "duplicate")])
            .is_err());
        assert!(state.sync(vec![doc("", "empty identifier")]).is_err());
        assert!(state
            .sync(vec![doc("large", &"x".repeat(MAX_DOCUMENT_BYTES + 1))])
            .is_err());
        assert_eq!(state.fingerprint, before);
        assert_eq!(
            state.search("release", &ids(&["one"]), 1).unwrap()[0].id,
            "one"
        );
        assert!(state
            .search(&"x".repeat(MAX_QUERY_BYTES + 1), &[], 1)
            .is_err());
        assert!(state.search("release", &ids(&["one"]), 101).is_err());
    }

    #[test]
    fn memory_index_unicode_empty_text_and_protocol_errors() {
        let root = Scratch::new();
        let mut state = MemoryIndex::open(&root.0).unwrap();
        state
            .sync(vec![
                doc("māori", "Māori 你好 release evidence"),
                doc("punctuation", "..."),
            ])
            .unwrap();
        assert_eq!(
            state
                .search("māori 你好", &ids(&["māori", "punctuation"]), 2)
                .unwrap()[0]
                .id,
            "māori"
        );
        let vector = features("Māori 你好 release evidence", 512).unwrap();
        assert!((vector.iter().map(|value| value * value).sum::<f32>() - 1.).abs() < 0.00001);
        let input = b"invalid\n{\"id\":1,\"op\":\"search\",\"query\":\"release\"}\n{\"id\":2,\"op\":\"status\"}\n";
        let mut output = Vec::new();
        serve(&mut state, &mut &input[..], &mut output).unwrap();
        let rows: Vec<Value> = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["success"], false);
        assert_eq!(rows[1]["data"]["hits"], json!([]));
        assert_eq!(rows[2]["data"]["engine"], "turbovec");
        assert_eq!(rows[2]["id"], 2);
    }

    #[test]
    fn memory_index_oversized_request_does_not_break_the_pipe() {
        let root = Scratch::new();
        let mut state = MemoryIndex::open(&root.0).unwrap();
        let mut input = vec![b'x'; MAX_REQUEST_BYTES + 1];
        input.extend_from_slice(b"\n{\"id\":\"after-large-line\",\"op\":\"status\"}\n");
        let mut output = Vec::new();
        serve(&mut state, &mut &input[..], &mut output).unwrap();
        let rows: Vec<Value> = String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["success"], false);
        assert!(rows[0]["error"].as_str().unwrap().contains("exceeds"));
        assert_eq!(rows[1]["id"], "after-large-line");
        assert_eq!(rows[1]["success"], true);
    }
}
