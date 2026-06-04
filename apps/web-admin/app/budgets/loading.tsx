export default function BudgetsLoading() {
  return (
    <section className="space-y-5">
      <div className="calm-toolbar-strip">
        <div className="calm-toolbar-strip__header">
          <div className="calm-toolbar-strip__title">
            <div className="calm-skeleton-block h-3 w-24 rounded-full" />
            <div className="calm-skeleton-block h-6 w-60 rounded-full" />
            <div className="calm-skeleton-block h-4 w-72 max-w-full rounded-full" />
          </div>
          <div className="flex gap-2">
            <div className="calm-skeleton-block h-6 w-24 rounded-full" />
            <div className="calm-skeleton-block h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="calm-skeleton-block h-10 rounded-xl" key={index} />
          ))}
        </div>
      </div>

      <div className="calm-stat-row">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="calm-stat min-w-[9rem]" key={index}>
            <span className="calm-skeleton-block h-3 w-16 rounded-full" />
            <span className="calm-skeleton-block h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="rounded-xl border border-border/55 bg-[color:color-mix(in_srgb,var(--surface-1)_97%,var(--surface-canvas)_3%)] p-4" key={index}>
            <div className="space-y-3">
              <div className="calm-skeleton-block h-4 w-44 max-w-full rounded-full" />
              <div className="calm-skeleton-block h-3.5 w-80 max-w-full rounded-full" />
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="calm-skeleton-block h-12 rounded-xl" />
                <div className="calm-skeleton-block h-12 rounded-xl" />
                <div className="calm-skeleton-block h-12 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
