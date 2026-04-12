// ============================================
// Database Schema & Migrations
// ============================================

import db from './connection.js';

/** Rebuild `tickets` without FKs to users — stale JWTs after re-seed used to cause SQLITE_CONSTRAINT on claim/approve. */
function relaxTicketsUserForeignKeysIfNeeded(): void {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tickets'`).get() as
        | { sql?: string }
        | undefined;
    const sql = row?.sql ?? '';
    if (!sql.includes('FOREIGN KEY') || !sql.includes('claimed_by')) {
        return;
    }

    console.log('🔄 Migrating tickets: removing user FKs on claimed_by/approved_by...');

    const previewsRows = db.prepare('SELECT * FROM previews').all() as Record<string, unknown>[];

    const prevFk = Number(db.pragma('foreign_keys', { simple: true })) === 1;
    db.pragma('foreign_keys = OFF');
    try {
        db.exec('BEGIN');
        db.exec('DROP TABLE IF EXISTS previews');
        db.exec(`
      CREATE TABLE tickets__mig (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        component TEXT NOT NULL,
        priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'REVIEW_PENDING', 'APPROVED_FOR_PROD', 'CLOSED', 'REOPENED')),
        user_context TEXT DEFAULT '{}',
        diff TEXT,
        files_modified TEXT DEFAULT '[]',
        sandbox_preview_url TEXT,
        test_results TEXT,
        claimed_by TEXT,
        approved_by TEXT,
        approval_note TEXT,
        rejection_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
        db.exec(`
      INSERT INTO tickets__mig
      SELECT id, title, description, component, priority, status, user_context, diff, files_modified,
             sandbox_preview_url, test_results, claimed_by, approved_by, approval_note, rejection_reason,
             created_at, updated_at
      FROM tickets
    `);
        db.exec('DROP TABLE tickets');
        db.exec('ALTER TABLE tickets__mig RENAME TO tickets');
        db.exec(`
      CREATE TABLE previews (
        id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        preview_url TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (ticket_id) REFERENCES tickets(id)
      )
    `);
        const ins = db.prepare(`
      INSERT INTO previews (id, ticket_id, preview_url, expires_at, created_at)
      VALUES (@id, @ticket_id, @preview_url, @expires_at, @created_at)
    `);
        for (const r of previewsRows) {
            ins.run(r);
        }
        db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
      CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
      CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
      CREATE INDEX IF NOT EXISTS idx_previews_ticket ON previews(ticket_id);
    `);
        db.exec('COMMIT');
    } catch (e) {
        try {
            db.exec('ROLLBACK');
        } catch {
            /* ignore */
        }
        throw e;
    } finally {
        db.pragma(prevFk ? 'foreign_keys = ON' : 'foreign_keys = OFF');
    }

    console.log('✅ tickets: user FKs relaxed (re-seed / stale token safe)');
}

export function runMigrations(): void {
    console.log('🔄 Running database migrations...');

    // Create users table
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('voice_agent', 'fix_agent', 'admin')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    // Create tickets table
    db.exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      component TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'REVIEW_PENDING', 'APPROVED_FOR_PROD', 'CLOSED', 'REOPENED')),
      user_context TEXT DEFAULT '{}',
      diff TEXT,
      files_modified TEXT DEFAULT '[]',
      sandbox_preview_url TEXT,
      test_results TEXT,
      claimed_by TEXT,
      approved_by TEXT,
      approval_note TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    // Create audit_logs table
    db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

    // Create previews table
    db.exec(`
    CREATE TABLE IF NOT EXISTS previews (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      preview_url TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);

    // Create indexes for common queries
    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
    CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets(priority);
    CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_previews_ticket ON previews(ticket_id);
  `);

<<<<<<< HEAD
    relaxTicketsUserForeignKeysIfNeeded();
=======
    // ============================================
    // Zone 3: Diagnosis Tables & Columns
    // ============================================

    // Create sandbox_sessions table
    db.exec(`
    CREATE TABLE IF NOT EXISTS sandbox_sessions (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL,
      container_id TEXT,
      jit_token TEXT NOT NULL,
      jit_expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'ready', 'analyzing', 'terminated')),
      logs TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      terminated_at TEXT,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id)
    )
  `);

    db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sandbox_ticket ON sandbox_sessions(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_sandbox_status ON sandbox_sessions(status);
  `);

    // Add Zone 3 columns to tickets (safe to call multiple times)
    const ticketColumns = [
        { name: 'diagnosis_status', type: 'TEXT DEFAULT NULL' },
        { name: 'rca_report', type: 'TEXT DEFAULT NULL' },
        { name: 'patient_zero_file', type: 'TEXT DEFAULT NULL' },
        { name: 'patient_zero_line', type: 'INTEGER DEFAULT NULL' },
    ];

    for (const col of ticketColumns) {
        try {
            db.exec(`ALTER TABLE tickets ADD COLUMN ${col.name} ${col.type}`);
        } catch {
            // Column already exists — safe to ignore
        }
    }
>>>>>>> e91fdf8afb1163580bb017e74401126d82bece29

    console.log('✅ Database migrations completed');
}

// Run migrations if this file is executed directly
if (process.argv[1]?.includes('migrate')) {
    runMigrations();
}
