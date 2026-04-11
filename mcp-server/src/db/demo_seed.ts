
import db from './connection.js';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { runMigrations } from './migrate.js';

function hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
}

async function seed() {
    // Run migrations first to ensure tables exist
    runMigrations();
    
    console.log('🌱 Seeding demo data...');

    // 1. Clear existing data
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM audit_logs').run();

    // 2. Create Users (Matching Login Screen Credentials)
    const users = [
        { id: uuidv4(), username: 'admin', role: 'admin', password_hash: hashPassword('adminpass') },
        { id: uuidv4(), username: 'fixagent', role: 'fix_agent', password_hash: hashPassword('fixpass') },
        { id: uuidv4(), username: 'voice', role: 'voice_agent', password_hash: hashPassword('voicepass') }
    ];

    const insertUser = db.prepare('INSERT INTO users (id, username, role, password_hash) VALUES (?, ?, ?, ?)');
    users.forEach(user => insertUser.run(user.id, user.username, user.role, user.password_hash));
    console.log('✅ Created demo users: admin, fixagent, voice');

    // 3. Create Tickets (Matching MainFeed.tsx MOCK_TICKETS)
    const tickets = [
        {
            id: 'T-F97568',
            title: 'Unauthenticated error on Movielo app across multiple devices',
            description: 'User reports being unable to stream videos on the Movielo app due to an Unauthenticated error. The issue occurs on both laptop and mobile phone. The user attempted to re-login four times without resolution. The problem started this afternoon.',
            component: 'Authentication',
            priority: 'CRITICAL',
            status: 'APPROVED_FOR_PROD',
            user_context: JSON.stringify({
                "browser": "Chrome 120.0.6099.109",
                "os": "Windows 11 Pro",
                "device_id": "88a7-f92j-29s8",
                "last_login": "2024-03-14T10:30:00Z",
                "session_token": "expired_or_invalid"
            }),
            test_results: JSON.stringify({
                status: "failed",
                logs: `[10:30:01] AUTH_SVC: Validating session token...\n[10:30:02] ERROR: Token validation failed: Signature mismatch.\n[10:30:02] WARN: User 88a7 attempting access with stale headers.\n[10:30:03] AUTH_SVC: Denying access request to /stream/manifest`
            }),
            diff: `diff --git a/services/auth.ts b/services/auth.ts
index e42a11b..a12b44d 100644
--- a/services/auth.ts
+++ b/services/auth.ts
@@ -42,7 +42,7 @@ export async function validateToken(token: string): Promise<boolean> {
-    const secret = process.env.OLD_JWT_SECRET;
+    const secret = process.env.JWT_SECRET_V2;
     
     try {
-        const decoded = jwt.verify(token, secret);
+        const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
         return !!decoded.sub;
     } catch (err) {`,
            files_modified: JSON.stringify(['services/auth.ts']),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        {
            id: 'T-303EA6',
            title: 'User is not defined error in Order Lo',
            component: 'Auth/Session',
            priority: 'HIGH',
            status: 'PENDING',
            description: 'The user is experiencing a user is not defined error while using the Order Lo mobile application...',
            user_context: "{}",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        },
        // Add more if needed, but T-F97568 is the critical one for the demo
    ];

    const insertTicket = db.prepare(`
        INSERT INTO tickets (id, title, description, component, priority, status, user_context, test_results, diff, files_modified, created_at, updated_at)
        VALUES (@id, @title, @description, @component, @priority, @status, @user_context, @test_results, @diff, @files_modified, @created_at, @updated_at)
    `);

    tickets.forEach(ticket => {
        insertTicket.run({
            ...ticket,
            test_results: ticket.test_results || null,
            diff: ticket.diff || null,
            files_modified: ticket.files_modified || null
        });
    });

    console.log(`✅ Created ${tickets.length} demo tickets`);
}

seed();
