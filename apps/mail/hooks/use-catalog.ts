import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTRPC, type Account, type Business, type Tag } from '@/lib/trpc';

/** Tags, businesses and accounts, indexed by id for rendering rows and chips. */
export function useCatalog() {
  const trpc = useTRPC();
  const tags = useQuery(trpc.catalog.tags.queryOptions());
  const businesses = useQuery(trpc.catalog.businesses.queryOptions());
  const accounts = useQuery({ ...trpc.accounts.list.queryOptions(), refetchInterval: (query) => (query.state.status === 'error' ? 3000 : 30_000) });

  return useMemo(
    () => ({
      tags: tags.data ?? [],
      businesses: businesses.data ?? [],
      accounts: accounts.data ?? [],
      tagById: new Map<string, Tag>((tags.data ?? []).map((t) => [t.id, t])),
      businessById: new Map<string, Business>((businesses.data ?? []).map((b) => [b.id, b])),
      accountById: new Map<string, Account>((accounts.data ?? []).map((a) => [a.id, a])),
      loaded: accounts.isSuccess,
      offline: accounts.isError && !accounts.data,
    }),
    [tags.data, businesses.data, accounts.data, accounts.isSuccess],
  );
}
