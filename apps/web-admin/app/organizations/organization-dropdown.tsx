"use client";

import { Building2, MoreHorizontal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { OrganizationEditDialog } from "./organization-edit-dialog";
import { deleteOrganizationAction } from "./actions";
import { type AppLocale } from "../lib/i18n";
import { ConfirmSubmitButton } from "../components/confirm-submit-button";

type OrganizationDropdownProps = {
  organization: { id: string; name: string; slug: string | null };
  currentPageHref: string;
  locale: AppLocale;
};

export function OrganizationDropdown({
  organization,
  currentPageHref,
  locale,
}: OrganizationDropdownProps) {
  const deleteConfirmTitle = locale === "zh" ? `删除 ${organization.name}？` : `Delete ${organization.name}?`;
  const deleteConfirmDescription =
    locale === "zh"
      ? "此操作将永久删除该组织。所有关联的工作区记录将变为孤立状态。"
      : "This permanently removes the organization. All associated workspace records will be orphaned.";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <OrganizationEditDialog
          organization={organization}
          currentPageHref={currentPageHref}
          locale={locale}
        />
        <DropdownMenuSeparator />
        
        <form action={deleteOrganizationAction}>
          <input type="hidden" name="organizationId" value={organization.id} />
          <input type="hidden" name="redirectPath" value={currentPageHref} />
          <ConfirmSubmitButton
            className="w-full flex items-center px-2 py-1.5 text-sm text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer rounded-sm hover:bg-destructive/10 transition-colors"
            confirmTitle={deleteConfirmTitle}
            confirmDescription={deleteConfirmDescription}
            confirmLabel={locale === "zh" ? "确认删除" : "Confirm delete"}
            cancelLabel={locale === "zh" ? "取消" : "Cancel"}
            pendingLabel={
              <span className="flex items-center">
                <Trash2 className="mr-2 size-4 animate-pulse" />
                {locale === "zh" ? "正在删除..." : "Deleting..."}
              </span>
            }
          >
            <Trash2 className="mr-2 size-4" />
            {locale === "zh" ? "删除" : "Delete"}
          </ConfirmSubmitButton>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
