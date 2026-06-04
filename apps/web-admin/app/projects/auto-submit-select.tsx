"use client";

import type { SelectHTMLAttributes } from "react";

type AutoSubmitSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function AutoSubmitSelect({ children, onChange, ...props }: AutoSubmitSelectProps) {
  return (
    <select
      {...props}
      onChange={(e) => {
        onChange?.(e);
        e.currentTarget.form?.requestSubmit();
      }}
    >
      {children}
    </select>
  );
}
