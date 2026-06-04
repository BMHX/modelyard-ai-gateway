export default function ProvidersLoading() {
  return (
    <section className="space-y-4">
      <div className="calm-toolbar-strip">
        <div className="calm-toolbar-strip__header">
          <div className="calm-toolbar-strip__title">
            <div className="calm-skeleton-block h-3 w-24 rounded-full" />
            <div className="calm-skeleton-block h-5 w-56 rounded-full" />
          </div>
          <div className="calm-skeleton-block h-8 w-24 rounded-full" />
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="calm-skeleton-block h-10 rounded-xl" />
          <div className="calm-skeleton-block h-10 rounded-xl" />
          <div className="calm-skeleton-block h-10 rounded-xl" />
        </div>
      </div>

      <div className="calm-skeleton-list">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="calm-skeleton-list__row" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="calm-skeleton-block h-4 w-44 max-w-full rounded-full" />
              <div className="calm-skeleton-block h-3.5 w-64 max-w-full rounded-full" />
            </div>
            <div className="calm-skeleton-block hidden h-8 w-28 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </section>
  );
}
