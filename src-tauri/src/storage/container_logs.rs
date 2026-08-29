use super::{Storage, StorageError};
use rusqlite::{params, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};

const MAX_QUERY_LIMIT: usize = 500;
const RETENTION_BATCH_SIZE: i64 = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLogWrite {
    pub container_id: Option<String>,
    pub container_name: String,
    pub cube_id: Option<String>,
    pub cube_name: Option<String>,
    pub source_ts: Option<i64>,
    pub captured_ts: i64,
    pub stream: String,
    pub text: String,
    pub dedupe_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLogRecord {
    pub id: i64,
    pub container_id: Option<String>,
    pub container_name: String,
    pub cube_id: Option<String>,
    pub cube_name: Option<String>,
    pub source_ts: Option<i64>,
    pub captured_ts: i64,
    pub stream: String,
    pub text: String,
    pub payload_bytes: i64,
    pub dedupe_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLogQuery {
    pub container_name: Option<String>,
    pub cube_id: Option<String>,
    pub search: Option<String>,
    pub from_ts: Option<i64>,
    pub to_ts: Option<i64>,
    pub limit: usize,
    pub before_id: Option<i64>,
}

impl Default for ContainerLogQuery {
    fn default() -> Self {
        Self {
            container_name: None,
            cube_id: None,
            search: None,
            from_ts: None,
            to_ts: None,
            limit: 200,
            before_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerLogTarget {
    pub container_id: Option<String>,
    pub container_name: String,
    pub cube_id: Option<String>,
    pub cube_name: Option<String>,
    pub last_captured_ts: i64,
}

impl Storage {
    pub fn append_container_logs(&self, rows: &[ContainerLogWrite]) -> Result<usize, StorageError> {
        if rows.is_empty() {
            return Ok(0);
        }

        self.with_connection(|conn| {
            let tx = conn.transaction()?;
            let inserted = {
                let mut statement = tx.prepare_cached(
                    "INSERT OR IGNORE INTO container_log_lines(\
                        container_id,container_name,cube_id,cube_name,source_ts,captured_ts,stream,text,payload_bytes,dedupe_key\
                    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                )?;
                let mut inserted = 0_usize;
                for row in rows {
                    inserted += statement.execute(params![
                        row.container_id,
                        row.container_name,
                        row.cube_id,
                        row.cube_name,
                        row.source_ts,
                        row.captured_ts,
                        row.stream,
                        row.text,
                        row.text.as_bytes().len() as i64,
                        row.dedupe_key,
                    ])?;
                }
                inserted
            };
            tx.commit()?;
            Ok(inserted)
        })
    }

    pub fn query_container_logs(&self, query: &ContainerLogQuery) -> Result<Vec<ContainerLogRecord>, StorageError> {
        self.with_connection(|conn| {
            let mut sql = String::from(
                "SELECT id,container_id,container_name,cube_id,cube_name,source_ts,captured_ts,stream,text,payload_bytes,dedupe_key \
                 FROM container_log_lines WHERE 1=1",
            );
            let mut values = Vec::<Value>::new();

            if let Some(container_name) = query.container_name.as_ref() {
                sql.push_str(" AND container_name = ?");
                values.push(Value::Text(container_name.clone()));
            }
            if let Some(cube_id) = query.cube_id.as_ref() {
                sql.push_str(" AND cube_id = ?");
                values.push(Value::Text(cube_id.clone()));
            }
            if let Some(search) = query.search.as_ref() {
                sql.push_str(" AND text LIKE ?");
                values.push(Value::Text(format!("%{search}%")));
            }
            if let Some(from_ts) = query.from_ts {
                sql.push_str(" AND captured_ts >= ?");
                values.push(Value::Integer(from_ts));
            }
            if let Some(to_ts) = query.to_ts {
                sql.push_str(" AND captured_ts <= ?");
                values.push(Value::Integer(to_ts));
            }
            if let Some(before_id) = query.before_id {
                sql.push_str(" AND id < ?");
                values.push(Value::Integer(before_id));
            }

            sql.push_str(" ORDER BY id DESC LIMIT ?");
            values.push(Value::Integer(query.limit.clamp(1, MAX_QUERY_LIMIT) as i64));

            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map(params_from_iter(values.iter()), |row| {
                Ok(ContainerLogRecord {
                    id: row.get(0)?,
                    container_id: row.get(1)?,
                    container_name: row.get(2)?,
                    cube_id: row.get(3)?,
                    cube_name: row.get(4)?,
                    source_ts: row.get(5)?,
                    captured_ts: row.get(6)?,
                    stream: row.get(7)?,
                    text: row.get(8)?,
                    payload_bytes: row.get(9)?,
                    dedupe_key: row.get(10)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn list_log_targets(&self) -> Result<Vec<ContainerLogTarget>, StorageError> {
        self.with_connection(|conn| {
            let mut statement = conn.prepare(
                "SELECT container_id,container_name,cube_id,cube_name,MAX(captured_ts) AS last_captured_ts \
                 FROM container_log_lines \
                 GROUP BY container_id,container_name,cube_id,cube_name \
                 ORDER BY last_captured_ts DESC, container_name ASC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(ContainerLogTarget {
                    container_id: row.get(0)?,
                    container_name: row.get(1)?,
                    cube_id: row.get(2)?,
                    cube_name: row.get(3)?,
                    last_captured_ts: row.get(4)?,
                })
            })?;
            rows.collect()
        })
    }

    pub fn clear_container_logs(&self) -> Result<usize, StorageError> {
        self.with_connection(|conn| conn.execute("DELETE FROM container_log_lines", []))
    }

    pub fn enforce_log_retention(
        &self,
        now_ms: i64,
        max_age_days: i64,
        max_payload_bytes: i64,
    ) -> Result<usize, StorageError> {
        self.with_connection(|conn| {
            let tx = conn.transaction()?;
            let age_ms = max_age_days.max(0).saturating_mul(86_400_000);
            let cutoff = now_ms.saturating_sub(age_ms);
            let mut deleted = tx.execute(
                "DELETE FROM container_log_lines WHERE captured_ts < ?1",
                params![cutoff],
            )?;
            let budget = max_payload_bytes.max(0);

            loop {
                let total: i64 = tx.query_row(
                    "SELECT COALESCE(SUM(payload_bytes), 0) FROM container_log_lines",
                    [],
                    |row| row.get(0),
                )?;
                if total <= budget {
                    break;
                }

                let excess = total - budget;
                let last_id = {
                    let mut statement = tx.prepare(
                        "SELECT id,payload_bytes FROM container_log_lines ORDER BY id ASC LIMIT ?1",
                    )?;
                    let mut rows = statement.query(params![RETENTION_BATCH_SIZE])?;
                    let mut removed_payload = 0_i64;
                    let mut last_id = None;
                    while let Some(row) = rows.next()? {
                        last_id = Some(row.get::<_, i64>(0)?);
                        removed_payload = removed_payload.saturating_add(row.get::<_, i64>(1)?);
                        if removed_payload >= excess {
                            break;
                        }
                    }
                    last_id
                };

                let Some(last_id) = last_id else { break };
                deleted += tx.execute(
                    "DELETE FROM container_log_lines WHERE id <= ?1",
                    params![last_id],
                )?;
            }

            tx.commit()?;
            Ok(deleted)
        })
    }
}
