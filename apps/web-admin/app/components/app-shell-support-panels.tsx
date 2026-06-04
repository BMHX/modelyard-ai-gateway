"use client";

import { Link } from "@/i18n/navigation";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLocalePreference, useT } from "../lib/i18n-client";

import { CopyButton } from "./copy-button";
import { DisclosureSummary } from "./disclosure-summary";

type ShellShortcut = {
  href: string;
  label: string;
  description?: string;
};

type SurfaceMemoryItem = {
  id: string;
  label: string;
  href: string;
  description: string;
  meta: string;
  source: "favorite" | "recent";
};

type ShiftNoteMemory = {
  workspaceId: string;
  workspaceLabel: string | null;
  nextStep: string;
  handoffNote: string;
  updatedAt: number;
  surfaceLabel: string;
  surfaceHref: string;
};

type TimedStorageEnvelope<T> = {
  value: T;
  expiresAt: number;
};

const shiftNoteStorageKey = "teamops:shift-notes";
const shiftNoteStorageTtlMs = 12 * 60 * 60 * 1000;
const shellKey = (value: string) => `shell.${value}`;

function isTimedStorageEnvelope<T>(
  value: unknown,
): value is TimedStorageEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "expiresAt" in value &&
    typeof (value as TimedStorageEnvelope<T>).expiresAt === "number"
  );
}

function readJsonStorageValue<T>(storage: Storage, key: string) {
  const stored = storage.getItem(key);
  return stored ? (JSON.parse(stored) as T) : null;
}

function readTimedSessionStorageValue<T>(key: string) {
  const stored = readJsonStorageValue<TimedStorageEnvelope<T> | T>(
    window.sessionStorage,
    key,
  );

  if (!stored) {
    return null;
  }

  if (isTimedStorageEnvelope<T>(stored)) {
    if (stored.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }

    return stored.value;
  }

  return stored as T;
}

function writeTimedSessionStorageValue<T>(key: string, value: T, ttlMs: number) {
  window.sessionStorage.setItem(
    key,
    JSON.stringify({
      value,
      expiresAt: Date.now() + ttlMs,
    } satisfies TimedStorageEnvelope<T>),
  );
}

