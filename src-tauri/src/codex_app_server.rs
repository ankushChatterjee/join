use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

const CODEX_TIMEOUT_SECS: u64 = 180;
const CODEX_PATH_ENV: &str = "JOIN_CODEX_PATH";

#[derive(Debug, Error)]
pub enum CodexAppServerError {
    #[error("failed to start codex app-server: {0}")]
    Start(#[from] std::io::Error),
    #[error("codex app-server stdin was unavailable")]
    MissingStdin,
    #[error("codex app-server stdout was unavailable")]
    MissingStdout,
    #[error("codex app-server returned an error for {method}: {message}")]
    Rpc { method: String, message: String },
    #[error("codex app-server response timed out")]
    Timeout,
    #[error("codex app-server returned invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("codex did not return a valid SQL extraction payload")]
    MissingExtraction,
}

#[derive(Debug, Clone)]
pub struct CodexProgressUpdate {
    pub phase: String,
    pub text: String,
    pub append: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexDetectedParameter {
    pub name: String,
    #[serde(default)]
    pub source_expression: Option<String>,
    #[serde(default)]
    pub original_placeholder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexExtractedQuery {
    pub name: String,
    pub sql: String,
    pub parameterized_sql: String,
    pub source_path: String,
    #[serde(default)]
    pub start_line: Option<i64>,
    #[serde(default)]
    pub end_line: Option<i64>,
    #[serde(default)]
    pub framework: Option<String>,
    pub confidence: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub detected_parameters: Vec<CodexDetectedParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSqlExtraction {
    #[serde(default)]
    pub queries: Vec<CodexExtractedQuery>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexQueryLookupCandidate {
    pub name: String,
    pub source_path: String,
    pub confidence: String,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSqlQueryLookup {
    pub status: String,
    #[serde(default)]
    pub query: Option<CodexExtractedQuery>,
    #[serde(default)]
    pub matches: Vec<CodexQueryLookupCandidate>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexContextEvidence {
    pub source_path: String,
    #[serde(default)]
    pub start_line: Option<i64>,
    #[serde(default)]
    pub end_line: Option<i64>,
    pub kind: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCodebaseContext {
    pub status: String,
    pub question: String,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub evidence: Vec<CodexContextEvidence>,
    #[serde(default)]
    pub related_queries: Vec<CodexQueryLookupCandidate>,
    #[serde(default)]
    pub message: Option<String>,
}

fn next_id() -> u64 {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

fn resolve_codex_binary() -> String {
    if let Ok(path) = std::env::var(CODEX_PATH_ENV) {
        if !path.trim().is_empty() {
            eprintln!("[CODEX_APP_SERVER] using {CODEX_PATH_ENV}={path:?}");
            return path;
        }
    }

    for candidate in [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
    ] {
        if Path::new(candidate).is_file() {
            eprintln!("[CODEX_APP_SERVER] using discovered Codex binary {candidate:?}");
            return candidate.to_string();
        }
    }

    eprintln!("[CODEX_APP_SERVER] using Codex binary from PATH: \"codex\"");
    "codex".to_string()
}

fn extraction_prompt() -> String {
    r#"Find SQL queries inside this local folder.

Search for:
- .sql files
- embedded SQL strings
- raw query calls
- ORM/query-builder calls where the SQL can be confidently recovered
- migrations that contain runtime queries
- reports, scripts, notebooks, and config-driven queries

Return JSON only. Do not include markdown fences or explanatory text.
Use this exact shape:
{
  "queries": [
    {
      "name": "short stable query name",
      "sql": "original SQL as found or faithfully recovered",
      "parameterizedSql": "SQL converted to Join named parameters like :user_id",
      "sourcePath": "path relative to the folder when possible",
      "startLine": 1,
      "endLine": 10,
      "framework": "optional framework/tool name",
      "confidence": "high|medium|low",
      "notes": "optional notes for uncertain conversions",
      "detectedParameters": [
        {
          "name": "user_id",
          "sourceExpression": "optional source expression",
          "originalPlaceholder": "optional original placeholder"
        }
      ]
    }
  ]
}

Rules:
- Keep this read-only. Do not edit files.
- Prefer high-confidence queries. Include medium/low only when useful and explain uncertainty in notes.
- Preserve original query text in sql.
- Convert framework placeholders, interpolation, and positional values into Join named parameters in parameterizedSql.
- If a parameter name is unknown, choose a descriptive snake_case name.
- If no SQL queries are found, return {"queries":[]}.
"#
    .to_string()
}

fn single_query_prompt(request: &str) -> String {
    format!(
        r#"Find the single best SQL query in this local folder for the following request:

{request}

Search for:
- .sql files
- embedded SQL strings
- raw query calls
- ORM/query-builder calls where the SQL can be confidently recovered
- migrations, reports, scripts, notebooks, and config-driven queries when they are relevant

Return JSON only. Do not include markdown fences or explanatory text.

Rules:
- Keep this read-only. Do not edit files.
- If there is one clear best match, return status "match" and populate "query".
- If there are multiple plausible near-matches, return status "ambiguous", leave "query" null, and populate "matches" with 2-5 options.
- If nothing relevant is found, return status "not_found", leave "query" null, and explain briefly in "message".
- Convert framework placeholders, interpolation, and positional values into Join named parameters in parameterizedSql.
- Preserve original query text in sql.
"#
    )
}

fn codebase_context_prompt(request: &str) -> String {
    format!(
        r#"Answer this implementation-context question about SQL usage in this local folder:

{request}

Search for:
- the SQL definition itself
- callsites that build, parameterize, or execute the query
- consumers that read the results
- surrounding feature code, services, handlers, UI flows, jobs, or scripts that explain how the query is used

Return JSON only. Do not include markdown fences or explanatory text.

Rules:
- Keep this read-only. Do not edit files.
- Be concrete. Prefer specific files and line ranges over general statements.
- Use status "answered" when you found enough evidence to answer, or "not_found" when you could not.
- Keep summaries concise and evidence-backed.
- relatedQueries should list nearby SQL definitions or alternative relevant queries when helpful.
"#
    )
}

fn extraction_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "queries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "sql": { "type": "string" },
                        "parameterizedSql": { "type": "string" },
                        "sourcePath": { "type": "string" },
                        "startLine": { "type": ["integer", "null"] },
                        "endLine": { "type": ["integer", "null"] },
                        "framework": { "type": ["string", "null"] },
                        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
                        "notes": { "type": ["string", "null"] },
                        "detectedParameters": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "sourceExpression": { "type": ["string", "null"] },
                                    "originalPlaceholder": { "type": ["string", "null"] }
                                },
                                "required": ["name", "sourceExpression", "originalPlaceholder"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": [
                        "name",
                        "sql",
                        "parameterizedSql",
                        "sourcePath",
                        "startLine",
                        "endLine",
                        "framework",
                        "confidence",
                        "notes",
                        "detectedParameters"
                    ],
                    "additionalProperties": false
                }
            }
        },
        "required": ["queries"],
        "additionalProperties": false
    })
}

fn single_query_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "status": { "type": "string", "enum": ["match", "ambiguous", "not_found"] },
            "query": {
                "type": ["object", "null"],
                "properties": {
                    "name": { "type": "string" },
                    "sql": { "type": "string" },
                    "parameterizedSql": { "type": "string" },
                    "sourcePath": { "type": "string" },
                    "startLine": { "type": ["integer", "null"] },
                    "endLine": { "type": ["integer", "null"] },
                    "framework": { "type": ["string", "null"] },
                    "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
                    "notes": { "type": ["string", "null"] },
                    "detectedParameters": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string" },
                                "sourceExpression": { "type": ["string", "null"] },
                                "originalPlaceholder": { "type": ["string", "null"] }
                            },
                            "required": ["name", "sourceExpression", "originalPlaceholder"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": [
                    "name",
                    "sql",
                    "parameterizedSql",
                    "sourcePath",
                    "startLine",
                    "endLine",
                    "framework",
                    "confidence",
                    "notes",
                    "detectedParameters"
                ],
                "additionalProperties": false
            },
            "matches": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "sourcePath": { "type": "string" },
                        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
                        "notes": { "type": ["string", "null"] }
                    },
                    "required": ["name", "sourcePath", "confidence", "notes"],
                    "additionalProperties": false
                }
            },
            "message": { "type": ["string", "null"] }
        },
        "required": ["status", "query", "matches", "message"],
        "additionalProperties": false
    })
}

