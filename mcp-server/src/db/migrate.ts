// ============================================
// Database Schema & Migrations
// ============================================

import db from './connection.js';

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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (claimed_by) REFERENCES users(id),
      FOREIGN KEY (approved_by) REFERENCES users(id)
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

    console.log('✅ Database migrations completed');
}

// Run migrations if this file is executed directly
if (process.argv[1]?.includes('migrate')) {
    runMigrations();
}
