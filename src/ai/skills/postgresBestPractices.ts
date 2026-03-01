// ============================================================================
// Postgres Best Practices Skill - Rule Registry
// ============================================================================
//
// This module provides on-demand access to Supabase Postgres best practices.
// Rules are loaded via Vite's ?raw imports and fetched by the agent
// via the get_postgres_best_practice tool when needed.

// Query Performance (CRITICAL/HIGH)
import queryMissingIndexes from './supabase-postgres-best-practices/references/query-missing-indexes.md?raw';
import queryCompositeIndexes from './supabase-postgres-best-practices/references/query-composite-indexes.md?raw';
import queryCoveringIndexes from './supabase-postgres-best-practices/references/query-covering-indexes.md?raw';
import queryIndexTypes from './supabase-postgres-best-practices/references/query-index-types.md?raw';
import queryPartialIndexes from './supabase-postgres-best-practices/references/query-partial-indexes.md?raw';

// Data Access Patterns (MEDIUM-HIGH/MEDIUM)
import dataNPlusOne from './supabase-postgres-best-practices/references/data-n-plus-one.md?raw';
import dataBatchInserts from './supabase-postgres-best-practices/references/data-batch-inserts.md?raw';
import dataPagination from './supabase-postgres-best-practices/references/data-pagination.md?raw';

// Schema Design (HIGH)
import schemaForeignKeyIndexes from './supabase-postgres-best-practices/references/schema-foreign-key-indexes.md?raw';
import schemaPartitioning from './supabase-postgres-best-practices/references/schema-partitioning.md?raw';
import schemaPrimaryKeys from './supabase-postgres-best-practices/references/schema-primary-keys.md?raw';
import schemaConstraints from './supabase-postgres-best-practices/references/schema-constraints.md?raw';

// Security & RLS (CRITICAL/HIGH)
import securityRlsBasics from './supabase-postgres-best-practices/references/security-rls-basics.md?raw';
import securityRlsPerformance from './supabase-postgres-best-practices/references/security-rls-performance.md?raw';
import securityPrivileges from './supabase-postgres-best-practices/references/security-privileges.md?raw';

// Connection Management (CRITICAL)
import connPooling from './supabase-postgres-best-practices/references/conn-pooling.md?raw';
import connLimits from './supabase-postgres-best-practices/references/conn-limits.md?raw';

// Concurrency & Locking (MEDIUM-HIGH)
import lockDeadlockPrevention from './supabase-postgres-best-practices/references/lock-deadlock-prevention.md?raw';
import lockShortTransactions from './supabase-postgres-best-practices/references/lock-short-transactions.md?raw';

// Monitoring (LOW-MEDIUM)
import monitorExplainAnalyze from './supabase-postgres-best-practices/references/monitor-explain-analyze.md?raw';

// Advanced (LOW/MEDIUM)
import advancedJsonbIndexing from './supabase-postgres-best-practices/references/advanced-jsonb-indexing.md?raw';

// Rule registry mapping rule_id to markdown content
const ruleRegistry: Record<string, string> = {
  // Query Performance
  'query-missing-indexes': queryMissingIndexes,
  'query-composite-indexes': queryCompositeIndexes,
  'query-covering-indexes': queryCoveringIndexes,
  'query-index-types': queryIndexTypes,
  'query-partial-indexes': queryPartialIndexes,

  // Data Access Patterns
  'data-n-plus-one': dataNPlusOne,
  'data-batch-inserts': dataBatchInserts,
  'data-pagination': dataPagination,

  // Schema Design
  'schema-foreign-key-indexes': schemaForeignKeyIndexes,
  'schema-partitioning': schemaPartitioning,
  'schema-primary-keys': schemaPrimaryKeys,
  'schema-constraints': schemaConstraints,

  // Security & RLS
  'security-rls-basics': securityRlsBasics,
  'security-rls-performance': securityRlsPerformance,
  'security-privileges': securityPrivileges,

  // Connection Management
  'conn-pooling': connPooling,
  'conn-limits': connLimits,

  // Concurrency & Locking
  'lock-deadlock-prevention': lockDeadlockPrevention,
  'lock-short-transactions': lockShortTransactions,

  // Monitoring
  'monitor-explain-analyze': monitorExplainAnalyze,

  // Advanced
  'advanced-jsonb-indexing': advancedJsonbIndexing,
};

