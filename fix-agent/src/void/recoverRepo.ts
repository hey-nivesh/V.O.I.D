/**
 * Recover a local clone after VOID-Fixer (or any tool) left sparse-checkout enabled.
 *
 * Usage:
 *   VOID_TARGET_REPO="E:\\path\\to\\Focus-Flow-" npx tsx src/void/recoverRepo.ts
 *   npx tsx src/void/recoverRepo.ts "E:\\path\\to\\Focus-Flow-"
 */
import { recoverFullWorkingTreeAfterSparse } from './gitVoid.js';

const arg = process.argv[2];
const root = (arg || process.env.VOID_TARGET_REPO || '').trim();
if (!root) {
    console.error('Pass repo path as argv[1] or set VOID_TARGET_REPO.');
    process.exit(1);
}

recoverFullWorkingTreeAfterSparse(root)
    .then(() => {
        console.log('Restored full checkout:', root);
    })
    .catch((e) => {
        console.error(e);
        process.exit(1);
    });
