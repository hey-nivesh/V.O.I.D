// ============================================
// VOID MCP Server - Main Entry Point
// ============================================

import 'dotenv/config';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { runMigrations, seedDatabase } from './db/index.js';
import { authRoutes, ticketRoutes, previewRoutes, eventsRoutes, pushApprovalRoutes } from './routes/index.js';
import { startPushApprovalFileWatcher } from './services/pushApprovalWatcher.js';
import { logger } from './utils/logger.js';
import type { JWTPayload } from './types/index.js';

// Augment Fastify types
declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JWTPayload;
        user: JWTPayload;
    }
}

// Server configuration
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'void-mcp-dev-secret-change-in-prod';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8080,http://localhost:8081,http://localhost:5173,http://localhost:5174';

// Create Fastify instance
const fastify = Fastify({
    logger: true
});

// ===========================================
// Plugin Registration
// ===========================================

// CORS
await fastify.register(cors, {
    origin: CORS_ORIGIN.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
});

// JWT Authentication
await fastify.register(jwt, {
    secret: JWT_SECRET,
    sign: {
        // Long-running agents (fix-agent) need a token that outlives idle + work; override via JWT_EXPIRES_IN.
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    }
});

// Rate limiting
await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
        // Use user ID if authenticated, otherwise IP
        return (request.user as JWTPayload)?.id || request.ip;
    }
});

// ===========================================
// Auth decorator
// ===========================================

fastify.decorate('authenticate', async function (request, reply) {
    try {
        await request.jwtVerify();
    } catch (err) {
        reply.code(401).send({ success: false, error: 'Unauthorized' });
    }
});

// ===========================================
// Route Registration
// ===========================================

// Health check
fastify.get('/health', async () => ({
    success: true,
    data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    }
}));

// Auth routes
await fastify.register(authRoutes, { prefix: '/auth' });

// API routes with stricter rate limits for mutations
await fastify.register(async (instance) => {
    // Apply request throttling (increased for dev)
    await instance.register(rateLimit, {
        max: 1000,
        timeWindow: '1 minute',
        keyGenerator: (request) => (request.user as JWTPayload)?.id || request.ip
    });

    await instance.register(ticketRoutes, { prefix: '/tickets' });
    await instance.register(previewRoutes, { prefix: '/previews' });
    await instance.register(pushApprovalRoutes);
}, { prefix: '/api' });

// Events (SSE) with its own route outside rate limit
await fastify.register(eventsRoutes, { prefix: '/api/events' });

// ===========================================
// Error Handling
// ===========================================

fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);

    const statusCode = error.statusCode || 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message;

    reply.code(statusCode).send({
        success: false,
        error: message
    });
});

// ===========================================
// Startup
// ===========================================

async function start() {
    try {
        // Run database migrations
        console.log('🔧 Initializing database...');
        runMigrations();

        // Seed database if needed (idempotent)
        seedDatabase();

        // Start server
        await fastify.listen({ port: PORT, host: HOST });

        logger.success(`Server running at http://${HOST}:${PORT}`);
        logger.info(`SSE endpoint: /api/events`);
        logger.info(`Rate limiting enabled`);
        startPushApprovalFileWatcher();
        logger.info(`Push approval watcher: approval.json → SSE push_approval.changed`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    await fastify.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await fastify.close();
    process.exit(0);
});

// Start the server
start();
