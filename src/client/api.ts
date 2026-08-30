/**
 * The API client and the TanStack Query hooks over it.
 *
 * One rule the whole SPA rests on: a `401` from any endpoint means the session
 * is gone, and the app shows the sign-in screen. It does not deep-link back
 * afterwards — there are three screens and it is not worth the state handling
 * (`docs/08-auth-and-permissions.md` §4).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type { RenderContent, RenderKind } from "~/shared/render-content";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: { fields?: string[] } };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (!response.ok) {
    const body = isJson ? ((await response.json()) as ApiErrorBody) : null;
    throw new ApiError(
      response.status,
      body?.error.code ?? "internal",
      body?.error.message ?? "Something went wrong.",
      body?.error.details?.fields ?? [],
    );
  }
  return (isJson ? await response.json() : await response.text()) as T;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

/* ------------------------------------------------------------------- types */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Profile {
  id: string;
  familyNameKanji: string;
  givenNameKanji: string;
  familyNameKana: string;
  givenNameKana: string;
  nameLatin: string;
  dateOfBirth: string;
  gender: string | null;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  addressKana: string;
  contactSameAsAddress: boolean;
  hasPhoto: boolean;
}

export interface Fact {
  id: string;
  claim: string;
  provenance: "measured" | "attested" | "generated";
  disclosure: "public" | "restricted" | "private";
  status: "candidate" | "accepted" | "rejected";
  evidence: {
    sourceDocumentVersionId: string;
    lineNumber: number;
    quoteStart: number;
    quoteEnd: number;
  } | null;
  technologies: string[];
  isClientIdentifying: boolean;
}

export interface ImportStatus {
  importId: string;
  sourceDocumentId: string;
  versionNo: number;
  status: "queued" | "extracting" | "ready" | "failed";
  chunksTotal: number;
  chunksDone: number;
  candidatesExtracted: number;
  candidatesDiscarded: number;
  wordCount: number;
  changedRegionShare: number | null;
  error: { code: string; message: string } | null;
  failedAtChunk: number | null;
}

export interface SourceText {
  sourceDocumentVersionId: string;
  filename: string;
  wordCount: number;
  importedAt: string;
  text: string;
}

export interface RenderRow {
  id: string | null;
  kind: RenderKind;
  language: "en" | "ja";
  title: string;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  generatedAt: string | null;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending";
  newFactsSince: number | null;
  pendingProposalId: string | null;
}

export interface Overview {
  lastImportAt: string | null;
  activeImport: ImportStatus | null;
  tiles: Record<"employers" | "roles" | "projects" | "credentials", { count: number; note: string | null }>;
  factsByProvenance: { measured: number; attested: number; generated: number };
  documents: RenderRow[];
  isEmpty: boolean;
}

export interface Proposal {
  id: string;
  renderKind: RenderKind;
  status: "generating" | "failed" | "pending" | "accepted" | "dismissed";
  generationStatus: "generating" | "ready" | "failed";
  error: { code: string; message: string } | null;
  basedOnVersionNo: number | null;
  proposedVersionNo: number;
  generatedAt: string;
  reason: string | null;
  warnings: string[];
  unchanged: boolean;
  withheld: { privateFactCount: number; generatedFactCount: number };
}

export interface DiffChange {
  changeId: string;
  sectionKey: string;
  currentBlockId: string | null;
  proposedBlockId: string | null;
  tokens: { op: "equal" | "add" | "remove"; text: string }[];
  rationale: { kind: string; text: string; factIds: string[] };
}

export interface RenderDiff {
  additions: number;
  removals: number;
  changes: DiffChange[];
}

/* ------------------------------------------------------------------ queries */

export const keys = {
  session: ["session"] as const,
  profile: ["profile"] as const,
  overview: ["overview"] as const,
  renders: ["renders"] as const,
  employers: ["employers"] as const,
  importStatus: (id: string) => ["import", id] as const,
  facts: (importId: string) => ["facts", importId] as const,
  sourceText: (documentId: string, versionNo: number) =>
    ["source", documentId, versionNo] as const,
  proposal: (id: string) => ["proposal", id] as const,
  diff: (id: string) => ["proposal", id, "diff"] as const,
};

/** `1.5 s` while a resource is non-terminal (`docs/07` §1). */
const POLL_MS = 1500;