function formatVisitTime(value: number, locale: string) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AppShellSupportPanels({
  currentHref,
  currentPageLabel,
  nextActionLabel,
  surfaceMemoryItems,
  workflowShortcuts,
  workspaceId,
  workspaceScopeLabel,
}: {
  currentHref: string;
  currentPageLabel: string;
  nextActionLabel: string;
  surfaceMemoryItems: SurfaceMemoryItem[];
  workflowShortcuts: ShellShortcut[];
  workspaceId?: string | null;
  workspaceScopeLabel?: string | null;
}) {
  const { locale } = useLocalePreference();
  const tr = useT();
  const [shiftNextStep, setShiftNextStep] = useState("");
  const [shiftHandoffNote, setShiftHandoffNote] = useState("");
  const [savedShiftNote, setSavedShiftNote] = useState<ShiftNoteMemory | null>(
    null,
  );
  const [lastShiftSaveMode, setLastShiftSaveMode] = useState<
    "auto" | "manual" | null
  >(null);
  const [shiftNoteSaveError, setShiftNoteSaveError] = useState<string | null>(
    null,
  );

  const hasShiftNoteChanges =
    shiftNextStep.trim() !== (savedShiftNote?.nextStep ?? "") ||
    shiftHandoffNote.trim() !== (savedShiftNote?.handoffNote ?? "");
  const shiftNoteCopyValue = [
    workspaceScopeLabel ? `${tr("Workspace")}: ${workspaceScopeLabel}` : null,
    `${tr(shellKey("support.surface"))}: ${currentPageLabel}`,
    shiftNextStep.trim() ? `${tr(shellKey("support.nextStep"))}: ${shiftNextStep.trim()}` : null,
    shiftHandoffNote.trim() ? `${tr("Note")}: ${shiftHandoffNote.trim()}` : null,
    savedShiftNote?.updatedAt
      ? `${tr(shellKey("support.saved"))}: ${formatVisitTime(savedShiftNote.updatedAt, locale)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!workspaceId) {
      setSavedShiftNote(null);
      setLastShiftSaveMode(null);
      setShiftNoteSaveError(null);
      setShiftNextStep("");
      setShiftHandoffNote("");
      return;
    }

    try {
      const parsed =
        readTimedSessionStorageValue<ShiftNoteMemory[]>(shiftNoteStorageKey) ??
        readJsonStorageValue<ShiftNoteMemory[]>(
          window.localStorage,
          shiftNoteStorageKey,
        ) ??
        [];

      if (parsed.length) {
        writeTimedSessionStorageValue(
          shiftNoteStorageKey,
          parsed,
          shiftNoteStorageTtlMs,
        );
      }

      window.localStorage.removeItem(shiftNoteStorageKey);
      const matched =
        parsed.find((item) => item.workspaceId === workspaceId) ?? null;

      setSavedShiftNote(matched);
      setLastShiftSaveMode(null);
      setShiftNoteSaveError(null);
      setShiftNextStep(matched?.nextStep ?? "");
      setShiftHandoffNote(matched?.handoffNote ?? "");
    } catch {
      setSavedShiftNote(null);
      setLastShiftSaveMode(null);
      setShiftNoteSaveError(null);
      setShiftNextStep("");
      setShiftHandoffNote("");
    }
  }, [workspaceId]);

  function persistShiftNote(
    mode: "auto" | "manual",
    announceOutcome = mode === "manual",
  ) {
    if (typeof window === "undefined" || !workspaceId) {
      return false;
    }

    const nextStep = shiftNextStep.trim();
    const handoffNote = shiftHandoffNote.trim();

    try {
      const parsed =
        readTimedSessionStorageValue<ShiftNoteMemory[]>(shiftNoteStorageKey) ??
        readJsonStorageValue<ShiftNoteMemory[]>(
          window.localStorage,
          shiftNoteStorageKey,
        ) ??
        [];
      const remainingNotes = parsed.filter(
        (item) => item.workspaceId !== workspaceId,
      );

      if (!nextStep && !handoffNote) {
        if (remainingNotes.length) {
          writeTimedSessionStorageValue(
            shiftNoteStorageKey,
            remainingNotes,
            shiftNoteStorageTtlMs,
          );
        } else {
          window.sessionStorage.removeItem(shiftNoteStorageKey);
        }
        window.localStorage.removeItem(shiftNoteStorageKey);
        setSavedShiftNote(null);
        setLastShiftSaveMode(mode);
        setShiftNoteSaveError(null);
        return true;
      }

      const nextNote: ShiftNoteMemory = {
        workspaceId,
        workspaceLabel: workspaceScopeLabel ?? null,
        nextStep,
        handoffNote,
        updatedAt: Date.now(),
        surfaceLabel: currentPageLabel,
        surfaceHref: currentHref,
      };

      const nextNotes = [nextNote, ...remainingNotes].slice(0, 12);
      writeTimedSessionStorageValue(
        shiftNoteStorageKey,
        nextNotes,
        shiftNoteStorageTtlMs,
      );
      window.localStorage.removeItem(shiftNoteStorageKey);
      setSavedShiftNote(nextNote);
      setLastShiftSaveMode(mode);
      setShiftNoteSaveError(null);

      if (announceOutcome) {
        // Keep UI calm; saving feedback stays inline.
      }

      return true;
    } catch {
      setShiftNoteSaveError(tr(shellKey("support.saveError")));
      return false;
    }
  }

  useEffect(() => {
    if (!workspaceId || !hasShiftNoteChanges) {
      return;
    }

    setShiftNoteSaveError(null);
    const timeout = window.setTimeout(() => {
      persistShiftNote("auto", false);
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [hasShiftNoteChanges, shiftHandoffNote, shiftNextStep, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    function handlePageHide() {
      if (hasShiftNoteChanges) {
        persistShiftNote("auto", false);
      }
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [hasShiftNoteChanges, shiftHandoffNote, shiftNextStep, workspaceId]);

  function handleSaveShiftNote() {
    persistShiftNote("manual");
  }

  function handleClearShiftNote() {
    if (typeof window === "undefined" || !workspaceId) {
      setShiftNextStep("");
      setShiftHandoffNote("");
      setSavedShiftNote(null);
      setLastShiftSaveMode(null);
      setShiftNoteSaveError(null);
      return;
    }

    try {
      const parsed =
        readTimedSessionStorageValue<ShiftNoteMemory[]>(shiftNoteStorageKey) ??
        readJsonStorageValue<ShiftNoteMemory[]>(
          window.localStorage,
          shiftNoteStorageKey,
        ) ??
        [];
      const nextNotes = parsed.filter((item) => item.workspaceId !== workspaceId);

      if (nextNotes.length) {
        writeTimedSessionStorageValue(
          shiftNoteStorageKey,
          nextNotes,
          shiftNoteStorageTtlMs,
        );
      } else {
        window.sessionStorage.removeItem(shiftNoteStorageKey);
      }

      window.localStorage.removeItem(shiftNoteStorageKey);
    } catch {
      // Ignore storage failures and keep the UI responsive.
    }

    setShiftNextStep("");
    setShiftHandoffNote("");
    setSavedShiftNote(null);
    setLastShiftSaveMode("manual");
    setShiftNoteSaveError(null);
  }

  function handleShiftNoteKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleSaveShiftNote();
    }
  }

  const shouldAutoOpenNotesPanel = Boolean(
    shiftNoteSaveError || hasShiftNoteChanges,
  );
  const notesSummaryLabel = shiftNoteSaveError
    ? tr(shellKey("support.notesBlocked"))
    : hasShiftNoteChanges
      ? tr(shellKey("support.unsavedNote"))
      : savedShiftNote
        ? tr(shellKey("support.savedNote"))
        : tr(shellKey("support.sessionNote"));

  const recentSurfaceSupportList = useMemo(
    () =>
      surfaceMemoryItems.length ? (
        <div className="grid">
          {surfaceMemoryItems.map((item, index) => (
            <div
              className={cn(
                "flex items-center gap-2 px-1 py-2.5 transition-[background-color] duration-150 hover:bg-foreground/[0.02]",
                index > 0 && "border-t border-[color:var(--border-subtle)]",
              )}
              key={item.id}
            >
              <Link
                className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35"
                href={item.href}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-foreground">
                    {item.label}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] leading-5 text-muted-foreground">
                  {item.meta}
                </p>
              </Link>
            </div>
          ))}
        </div>
      ) : null,
    [surfaceMemoryItems],
  );

  const shortcutSupportList = useMemo(
    () => (
      <div className="grid">
        {workflowShortcuts.map((shortcut, index) => (
          <Link
            className={cn(
              "group flex items-start justify-between gap-3 px-1 py-2.5 transition-[color,background-color] duration-150 hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 motion-reduce:transition-none",
              index > 0 && "border-t border-[color:var(--border-subtle)]",
            )}
            href={shortcut.href}
            key={shortcut.href}
          >
            <div className="min-w-0">
              <span className="block text-[12.5px] font-medium text-foreground">
                {shortcut.label}
              </span>
            </div>
            <ArrowRight className="mt-0.5 size-3 text-muted-foreground/75 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        ))}
      </div>
    ),
    [workflowShortcuts],
  );

  const renderShiftNoteComposer = (idSuffix: string) =>
    workspaceId ? (
      <div
        className={cn(
          "grid gap-3.5",
          recentSurfaceSupportList &&
            "border-t border-[color:var(--border-subtle)] pt-4",
        )}
      >
        <div className="grid gap-2">
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/72"
            htmlFor={`shift-next-step-${idSuffix}`}
          >
            {tr(shellKey("support.next"))}
          </label>
          <Input
            autoComplete="off"
            className="h-8.5 border-border/50 bg-transparent px-3 text-[12.5px] shadow-none placeholder:text-muted-foreground/68"
            id={`shift-next-step-${idSuffix}`}
            name="shift-next-step"
            onChange={(event) => {
              setShiftNoteSaveError(null);
              setShiftNextStep(event.currentTarget.value);
            }}
            onKeyDown={handleShiftNoteKeyDown}
            placeholder={nextActionLabel}
            value={shiftNextStep}
          />
        </div>

        <div className="grid gap-2">
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/72"
            htmlFor={`shift-handoff-note-${idSuffix}`}
          >
            {tr("Note")}
          </label>
          <textarea
            autoComplete="off"
            className="min-h-20 rounded-md border border-border/50 bg-transparent px-3 py-2.5 text-[12.5px] text-foreground outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/68 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring/45"
            id={`shift-handoff-note-${idSuffix}`}
            name="shift-handoff-note"
            onChange={(event) => {
              setShiftNoteSaveError(null);
              setShiftHandoffNote(event.currentTarget.value);
            }}
            onKeyDown={handleShiftNoteKeyDown}
            placeholder={tr(shellKey("support.notePlaceholder"))}
            rows={4}
            value={shiftHandoffNote}
          />
        </div>

        {shiftNoteSaveError || hasShiftNoteChanges || savedShiftNote ? (
          <p className="text-[10.5px] leading-5 text-muted-foreground">
            {shiftNoteSaveError
              ? `${shiftNoteSaveError} ${tr(shellKey("support.noteActionsHint"))}`
              : hasShiftNoteChanges
                ? tr(shellKey("support.autoSavingHint"))
                : savedShiftNote
                  ? tr(shellKey("support.savedSummary"), {
                      state: tr(lastShiftSaveMode === "auto" ? shellKey("support.savedInSession") : shellKey("support.savedForSession")),
                      surface: savedShiftNote.surfaceLabel,
                      time: formatVisitTime(savedShiftNote.updatedAt, locale),
                    })
                  : null}
          </p>
        ) : null}

        {shiftNoteSaveError ||
        shiftNextStep.trim() ||
        shiftHandoffNote.trim() ||
        savedShiftNote ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              onClick={handleSaveShiftNote}
              size="sm"
              type="button"
              variant={shiftNoteSaveError ? "default" : "secondary"}
            >
              {tr(
                shiftNoteSaveError
                  ? shellKey("support.retrySave")
                  : hasShiftNoteChanges
                    ? shellKey("support.saveNow")
                    : shellKey("support.savedInSession"),
              )}
            </Button>
            {shiftNextStep.trim() ||
            shiftHandoffNote.trim() ||
            savedShiftNote ? (
              <Button
                onClick={handleClearShiftNote}
                size="sm"
                type="button"
                variant="ghost"
              >
                {tr(shellKey("support.clear"))}
              </Button>
            ) : null}
            {shiftNextStep.trim() ||
            shiftHandoffNote.trim() ||
            savedShiftNote ? (
              <CopyButton
                label={tr(shellKey("support.copyShiftNote"))}
                value={shiftNoteCopyValue || currentHref}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  const mobileSupportCardClassName =
    "overflow-hidden rounded-lg border border-border/45 bg-[color:color-mix(in_srgb,var(--surface-1)_92%,var(--surface-canvas)_8%)]";

  return (
    <section
      aria-label={tr(shellKey("support.operatorSupport"))}
      className="grid gap-6 border-t border-border/60 pt-4"
    >
      <div className="grid gap-2.5 lg:hidden">
        {workflowShortcuts.length ? (
          <details className={`${mobileSupportCardClassName} disclosure-panel disclosure-panel--tool`}>
            <summary className="disclosure-panel__summary">
              <DisclosureSummary title={tr(shellKey("support.shortcuts"))} variant="tool" />
            </summary>
            <div className="border-t border-border/45 px-3 py-2.5">
              {shortcutSupportList}
            </div>
          </details>
        ) : null}

        {(surfaceMemoryItems.length || workspaceId) ? (
          <details
            className={`${mobileSupportCardClassName} disclosure-panel disclosure-panel--tool`}
            open={shouldAutoOpenNotesPanel || undefined}
          >
            <summary className="disclosure-panel__summary">
              <DisclosureSummary
                title={tr(workspaceId ? shellKey("support.sessionNote") : shellKey("support.recent"))}
                variant="tool"
              />
            </summary>
            <div className="grid gap-4 border-t border-border/45 px-3 py-3">
              {recentSurfaceSupportList}
              {renderShiftNoteComposer("mobile")}
            </div>
          </details>
        ) : null}
      </div>

      <div className="hidden gap-6 lg:grid xl:grid-cols-[.9fr_1.1fr]">
        {workflowShortcuts.length ? (
          <div className="grid content-start gap-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/66">
              {tr(shellKey("support.shortcuts"))}
            </p>
            {shortcutSupportList}
          </div>
        ) : null}

        {(surfaceMemoryItems.length || workspaceId) ? (
          <div className="grid content-start gap-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/66">
              {tr(surfaceMemoryItems.length ? shellKey("support.recentAndNotes") : shellKey("support.notes"))}
            </p>
            <details
              className={`${mobileSupportCardClassName} disclosure-panel disclosure-panel--tool`}
              open={shouldAutoOpenNotesPanel || undefined}
            >
              <summary className="disclosure-panel__summary">
                <DisclosureSummary
                  meta={tr(shellKey("support.open"))}
                  title={notesSummaryLabel}
                  variant="tool"
                />
              </summary>
              <div className="grid gap-4 border-t border-border/45 px-3 py-3">
                {recentSurfaceSupportList}
                {renderShiftNoteComposer("desktop")}
              </div>
            </details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
