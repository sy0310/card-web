export type WishlistDbState = {
  id: string;
  checkout_request_id: string;
  receipt_token: string;
  receipt_storage_path: string | null;
  receipt_expires_at: string | null;
};

export type MockStorageState = {
  files: Set<string>;
  removedLog: string[];
};

export function simulateConcurrentUpload(params: {
  dbState: WishlistDbState;
  storage: MockStorageState;
  newStoragePath: string;
  newExpiresAt: string;
  readPath: string | null;
  readExpiresAt: string | null;
}): { success: true } | { success: false; status: 409; rolledBackFile: string } {
  const { dbState, storage, newStoragePath, newExpiresAt, readPath, readExpiresAt } = params;

  // 1. Upload new file to storage
  storage.files.add(newStoragePath);

  // 2. Optimistic DB condition check
  const pathMatched = dbState.receipt_storage_path === readPath;
  const expiresMatched = dbState.receipt_expires_at === readExpiresAt;

  if (pathMatched && expiresMatched) {
    const oldPath = dbState.receipt_storage_path;
    dbState.receipt_storage_path = newStoragePath;
    dbState.receipt_expires_at = newExpiresAt;

    // Cleanup old file if exists
    if (oldPath && oldPath !== newStoragePath && storage.files.has(oldPath)) {
      storage.files.delete(oldPath);
      storage.removedLog.push(oldPath);
    }

    return { success: true };
  }

  // 3. Rollback: DB update missed condition -> remove newly uploaded file
  storage.files.delete(newStoragePath);
  storage.removedLog.push(newStoragePath);
  return { success: false, status: 409, rolledBackFile: newStoragePath };
}

export function simulateCronRaceCondition(params: {
  dbState: WishlistDbState;
  storage: MockStorageState;
  cronTargetRecord: { id: string; path: string; expiresAt: string };
}): { cronDbUpdated: boolean } {
  const { dbState, storage, cronTargetRecord } = params;

  // Cron deletes physical file in storage
  if (storage.files.has(cronTargetRecord.path)) {
    storage.files.delete(cronTargetRecord.path);
    storage.removedLog.push(cronTargetRecord.path);
  }

  // Cron conditional update check
  const matches =
    dbState.id === cronTargetRecord.id &&
    dbState.receipt_storage_path === cronTargetRecord.path &&
    dbState.receipt_expires_at === cronTargetRecord.expiresAt;

  if (matches) {
    dbState.receipt_storage_path = null;
    return { cronDbUpdated: true };
  }

  return { cronDbUpdated: false };
}
