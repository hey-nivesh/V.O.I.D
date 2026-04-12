import fs from 'node:fs/promises';
import path from 'node:path';
import type { FixManifestPayload } from './types.js';

export async function writeFixManifest(repoRoot: string, manifest: FixManifestPayload): Promise<FixManifestPayload> {
    const manifestPath = path.join(repoRoot, 'fix_manifest.json');
    const out: FixManifestPayload = { ...manifest, manifest_path: manifestPath };
    await fs.writeFile(manifestPath, JSON.stringify(out, null, 2), 'utf8');
    return out;
}
