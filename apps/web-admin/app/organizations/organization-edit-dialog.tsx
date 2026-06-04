"use client";

import { useState } from "react";
import { Building2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { translateInlineText, type AppLocale } from "../lib/i18n";
import { updateOrganizationAction } from "./actions";

type OrganizationEditDialogProps = {
  organization: { id: string; name: string; slug: string | null };
  currentPageHref: string;
  locale: AppLocale;
  triggerMode?: "menu" | "button";
};

export function OrganizationEditDialog({
  organization,
  currentPageHref,
  locale,
  triggerMode = "menu",
}: OrganizationEditDialogProps) {
  const [open, setOpen] = useState(false);

  const title = locale === "zh" ? "编辑组织" : "Edit organization";
  const submitLabel = locale === "zh" ? "保存更改" : "Save changes";
  const cancelLabel = translateInlineText(locale, "Cancel");

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        {triggerMode === "button" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Pencil className="mr-1.5 size-3.5" />
            {locale === "zh" ? "编辑" : "Edit"}
          </Button>
        ) : (
          <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
            <Pencil className="mr-2 size-4" />
            {locale === "zh" ? "编辑" : "Edit"}
          </DropdownMenuItem>
        )}
      </DialogTrigger>
      
      <DialogContent
        className="sm:max-w-[460px]"
        data-no-row-navigation="true"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <form action={updateOrganizationAction}>
          <input type="hidden" name="organizationId" value={organization.id} />
          <input type="hidden" name="redirectPath" value={`${currentPageHref}#organization-${organization.id}`} />

          <DialogHeader className="mb-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold tracking-tight">
                  {title}
                </DialogTitle>
                <DialogDescription className="text-sm">
                  {locale === "zh" ? "更新组织的名称或唯一标识符" : "Update the organization's name or slug."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid gap-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-2">
                <label htmlFor={`edit-name-${organization.id}`} className="text-sm font-semibold">
                  {translateInlineText(locale, "Name")}
                </label>
                <Input
                  id={`edit-name-${organization.id}`}
                  name="name"
                  defaultValue={organization.name}
                  className="h-11 border-border/60 bg-muted/30 focus-visible:bg-background transition-colors"
                  required
                />
              </div>

              <div className="grid gap-2">
                <label htmlFor={`edit-slug-${organization.id}`} className="text-sm font-semibold">
                  {translateInlineText(locale, "Slug")}
                </label>
                <Input
                  id={`edit-slug-${organization.id}`}
                  name="slug"
                  defaultValue={organization.slug ?? ""}
                  className="h-11 border-border/60 bg-muted/30 focus-visible:bg-background transition-colors font-mono text-[13px]"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="mt-8 gap-2 sm:gap-0 border-t pt-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              {cancelLabel}
            </Button>
            <Button type="submit" className="min-w-[120px]">
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
