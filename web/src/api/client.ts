import { projectSummarySchema, type ProjectSummary } from "./schemas";

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
