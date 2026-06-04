"use client";

import {
  type ChangeEvent,
  type ComponentPropsWithoutRef,
} from "react";

type AutoSubmitSelectProps = ComponentPropsWithoutRef<"select">;

export function AutoSubmitSelect({
  onChange,
  ...props
}: AutoSubmitSelectProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange?.(event);

    if (event.defaultPrevented) {
      return;
    }

    event.currentTarget.form?.requestSubmit();
  }

  return <select {...props} onChange={handleChange} />;
}