export const useSession = () =>
  useQuery({
    queryKey: keys.session,
    queryFn: () => api<{ user: SessionUser }>("/api/auth/session"),
    retry: false,
  });

export const useProfile = () =>
  useQuery({
    queryKey: keys.profile,
    queryFn: () => api<Profile>("/api/profile"),
    retry: false,
  });

export const useOverview = () =>
  useQuery({ queryKey: keys.overview, queryFn: () => api<Overview>("/api/overview") });

export const useRenders = () =>
  useQuery({
    queryKey: keys.renders,
    queryFn: () => api<{ items: RenderRow[] }>("/api/renders"),
  });

export function useImportStatus(importId: string) {
  return useQuery({
    queryKey: keys.importStatus(importId),
    queryFn: () => api<ImportStatus>(`/api/imports/${importId}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "extracting" ? POLL_MS : false;
    },
  });
}

export function useFacts(importId: string, options?: Partial<UseQueryOptions<{ items: Fact[] }>>) {
  return useQuery({
    queryKey: keys.facts(importId),
    queryFn: () => api<{ items: Fact[] }>(`/api/facts?importId=${importId}`),
    ...options,
  });
}

export const useSourceText = (documentId: string, versionNo: number) =>
  useQuery({
    queryKey: keys.sourceText(documentId, versionNo),
    queryFn: () => api<SourceText>(`/api/source-documents/${documentId}/versions/${versionNo}/text`),
  });

export function useProposal(proposalId: string) {
  return useQuery({
    queryKey: keys.proposal(proposalId),
    queryFn: () => api<Proposal>(`/api/proposals/${proposalId}`),
    refetchInterval: (query) =>
      query.state.data?.generationStatus === "generating" ? POLL_MS : false,
  });
}

export const useDiff = (proposalId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.diff(proposalId),
    queryFn: () => api<RenderDiff>(`/api/proposals/${proposalId}/diff`),
    enabled,
  });

/* ---------------------------------------------------------------- mutations */

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: Record<string, unknown>) =>
      api<Profile>("/api/profile", { method: "PUT", ...json(profile) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profile });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; projectId?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.projectId) form.set("projectId", input.projectId);
      return api<{ importId: string; sourceDocumentId: string; versionNo: number }>("/api/imports", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.overview }),
  });
}

/**
 * Every accept, reject and edit is saved as it is made rather than at the end,
 * so closing the tab mid-review loses nothing.
 */
export function useFactAction(importId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.facts(importId) });

  const patch = useMutation({
    mutationFn: (input: { id: string; body: Partial<Pick<Fact, "claim" | "provenance" | "disclosure">> }) =>
      api<Fact>(`/api/facts/${input.id}`, { method: "PATCH", ...json(input.body) }),
    onSuccess: () => void refresh(),
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; action: "accept" | "reject" | "undo" }) =>
      api<Fact>(`/api/facts/${input.id}/${input.action}`, { method: "POST" }),
    onSuccess: () => void refresh(),
  });
  const finish = useMutation({
    mutationFn: () => api<{ acceptedFacts: number }>(`/api/imports/${importId}/finish`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
    },
  });
  const retry = useMutation({
    mutationFn: () => api<ImportStatus>(`/api/imports/${importId}/retry`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.importStatus(importId) }),
  });

  return { patch, resolve, finish, retry };
}

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: RenderKind) =>
      api<{ proposalId: string }>(`/api/renders/${kind}/generate`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.renders }),
  });
}

export function useDecideProposal(proposalId: string) {
  const queryClient = useQueryClient();
  const after = () => {
    void queryClient.invalidateQueries({ queryKey: keys.proposal(proposalId) });
    void queryClient.invalidateQueries({ queryKey: keys.renders });
    void queryClient.invalidateQueries({ queryKey: keys.overview });
  };
  const accept = useMutation({
    mutationFn: () =>
      api<{ newVersionNo: number }>(`/api/proposals/${proposalId}/accept`, { method: "POST" }),
    onSuccess: after,
    onError: after,
  });
  const dismiss = useMutation({
    mutationFn: () => api<{ status: string }>(`/api/proposals/${proposalId}/dismiss`, { method: "POST" }),
    onSuccess: after,
    onError: after,
  });
  return { accept, dismiss };
}

export const downloadUrl = (kind: RenderKind, format: "docx" | "md") =>
  `/api/renders/${kind}/download?format=${format}`;

export type { RenderContent };
