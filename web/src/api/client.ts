import { z } from "zod";
import { projectSummarySchema, uploadResponseSchema, type ProjectSummary, type UploadResponse } from "./schemas";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;

export class ApiError extends Error {}

function requireBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new ApiError(
      "VITE_API_BASE_URL is not set. Copy .env.example to .env and restart the dev server.",
    );
  }
  return API_BASE_URL;
}

// FastAPI's default error body shape, e.g. {"detail": "human readable message"}.
const errorBodySchema = z.object({ detail: z.string() });

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const parsed = errorBodySchema.safeParse(body);
    if (parsed.success) {
      return parsed.data.detail;
    }
  } catch {
    // Response body wasn't JSON (or was empty) — fall through to the generic message below.
  }
  return `Processing service returned ${response.status} ${response.statusText}`;
}

export async function fetchFixtureProject(): Promise<ProjectSummary> {
  const response = await fetch(`${requireBaseUrl()}/fixture`);
  if (!response.ok) {
    throw new ApiError(`Processing service returned ${response.status} ${response.statusText}`);
  }

  const body: unknown = await response.json();
  const parsed = projectSummarySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(`Fixture response did not match the expected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function uploadImage(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${requireBaseUrl()}/uploads`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new ApiError(await extractErrorMessage(response));
  }

  const body: unknown = await response.json();
  const parsed = uploadResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(`Upload response did not match the expected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}
