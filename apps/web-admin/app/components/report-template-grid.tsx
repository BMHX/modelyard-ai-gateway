import { Link } from "@/i18n/navigation";
import { translateInlineText, type AppLocale } from "@/app/lib/i18n";

export type ReportTemplateCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  kindLabel: string;
  focusLabel: string;
  cadenceLabel: string;
};

export type RecurringReportCard = {
  id: string;
  title: string;
  description: string;
  href: string;
  cadenceLabel: string;
};

export function ReportTemplateGrid({
  templates,
  recurringPresets,
  activeTemplateId,
  activeCadence,
  locale,
}: {
  templates: ReportTemplateCard[];
  recurringPresets: RecurringReportCard[];
  activeTemplateId?: string | null;
  activeCadence?: string | null;
  locale: AppLocale;
}) {
  const normalizedActiveCadence = activeCadence?.toLowerCase() ?? null;
  const tr = (text: string) => translateInlineText(locale, text);

  return (
    <div className="stack">
      <div className="filter-section">
        <div className="filter-section__header">
          <strong>{tr("Report templates")}</strong>
          <span className="meta">{tr("One-off and recurring presets.")}</span>
        </div>
        <div className="button-row button-row--wrap">
          {templates.map((template) => (
            <Link
              key={template.id}
              className={`button button--ghost${activeTemplateId === template.id ? " button--active" : ""}`}
              href={template.href}
            >
              {template.title}
            </Link>
          ))}
        </div>
      </div>

      <div className="filter-section">
        <div className="filter-section__header">
          <strong>{tr("Recurring report starter")}</strong>
          <span className="meta">{tr("Cadence presets for repeat exports.")}</span>
        </div>
        <div className="button-row button-row--wrap">
          {recurringPresets.map((preset) => (
            <Link
              key={preset.id}
              className={`button button--ghost${normalizedActiveCadence === preset.cadenceLabel.toLowerCase() ? " button--active" : ""}`}
              href={preset.href}
            >
              {preset.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