fn codebase_context_output_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "status": { "type": "string", "enum": ["answered", "not_found"] },
            "question": { "type": "string" },
            "summary": { "type": ["string", "null"] },
            "evidence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sourcePath": { "type": "string" },
                        "startLine": { "type": ["integer", "null"] },
                        "endLine": { "type": ["integer", "null"] },
                        "kind": {
                            "type": "string",
                            "enum": ["query_definition", "callsite", "consumer", "schema", "other"]
                        },
                        "summary": { "type": "string" }
                    },
                    "required": ["sourcePath", "startLine", "endLine", "kind", "summary"],
                    "additionalProperties": false
                }
            },
            "relatedQueries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "sourcePath": { "type": "string" },
                        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
                        "notes": { "type": ["string", "null"] }
                    },
                    "required": ["name", "sourcePath", "confidence", "notes"],
                    "additionalProperties": false
                }
            },
            "message": { "type": ["string", "null"] }
        },
        "required": ["status", "question", "summary", "evidence", "relatedQueries", "message"],
        "additionalProperties": false
    })
}

fn turn_start_request(
    request_id: u64,
    thread_id: &str,
    cwd: &str,
    prompt: String,
    output_schema: Value,
) -> Value {
    json!({
        "method": "turn/start",
        "id": request_id,
        "params": {
            "threadId": thread_id,
            "input": [{ "type": "text", "text": prompt }],
            "cwd": cwd,
            "approvalPolicy": "never",
            "sandboxPolicy": {
                "type": "readOnly",
                "access": { "type": "fullAccess" }
            },
            "effort": "medium",
            "outputSchema": output_schema
        }
    })
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&text[start..=end])
}

