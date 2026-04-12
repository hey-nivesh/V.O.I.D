import path from 'node:path';
import fs from 'node:fs/promises';
import type { FixManifest } from './types.js';
import { normalizeTargetRepo } from './pathScope.js';

export async function writeFixManifest(targetRepo: string, manifest: FixManifest): Promise<FixManifest> {
    const root = normalizeTargetRepo(targetRepo);
    const manifestPath = path.join(root, 'fix_manifest.json');
    const out: FixManifest = { ...manifest, manifest_path: manifestPath };
    await fs.writeFile(manifestPath, JSON.stringify(out, null, 2), 'utf8');
    return out;
}
