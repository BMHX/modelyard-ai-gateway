import MembersPage from "../page";

export const dynamic = "force-dynamic";

type ReviewsPageProps = {
  searchParams?: Promise<{
    focusMemberId?: string;
    workspaceId?: string;
    q?: string;
    status?: string;
    role?: string;
    view?: string;
    section?: string;
    focus?: string;
    notice?: string;
    message?: string;
    returnTo?: string;
  }>;
};

export default async function MemberReviewsPage({
  searchParams,
}: ReviewsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};

  return MembersPage({
    searchParams: Promise.resolve({
      ...resolvedSearchParams,
      section: "access-reviews",
    }),
  });
}
