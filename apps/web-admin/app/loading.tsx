export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="calm-skeleton-block h-3 w-20 rounded-full" />
        <div className="calm-skeleton-block h-8 w-52 rounded-xl" />
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
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="calm-skeleton-list__row" key={index}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="calm-skeleton-block h-4 w-40 max-w-full rounded-full" />
              <div className="calm-skeleton-block h-3.5 w-64 max-w-full rounded-full" />
            </div>
            <div className="calm-skeleton-block hidden h-8 w-24 rounded-full sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
