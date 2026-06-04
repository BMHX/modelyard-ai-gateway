"use client";

import { useState } from "react";

import { ResourceCreateDialog } from "../components/resource-create-dialog";
import { Button } from "@/components/ui/button";

import { BudgetPolicyCreateForm, type BudgetPolicyCreateFormProps } from "./budget-policy-create-form";

type BudgetPolicyCreateDialogProps = BudgetPolicyCreateFormProps & {
  title: string;
  description: string;
  triggerLabel: string;
  triggerClassName?: string;
};

export function BudgetPolicyCreateDialog({
  title,
  description,
  triggerLabel,
  triggerClassName,
  ...formProps
}: BudgetPolicyCreateDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button className={triggerClassName} onClick={() => setOpen(true)} size="sm" type="button">
        {triggerLabel}
      </Button>

      <ResourceCreateDialog
        bodyClassName="space-y-5"
        description={description}
        onOpenChange={setOpen}
        open={open}
        size="md"
        title={title}
      >
        <BudgetPolicyCreateForm {...formProps} />
      </ResourceCreateDialog>
    </>
  );
}
