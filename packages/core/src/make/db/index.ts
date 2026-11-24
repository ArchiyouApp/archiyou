/**
 *  make/db — the make database: a versioned snapshot of the product sheet, see snapshot.ts.
 */

export { MakeDb } from './MakeDb';
export {
    MAKE_DB_FORMAT, MAKE_DB_TABLES, MAKE_DB_SETTINGS,
    validateSnapshot, snapshotFromTables, nextVersion, compareVersions,
    type MakeDbSnapshot, type MakeDbSource, type MakeDbRow, type MakeDbTableName, type MakeDbIssue,
} from './snapshot';
