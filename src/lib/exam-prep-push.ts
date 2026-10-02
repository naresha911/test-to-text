/**
 * Upsert one exam-prep export into the rms-exam-prep Supabase project.
 * Server-only. Uses that project's service role, not this app's Supabase client.
 */
import type { ExamPrepExport } from "@/lib/exam-prep-export";
import { runExamPrepPush, type ExamPrepPushResult } from "@/lib/exam-prep/push";
import { readContainerId } from "@/lib/exam-prep/push-plan";
import { createSupabaseWriter } from "@/lib/exam-prep/remote-writer";
import {
  forgetRetiredGroups,
  markPushLedger,
  readPushLedger,
  readRetiredGroups,
  rememberRetiredGroups,
  removePushLedger,
  savePushStatus,
} from "@/lib/local-db";

export type { ExamPrepPushResult };

const running = new Set<string>();

export async function pushExamPrepExport(payload: ExamPrepExport): Promise<ExamPrepPushResult> {
  const documentId = readContainerId(payload);
  if (documentId && running.has(documentId)) {
    return {
      documentId,
      title: "",
      total: 0,
      pushed: 0,
      skipped: 0,
      removed: 0,
      complete: false,
      error: "A push for this paper is already running.",
    };
  }
  if (documentId) running.add(documentId);
  try {
    return await runExamPrepPush(payload, {
      writer: createSupabaseWriter(),
      ledger: {
        read: readPushLedger,
        mark: markPushLedger,
        remove: removePushLedger,
        saveStatus: savePushStatus,
        readRetiredGroups,
        rememberRetiredGroups,
        forgetRetiredGroups,
      },
    });
  } finally {
    if (documentId) running.delete(documentId);
  }
}