fn parse_extraction_from_text(text: &str) -> Result<CodexSqlExtraction, CodexAppServerError> {
    let Some(json_text) = extract_json_object(text) else {
        eprintln!(
            "[CODEX_APP_SERVER] extraction parse failed: no JSON object in agent text:\n{text}"
        );
        return Err(CodexAppServerError::MissingExtraction);
    };
    let extraction: CodexSqlExtraction = match serde_json::from_str(json_text) {
        Ok(extraction) => extraction,
        Err(error) => {
            eprintln!(
                "[CODEX_APP_SERVER] extraction JSON parse failed: {error}\nraw json candidate:\n{json_text}\nraw agent text:\n{text}"
            );
            return Err(CodexAppServerError::Json(error));
        }
    };
    Ok(extraction)
}

async fn write_message(
    stdin: &mut tokio::process::ChildStdin,
    message: Value,
) -> Result<(), CodexAppServerError> {
    stdin.write_all(message.to_string().as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

fn response_error(method: &str, message: &Value) -> Option<CodexAppServerError> {
    let error = message.get("error")?;
    eprintln!("[CODEX_APP_SERVER] RPC error for {method}: {error}");
    let text = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown codex app-server error")
        .to_string();
    Some(CodexAppServerError::Rpc {
        method: method.to_string(),
        message: text,
    })
}

fn append_agent_message_text(message: &Value, agent_text: &mut String) {
    let item_type = message.pointer("/params/item/type").and_then(Value::as_str);
    if item_type != Some("agentMessage") {
        return;
    }

    if let Some(text) = message.pointer("/params/item/text").and_then(Value::as_str) {
        if !text.is_empty() && !agent_text.contains(text) {
            if !agent_text.is_empty() {
                agent_text.push('\n');
            }
            agent_text.push_str(text);
        }
    }
}

fn latest_json_string_field(text: &str, field: &str) -> Option<String> {
    let pattern = format!("\"{field}\":\"");
    let start = text.rfind(&pattern)? + pattern.len();
    let rest = &text[start..];
    let mut value = String::new();
    let mut escaped = false;

    for ch in rest.chars() {
        if escaped {
            value.push(match ch {
                'n' => '\n',
                't' => '\t',
                'r' => '\r',
                '"' => '"',
                '\\' => '\\',
                other => other,
            });
            escaped = false;
            continue;
        }

        match ch {
            '\\' => escaped = true,
            '"' => break,
            other => value.push(other),
        }
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn build_stream_activity(agent_text: &str) -> Option<String> {
    let source_path = latest_json_string_field(agent_text, "sourcePath");
    let query_name = latest_json_string_field(agent_text, "name");
    let status = latest_json_string_field(agent_text, "status");

    if let Some(path) = source_path {
        if let Some(name) = query_name {
            return Some(format!("Reviewing {name} in {path}"));
        }
        return Some(format!("Reviewing {path}"));
    }

    if let Some(name) = query_name {
        return Some(format!("Found candidate query: {name}"));
    }

    match status.as_deref() {
        Some("ambiguous") => Some("Comparing multiple matching queries".to_string()),
        Some("not_found") => Some("Wrapping up search results".to_string()),
        Some("match") => Some("Preparing the best match".to_string()),
        _ => None,
    }
}

pub async fn extract_sql_queries(
    cwd: &str,
    existing_thread_id: Option<&str>,
    on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<(Option<String>, CodexSqlExtraction), CodexAppServerError> {
    let result = run_codex_turn(
        cwd,
        existing_thread_id,
        extraction_prompt(),
        extraction_output_schema(),
        on_progress,
    )
    .await?;
    let extraction = parse_extraction_from_text(&result.agent_text)?;
    eprintln!(
        "[CODEX_APP_SERVER] extraction parsed query_count={}, thread_id={:?}",
        extraction.queries.len(),
        result.thread_id
    );
    Ok((result.thread_id, extraction))
}

pub async fn find_sql_query(
    cwd: &str,
    existing_thread_id: Option<&str>,
    on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<(Option<String>, CodexSqlQueryLookup), CodexAppServerError> {
    find_sql_query_with_request(cwd, existing_thread_id, "", on_progress).await
}

pub async fn find_sql_query_with_request(
    cwd: &str,
    existing_thread_id: Option<&str>,
    request: &str,
    on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<(Option<String>, CodexSqlQueryLookup), CodexAppServerError> {
    let result = run_codex_turn(
        cwd,
        existing_thread_id,
        single_query_prompt(request),
        single_query_output_schema(),
        on_progress,
    )
    .await?;
    let Some(json_text) = extract_json_object(&result.agent_text) else {
        eprintln!(
            "[CODEX_APP_SERVER] single query parse failed: no JSON object in agent text:\n{}",
            result.agent_text
        );
        return Err(CodexAppServerError::MissingExtraction);
    };
    let lookup: CodexSqlQueryLookup = serde_json::from_str(json_text)?;
    Ok((result.thread_id, lookup))
}

pub async fn ask_codebase_context(
    cwd: &str,
    existing_thread_id: Option<&str>,
    request: &str,
    on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<(Option<String>, CodexCodebaseContext), CodexAppServerError> {
    let result = run_codex_turn(
        cwd,
        existing_thread_id,
        codebase_context_prompt(request),
        codebase_context_output_schema(),
        on_progress,
    )
    .await?;
    let Some(json_text) = extract_json_object(&result.agent_text) else {
        eprintln!(
            "[CODEX_APP_SERVER] codebase context parse failed: no JSON object in agent text:\n{}",
            result.agent_text
        );
        return Err(CodexAppServerError::MissingExtraction);
    };
    let context: CodexCodebaseContext = serde_json::from_str(json_text)?;
    Ok((result.thread_id, context))
}

struct CodexTurnResult {
    thread_id: Option<String>,
    agent_text: String,
}

async fn run_codex_turn(
    cwd: &str,
    existing_thread_id: Option<&str>,
    prompt: String,
    output_schema: Value,
    on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<CodexTurnResult, CodexAppServerError> {
    match timeout(
        Duration::from_secs(CODEX_TIMEOUT_SECS),
        run_codex_turn_inner(cwd, existing_thread_id, prompt, output_schema, on_progress),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            eprintln!(
                "[CODEX_APP_SERVER] Codex turn timed out after {CODEX_TIMEOUT_SECS}s for cwd={cwd:?}, existing_thread_id={:?}",
                existing_thread_id
            );
            Err(CodexAppServerError::Timeout)
        }
    }
}

async fn run_codex_turn_inner(
    cwd: &str,
    existing_thread_id: Option<&str>,
    prompt: String,
    output_schema: Value,
    mut on_progress: impl FnMut(CodexProgressUpdate),
) -> Result<CodexTurnResult, CodexAppServerError> {
    eprintln!(
        "[CODEX_APP_SERVER] starting Codex turn cwd={cwd:?}, existing_thread_id={:?}",
        existing_thread_id
    );
    on_progress(CodexProgressUpdate {
        phase: "starting".to_string(),
        text: format!("Scanning {cwd}"),
        append: false,
    });
    let codex_binary = resolve_codex_binary();
    let mut child = Command::new(&codex_binary)
        .arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            eprintln!(
                "[CODEX_APP_SERVER] failed to spawn Codex app-server binary={codex_binary:?}: {error}"
            );
            error
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or(CodexAppServerError::MissingStdin)?;
    let stdout = child
        .stdout
        .take()
        .ok_or(CodexAppServerError::MissingStdout)?;
    let mut lines = BufReader::new(stdout).lines();
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut stderr_lines = BufReader::new(stderr).lines();
            loop {
                match stderr_lines.next_line().await {
                    Ok(Some(line)) => eprintln!("[CODEX_APP_SERVER][stderr] {line}"),
                    Ok(None) => break,
                    Err(error) => {
                        eprintln!("[CODEX_APP_SERVER][stderr] failed to read stderr: {error}");
                        break;
                    }
                }
            }
        });
    }

    let init_id = next_id();
    eprintln!("[CODEX_APP_SERVER] -> initialize id={init_id}");
    on_progress(CodexProgressUpdate {
        phase: "initializing".to_string(),
        text: "Connecting to Codex app-server".to_string(),
        append: false,
    });
    write_message(
        &mut stdin,
        json!({
            "method": "initialize",
            "id": init_id,
            "params": {
                "clientInfo": {
                    "name": "join",
                    "title": "Join",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )
    .await?;
    eprintln!("[CODEX_APP_SERVER] -> initialized notification");
    write_message(&mut stdin, json!({ "method": "initialized", "params": {} })).await?;

    let thread_method = if existing_thread_id.is_some() {
        "thread/resume"
    } else {
        "thread/start"
    };
    let thread_id_request = next_id();
    let thread_params = if let Some(thread_id) = existing_thread_id {
        json!({
            "threadId": thread_id,
            "cwd": cwd,
            "sandbox": "read-only",
            "approvalPolicy": "never",
            "serviceName": "join"
        })
    } else {
        json!({
            "cwd": cwd,
            "sandbox": "read-only",
            "approvalPolicy": "never",
            "serviceName": "join"
        })
    };

    let mut thread_id: Option<String> = None;
    let mut turn_id: Option<String> = None;
    let mut agent_text = String::new();
    let mut stream_buffer = String::new();
    let mut last_activity: Option<String> = None;
    let mut initialized = false;
    let mut thread_started = false;

    eprintln!(
        "[CODEX_APP_SERVER] -> {thread_method} id={thread_id_request}, cwd={cwd:?}"
    );
    on_progress(CodexProgressUpdate {
        phase: "thread".to_string(),
        text: "Preparing folder context".to_string(),
        append: false,
    });
    write_message(
        &mut stdin,
        json!({
            "method": thread_method,
            "id": thread_id_request,
            "params": thread_params
        }),
    )
    .await?;

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        eprintln!("[CODEX_APP_SERVER] <- {line}");
        let message: Value = match serde_json::from_str(&line) {
            Ok(message) => message,
            Err(error) => {
                eprintln!(
                    "[CODEX_APP_SERVER] failed to parse JSON-RPC line: {error}\nraw line:\n{line}"
                );
                let _ = child.kill().await;
                return Err(CodexAppServerError::Json(error));
            }
        };

        if message.get("id").and_then(Value::as_u64) == Some(init_id) {
            if let Some(err) = response_error("initialize", &message) {
                let _ = child.kill().await;
                return Err(err);
            }
            initialized = true;
            on_progress(CodexProgressUpdate {
                phase: "initialized".to_string(),
                text: "Codex ready".to_string(),
                append: false,
            });
            if !thread_started {
                if let Some(thread_id_value) = thread_id.clone() {
                    let turn_request_id = next_id();
                    eprintln!(
                        "[CODEX_APP_SERVER] -> turn/start id={turn_request_id}, thread_id={thread_id_value}"
                    );
                    on_progress(CodexProgressUpdate {
                        phase: "turn".to_string(),
                        text: "Searching for matching SQL".to_string(),
                        append: false,
                    });
                    write_message(
                        &mut stdin,
                        turn_start_request(
                            turn_request_id,
                            &thread_id_value,
                            cwd,
                            prompt.clone(),
                            output_schema.clone(),
                        ),
                    )
                    .await?;
                    thread_started = true;
                }
            }
            continue;
        }

        if message.get("id").and_then(Value::as_u64) == Some(thread_id_request) {
            if let Some(err) = response_error(thread_method, &message) {
                let _ = child.kill().await;
                return Err(err);
            }
            thread_id = message
                .pointer("/result/thread/id")
                .and_then(Value::as_str)
                .map(ToString::to_string);
            eprintln!(
                "[CODEX_APP_SERVER] thread response method={thread_method}, thread_id={:?}",
                thread_id
            );
            on_progress(CodexProgressUpdate {
                phase: "thread_ready".to_string(),
                text: "Folder context attached".to_string(),
                append: false,
            });
            if initialized && !thread_started {
                let Some(thread_id_value) = thread_id.clone() else {
                    eprintln!(
                        "[CODEX_APP_SERVER] {thread_method} response did not include result.thread.id: {message}"
                    );
                    let _ = child.kill().await;
                    return Err(CodexAppServerError::MissingExtraction);
                };
                let turn_request_id = next_id();
                eprintln!(
                    "[CODEX_APP_SERVER] -> turn/start id={turn_request_id}, thread_id={thread_id_value}"
                );
                on_progress(CodexProgressUpdate {
                    phase: "turn".to_string(),
                    text: "Searching for matching SQL".to_string(),
                    append: false,
                });
                write_message(
                    &mut stdin,
                    turn_start_request(
                        turn_request_id,
                        &thread_id_value,
                        cwd,
                        prompt.clone(),
                        output_schema.clone(),
                    ),
                )
                .await?;
                thread_started = true;
            }
            continue;
        }

        let method = message.get("method").and_then(Value::as_str);
        match method {
            Some("turn/started") => {
                turn_id = message
                    .pointer("/params/turn/id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string);
                eprintln!("[CODEX_APP_SERVER] turn started turn_id={turn_id:?}");
                on_progress(CodexProgressUpdate {
                    phase: "streaming".to_string(),
                    text: String::new(),
                    append: false,
                });
            }
            Some("item/agentMessage/delta") => {
                if let Some(delta) = message.pointer("/params/delta").and_then(Value::as_str) {
                    agent_text.push_str(delta);
                    stream_buffer.push_str(delta);
                } else if let Some(delta) = message.pointer("/params/text").and_then(Value::as_str)
                {
                    agent_text.push_str(delta);
                    stream_buffer.push_str(delta);
                }

                if stream_buffer.len() >= 96 || stream_buffer.contains('\n') {
                    if let Some(activity) = build_stream_activity(&agent_text) {
                        if last_activity.as_deref() != Some(activity.as_str()) {
                            on_progress(CodexProgressUpdate {
                                phase: "streaming".to_string(),
                                text: activity.clone(),
                                append: true,
                            });
                            last_activity = Some(activity);
                        }
                    } else if last_activity.is_none() {
                        on_progress(CodexProgressUpdate {
                            phase: "streaming".to_string(),
                            text: "Scanning files for SQL candidates".to_string(),
                            append: true,
                        });
                        last_activity = Some("Scanning files for SQL candidates".to_string());
                    }
                    stream_buffer.clear();
                }
            }
            Some("item/completed") => {
                append_agent_message_text(&message, &mut agent_text);
            }
            Some("turn/completed") => {
                let status = message
                    .pointer("/params/turn/status")
                    .and_then(Value::as_str);
                eprintln!(
                    "[CODEX_APP_SERVER] turn completed status={status:?}, accumulated_agent_text_len={}",
                    agent_text.len()
                );
                if !stream_buffer.is_empty() {
                    if let Some(activity) = build_stream_activity(&agent_text) {
                        if last_activity.as_deref() != Some(activity.as_str()) {
                            on_progress(CodexProgressUpdate {
                                phase: "streaming".to_string(),
                                text: activity.clone(),
                                append: true,
                            });
                        }
                    }
                    stream_buffer.clear();
                }
                if status == Some("failed") {
                    let details = message
                        .pointer("/params/turn/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("turn failed");
                    eprintln!(
                        "[CODEX_APP_SERVER] turn failed details={details}, full_message={message}"
                    );
                    let _ = child.kill().await;
                    return Err(CodexAppServerError::Rpc {
                        method: "turn/start".to_string(),
                        message: details.to_string(),
                    });
                }
                on_progress(CodexProgressUpdate {
                    phase: "completed".to_string(),
                    text: "Finished preparing results".to_string(),
                    append: true,
                });
                let _ = child.kill().await;
                return Ok(CodexTurnResult { thread_id, agent_text });
            }
            _ => {
                if !thread_started && initialized && thread_id.is_some() {
                    continue;
                }
            }
        }
    }

    let _ = child.kill().await;
    eprintln!(
        "[CODEX_APP_SERVER] app-server stream ended before extraction completed; initialized={initialized}, thread_started={thread_started}, thread_id={thread_id:?}, turn_id={turn_id:?}, accumulated_agent_text:\n{agent_text}"
    );
    Err(CodexAppServerError::MissingExtraction)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_payload_from_wrapped_text() {
        let parsed = parse_extraction_from_text(
            "Here:\n{\"queries\":[{\"name\":\"Q\",\"sql\":\"select 1\",\"parameterizedSql\":\"select 1\",\"sourcePath\":\"a.sql\",\"confidence\":\"high\"}]}",
        )
        .expect("parse");
        assert_eq!(parsed.queries.len(), 1);
        assert_eq!(parsed.queries[0].parameterized_sql, "select 1");
    }

    #[test]
    fn rejects_text_without_json() {
        assert!(parse_extraction_from_text("no queries").is_err());
    }

    #[test]
    fn parses_single_query_lookup_payload() {
        let lookup: CodexSqlQueryLookup = serde_json::from_str(
            r#"{
              "status":"ambiguous",
              "query":null,
              "matches":[{"name":"signup","sourcePath":"queries/signup.sql","confidence":"high","notes":null}],
              "message":"Found more than one plausible query"
            }"#,
        )
        .expect("lookup parse");
        assert_eq!(lookup.status, "ambiguous");
        assert_eq!(lookup.matches.len(), 1);
    }

    #[test]
    fn parses_codebase_context_payload() {
        let context: CodexCodebaseContext = serde_json::from_str(
            r#"{
              "status":"answered",
              "question":"How is signup used?",
              "summary":"The auth flow builds and executes the signup query.",
              "evidence":[
                {
                  "sourcePath":"src/auth/signup.ts",
                  "startLine":12,
                  "endLine":24,
                  "kind":"callsite",
                  "summary":"Builds the SQL and sends it to the DB layer."
                }
              ],
              "relatedQueries":[
                {
                  "name":"signup",
                  "sourcePath":"queries/signup.sql",
                  "confidence":"high",
                  "notes":null
                }
              ],
              "message":null
            }"#,
        )
        .expect("context parse");
        assert_eq!(context.status, "answered");
        assert_eq!(context.evidence.len(), 1);
        assert_eq!(context.related_queries.len(), 1);
    }
}