// One-line descriptions for the catalog
const ruleDescriptions: Record<string, string> = {
  'query-missing-indexes': 'Add indexes on WHERE/JOIN columns; avoids full table scans (CRITICAL)',
  'query-composite-indexes': 'Create composite indexes for multi-column queries (HIGH)',
  'query-covering-indexes': 'Use covering indexes to avoid table lookups (MEDIUM-HIGH)',
  'query-index-types': 'Choose the right index type (B-tree, GIN, GiST, BRIN) (HIGH)',
  'query-partial-indexes': 'Use partial indexes for filtered subsets (HIGH)',
  'data-n-plus-one': 'Eliminate N+1 queries with batch loading (MEDIUM-HIGH)',
  'data-batch-inserts': 'Batch INSERT statements for bulk data loading (MEDIUM)',
  'data-pagination': 'Use cursor-based pagination instead of OFFSET (MEDIUM-HIGH)',
  'schema-foreign-key-indexes': 'Index foreign key columns for fast JOINs (HIGH)',
  'schema-partitioning': 'Partition large tables for better performance (MEDIUM-HIGH)',
  'schema-primary-keys': 'Select optimal primary key strategy (HIGH)',
  'schema-constraints': 'Add constraints safely in migrations (HIGH)',
  'security-rls-basics': 'Enable Row Level Security for multi-tenant data (CRITICAL)',
  'security-rls-performance': 'Optimize RLS policies for performance (HIGH)',
  'security-privileges': 'Apply principle of least privilege (MEDIUM)',
  'conn-pooling': 'Use connection pooling for all applications (CRITICAL)',
  'conn-limits': 'Set appropriate connection limits (CRITICAL)',
  'lock-deadlock-prevention': 'Prevent deadlocks with consistent lock ordering (MEDIUM-HIGH)',
  'lock-short-transactions': 'Keep transactions short to reduce lock contention (MEDIUM-HIGH)',
  'monitor-explain-analyze': 'Use EXPLAIN ANALYZE to diagnose slow queries (LOW-MEDIUM)',
  'advanced-jsonb-indexing': 'Index JSONB columns for efficient querying (MEDIUM)',
};

/**
 * Get the full content of a specific rule by ID.
 * Returns null if the rule_id is not found.
 */
export function getRule(ruleId: string): string | null {
  return ruleRegistry[ruleId] ?? null;
}

/**
 * Get a list of all available rule IDs.
 */
export function listRuleIds(): string[] {
  return Object.keys(ruleRegistry);
}

/**
 * Get a compact catalog of all rules for the system prompt.
 * Returns a formatted table with rule_id and description.
 */
export function getCatalog(): string {
  const entries = Object.entries(ruleDescriptions);
  const lines = entries.map(([id, desc]) => `| ${id} | ${desc} |`);
  
  return [
    '## Postgres Best Practices (Supabase)',
    '',
    'Call `get_postgres_best_practice(rule_id)` to fetch detailed optimization rules.',
    'Use when explain_sql shows seq scans, user asks about indexes/RLS/schema, or you need optimization guidance.',
    '',
    '| rule_id | description |',
    '|---------|-------------|',
    ...lines,
    '',
    'Key triggers:',
    '- Sequential scan warning → query-missing-indexes',
    '- User asks about security/RLS → security-rls-basics',
    '- Schema design questions → schema-foreign-key-indexes, schema-partitioning',
    '- N+1 pattern detected → data-n-plus-one',
  ].join('\n');
}

/**
 * Get all rules for a specific category prefix.
 */
export function getRulesByCategory(prefix: string): Array<{ id: string; content: string }> {
  return Object.entries(ruleRegistry)
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, content]) => ({ id, content }));
}
