export default function UsageEventsLoading() {
  return (
    <section className="space-y-5">
      <div className="calm-toolbar-strip">
        <div className="calm-toolbar-strip__title">
          <div className="calm-skeleton-block h-3 w-24 rounded-full" />
          <div className="calm-skeleton-block h-6 w-52 rounded-full" />
          <div className="calm-skeleton-block h-4 w-72 max-w-full rounded-full" />
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="calm-skeleton-block h-10 rounded-xl" key={index} />
          ))}
        </div>
      </div>

      <div className="calm-stat-row">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="calm-stat min-w-[9rem]" key={index}>
            <span className="calm-skeleton-block h-3 w-16 rounded-full" />
            <span className="calm-skeleton-block h-3 w-10 rounded-full" />
          </div>
        ))}
      </div>

      <div className="calm-skeleton-list">
        {Array.from({ length: 8 }).map((_, index) => (
          <div className="calm-skeleton-list__row" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="calm-skeleton-block h-4 w-44 max-w-full rounded-full" />
              <div className="calm-skeleton-block h-3.5 w-72 max-w-full rounded-full" />
            </div>
            <div className="calm-skeleton-block hidden h-8 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </section>
  );
}
