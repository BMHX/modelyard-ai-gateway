"use client";

import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { ResourceInlineNotice } from "../components/resource-inline-notice";
import { buildClientActionNoticeHref } from "../lib/client-action-notice";
import { translateInlineText, type AppLocale } from "../lib/i18n";
import { createOrganizationMutationAction } from "./actions";

type OrganizationsCreateDialogProps = {
  currentPageHref: string;
  locale: AppLocale;
  triggerLabel?: ReactNode;
  triggerSize?: "default" | "sm" | "lg";
  triggerVariant?: "default" | "secondary" | "outline" | "ghost";
};

export function OrganizationsCreateDialog({
  currentPageHref,
  locale,
  triggerLabel,
  triggerSize = "sm",
  triggerVariant = "default",
}: OrganizationsCreateDialogProps) {
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const title = translateInlineText(locale, "New organization");
  const submitLabel = translateInlineText(locale, "Create organization");
  const cancelLabel = translateInlineText(locale, "Cancel");
  const description =
    locale === "zh"
      ? "以弹窗方式添加组织记录，保持目录页聚焦在浏览与管理。"
      : "Add an organization record without leaving the directory.";

  useEffect(() => {
    if (!open) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [open]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setErrorMessage(null);
      setIsPending(false);
    }
  }

  function handleSubmit(formData: FormData) {
    setIsPending(true);
    setErrorMessage(null);

    startTransition(async () => {
      const result = await createOrganizationMutationAction({
        name: String(formData.get("name") ?? ""),
        slug: String(formData.get("slug") ?? ""),
      });

      setIsPending(false);

      if (result.status === "error") {
        setErrorMessage(result.message);
        return;
      }

      setOpen(false);
      setName("");
      setSlug("");
      router.replace(
        buildClientActionNoticeHref(
          currentPageHref,
          {
            notice: "created",
            message: result.message,
            focusOrganizationId: result.organization.id,
          },
          `organization-${result.organization.id}`,
        ),
      );
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size={triggerSize} type="button" variant={triggerVariant}>
        {triggerLabel ?? title}
      </Button>

      <ResourceCreateDialog
        description={description}
        onOpenChange={handleOpenChange}
        open={open}
        size="sm"
        title={title}
      >
        <form
          action={handleSubmit}
          className="grid gap-4"
        >
          {errorMessage ? (
            <ResourceInlineNotice
              label={translateInlineText(locale, "Error")}
              message={errorMessage}
              tone="error"
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="organization-create-name">
                {translateInlineText(locale, "Name")}
              </label>
              <Input
                id="organization-create-name"
                name="name"
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder={translateInlineText(locale, "Acme China")}
                ref={nameInputRef}
                required
                value={name}
              />
            </div>

            <div className="grid gap-2">
              <label className="text-[11px] font-medium text-foreground" htmlFor="organization-create-slug">
                {translateInlineText(locale, "Slug")}
              </label>
              <Input
                id="organization-create-slug"
                name="slug"
                onChange={(event) => setSlug(event.currentTarget.value)}
                placeholder={translateInlineText(locale, "acme-china (optional)")}
                value={slug}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/45 pt-4">
            <Button onClick={() => handleOpenChange(false)} type="button" variant="ghost">
              {cancelLabel}
            </Button>
            <Button disabled={isPending} type="submit">
              {isPending ? translateInlineText(locale, "Creating...") : submitLabel}
            </Button>
          </div>
        </form>
      </ResourceCreateDialog>
    </>
  );
}
