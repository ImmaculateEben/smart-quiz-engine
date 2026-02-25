import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceSameOrigin, parseJsonBody } from "@/lib/http/api-security";
import { hashPin } from "@/lib/pins/generate";

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractCandidateIdentifier(source: unknown) {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>).candidateIdentifier;
  return typeof value === "string" ? value : "";
}

const resumeRequestSchema = z
  .object({
    pin: z.string().trim().min(1).max(128),
    examId: z.string().trim().min(1).max(128),
    candidateIdentifier: z.string().trim().max(200).optional().default(""),
    candidateName: z.string().trim().max(200).optional().default("")
  });

export async function POST(request: Request) {
  const csrf = enforceSameOrigin(request);
  if (csrf) return csrf;

  const parsed = await parseJsonBody(request, resumeRequestSchema);
  if (!parsed.ok) return parsed.response;

  const { pin: rawPin, examId, candidateIdentifier, candidateName } = parsed.data;
  if (!candidateIdentifier && !candidateName) {
    return NextResponse.json(
      { error: "CANDIDATE_MATCH_REQUIRED", message: "Provide candidate identifier or candidate name to resume." },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const pinHash = hashPin(rawPin);
  const { data: pin } = await admin
    .from("exam_pins")
    .select("id,institution_id,exam_id")
    .eq("pin_hash", pinHash)
    .eq("exam_id", examId)
    .maybeSingle();
  if (!pin) {
    return NextResponse.json({ error: "INVALID_PIN" }, { status: 401 });
  }

  const { data: attempts } = await admin
    .from("exam_attempts")
    .select(
      "id,candidate_id,status,started_at,expires_at,last_saved_at,current_question_index,attempt_metadata,submitted_at"
    )
    .eq("institution_id", pin.institution_id)
    .eq("exam_id", pin.exam_id)
    .eq("pin_id", pin.id)
    .order("started_at", { ascending: false })
    .limit(20);

  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ error: "RESUME_NOT_FOUND" }, { status: 404 });
  }

  const candidateIds = [...new Set(attempts.map((a) => a.candidate_id).filter(Boolean))];
  const { data: candidates } = candidateIds.length
    ? await admin
        .from("candidates")
        .select("id,full_name,registration_data")
        .eq("institution_id", pin.institution_id)
        .in("id", candidateIds as string[])
    : { data: [] as Array<{ id: string; full_name: string; registration_data: unknown }> };
  const candidateMap = new Map((candidates ?? []).map((c) => [c.id, c]));

  const normalizedName = candidateName ? normalizeText(candidateName) : "";
  const normalizedIdentifier = candidateIdentifier ? normalizeText(candidateIdentifier) : "";

  const matched = attempts.filter((attempt) => {
    const candidate = candidateMap.get(attempt.candidate_id);
    if (!candidate) return false;

    let identifierMatch = true;
    if (normalizedIdentifier) {
      const metaIdentifier = extractCandidateIdentifier(attempt.attempt_metadata);
      const regIdentifier = extractCandidateIdentifier(candidate.registration_data);
      const known = metaIdentifier || regIdentifier;
      identifierMatch = known ? normalizeText(known) === normalizedIdentifier : false;
    }

    let nameMatch = true;
    if (normalizedName) {
      nameMatch = normalizeText(candidate.full_name ?? "") === normalizedName;
    }

    return identifierMatch && nameMatch;
  });

  if (matched.length === 0) {
    return NextResponse.json({ error: "RESUME_NOT_FOUND" }, { status: 404 });
  }

  const inProgress = matched.filter((a) => a.status === "in_progress");
  if (inProgress.length > 1) {
    return NextResponse.json(
      { error: "RESUME_AMBIGUOUS", message: "Multiple active attempts matched. Use a unique candidate identifier." },
      { status: 409 }
    );
  }

  const selected = inProgress[0];
  if (!selected) {
    const latest = matched[0];
    return NextResponse.json(
      {
        error: "ATTEMPT_NOT_RESUMABLE",
        status: latest.status,
        submittedAt: latest.submitted_at ?? null
      },
      { status: 409 }
    );
  }

  if (selected.expires_at && new Date(selected.expires_at).getTime() <= Date.now()) {
    const submittedAt = new Date().toISOString();
    await admin
      .from("exam_attempts")
      .update({ status: "auto_submitted", submitted_at: submittedAt, last_saved_at: submittedAt })
      .eq("id", selected.id)
      .eq("status", "in_progress");
    return NextResponse.json(
      {
        error: "ATTEMPT_EXPIRED",
        status: "auto_submitted"
      },
      { status: 409 }
    );
  }

  return NextResponse.json({
    status: "ok",
    attemptId: selected.id,
    examId: pin.exam_id,
    resumed: true,
    attempt: {
      status: selected.status,
      startedAt: selected.started_at,
      expiresAt: selected.expires_at,
      lastSavedAt: selected.last_saved_at,
      currentQuestionIndex: selected.current_question_index ?? 0
    }
  });
}
