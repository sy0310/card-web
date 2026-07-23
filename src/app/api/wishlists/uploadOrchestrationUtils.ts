export type SupabaseResponse<T = unknown> = {
  data: T | null;
  error: { message: string } | null;
};

export type OrchestrationMockCallLog = {
  queueUpserts: Array<{ path: string; reason: string }>;
  queueDeletes: string[];
  storageUploads: string[];
  storageRemovals: string[];
};

export function simulateUploadOrchestration(params: {
  queueInsertError?: { message: string } | null;
  uploadError?: { message: string } | null;
  oldQueueError?: { message: string } | null;
  occUpdateSuccess: boolean;
  unbindError?: { message: string } | null;
  hasPreviousPath: boolean;
  previousPath?: string;
  newStoragePath: string;
}): {
  status: number;
  success: boolean;
  log: OrchestrationMockCallLog;
} {
  const log: OrchestrationMockCallLog = {
    queueUpserts: [],
    queueDeletes: [],
    storageUploads: [],
    storageRemovals: [],
  };

  const {
    queueInsertError,
    uploadError,
    oldQueueError,
    occUpdateSuccess,
    unbindError,
    hasPreviousPath,
    previousPath,
    newStoragePath,
  } = params;

  // Step 1: Pre-register uncommitted upload task
  log.queueUpserts.push({ path: newStoragePath, reason: 'uncommitted_upload' });
  if (queueInsertError) {
    // FAIL-CLOSED: Stop immediately! Do NOT call storage.upload
    return { status: 500, success: false, log };
  }

  // Step 2: Storage upload
  log.storageUploads.push(newStoragePath);
  if (uploadError) {
    log.queueDeletes.push(newStoragePath);
    return { status: 500, success: false, log };
  }

  // Step 3: Register previous path cleanup task if exists
  if (hasPreviousPath && previousPath) {
    log.queueUpserts.push({ path: previousPath, reason: 'replaced_receipt' });
    if (oldQueueError) {
      // FAIL-CLOSED: Rollback newly uploaded file
      log.storageRemovals.push(newStoragePath);
      log.queueDeletes.push(newStoragePath);
      return { status: 500, success: false, log };
    }
  }

  // Step 4: OCC DB Update
  if (!occUpdateSuccess) {
    if (hasPreviousPath && previousPath) {
      log.queueDeletes.push(previousPath);
    }
    log.storageRemovals.push(newStoragePath);
    log.queueDeletes.push(newStoragePath);
    return { status: 409, success: false, log };
  }

  // Step 5: Unbind newStoragePath task (If unbindError occurs, log warn but DO NOT fail response)
  log.queueDeletes.push(newStoragePath);
  if (unbindError) {
    // Stage B: Graceful degradation, response is still 200 OK
  }

  return { status: 200, success: true, log };
}

export function simulateCronQueryOrchestration(params: {
  expiredQueryError?: { message: string } | null;
  queueQueryError?: { message: string } | null;
  refQueryError?: { message: string } | null;
  isReferenced: boolean;
}): {
  status: number;
  storageRemoveCalls: number;
  queueTaskRemoved: boolean;
} {
  const { expiredQueryError, queueQueryError, refQueryError, isReferenced } = params;

  if (expiredQueryError || queueQueryError) {
    return { status: 500, storageRemoveCalls: 0, queueTaskRemoved: false };
  }

  // Ref query
  if (refQueryError) {
    // FAIL-CLOSED: Absolute ZERO calls to storage.remove
    return { status: 200, storageRemoveCalls: 0, queueTaskRemoved: false };
  }

  if (isReferenced) {
    // File is currently active -> DO NOT CALL storage.remove!
    return { status: 200, storageRemoveCalls: 0, queueTaskRemoved: true };
  }

  // Unreferenced orphan -> Storage.remove is allowed
  return { status: 200, storageRemoveCalls: 1, queueTaskRemoved: true };
}
