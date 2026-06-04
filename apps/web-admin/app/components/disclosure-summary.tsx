import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type DisclosureSummaryVariant = "section" | "tool" | "metadata";

type DisclosureSummaryProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  variant?: DisclosureSummaryVariant;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function DisclosureSummary({
  title,
  description,
  eyebrow,
  badge,
  meta,
  variant = "section",
  className,
  titleClassName,
  descriptionClassName,
}: DisclosureSummaryProps) {
  return (
    <div className={cn("disclosure-summary", `disclosure-summary--${variant}`, className)}>
      <div className="disclosure-summary__content">
        {eyebrow ? <p className="disclosure-summary__eyebrow">{eyebrow}</p> : null}
        <div className="disclosure-summary__header">
          <div className="min-w-0">
            <p className={cn("disclosure-summary__title", titleClassName)}>{title}</p>
            {description ? (
              <p className={cn("disclosure-summary__description", descriptionClassName)}>
                {description}
              </p>
            ) : null}
          </div>
          {badge ? <div className="disclosure-summary__badge">{badge}</div> : null}
        </div>
      </div>

      <div className="disclosure-summary__aside">
        {meta ? <span className="disclosure-summary__meta">{meta}</span> : null}
        <ChevronDown aria-hidden="true" className="disclosure-summary__chevron" strokeWidth={1.9} />
      </div>
    </div>
  );
}
