/**
 * Print Postgres health and query-stat summaries.
 * Run on a machine with psql and DATABASE_URL set:
 *   node scripts/postgres-report.mjs
 */

import { spawnSync } from "child_process";
import process from "process";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

function psqlUrl(url) {
  const parsed = new URL(url);
  parsed.searchParams.delete("connection_limit");
  parsed.searchParams.delete("pool_timeout");
  return parsed.toString();
}

function psql(sql) {
  const result = spawnSync(
    "psql",
    [psqlUrl(databaseUrl), "-v", "ON_ERROR_STOP=1", "-P", "pager=off"],
    { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

psql(`
select now() as checked_at;

select
  count(*) filter (where backend_type = 'client backend') as client_connections,
  count(*) filter (where backend_type = 'client backend' and state = 'active') as active_client_connections,
  count(*) filter (where backend_type = 'client backend' and state = 'idle') as idle_client_connections,
  count(*) filter (
    where backend_type = 'client backend'
      and wait_event is not null
      and wait_event_type <> 'Client'
  ) as waiting_client_connections
from pg_stat_activity;

select
  datname,
  numbackends,
  xact_commit,
  xact_rollback,
  blks_hit,
  blks_read,
  round(100 * blks_hit::numeric / nullif(blks_hit + blks_read, 0), 2) as cache_hit_percent,
  deadlocks,
  temp_files,
  pg_size_pretty(temp_bytes) as temp_bytes
from pg_stat_database
where datname = current_database();

select
  relname,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_autoanalyze
from pg_stat_user_tables
order by n_dead_tup desc, n_live_tup desc
limit 20;

select
  calls,
  round(total_exec_time::numeric, 2) as total_ms,
  round(mean_exec_time::numeric, 2) as mean_ms,
  rows,
  shared_blks_hit,
  shared_blks_read,
  left(regexp_replace(query, '\\\\s+', ' ', 'g'), 180) as query
from pg_stat_statements
where dbid = (select oid from pg_database where datname = current_database())
  and query not like '%pg_stat_statements%'
order by total_exec_time desc
limit 20;
`);
