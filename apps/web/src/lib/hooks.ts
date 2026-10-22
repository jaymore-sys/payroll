import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ApiError, get } from './api';

export const useMasters = () => {
  const deps = useQuery<any[]>({ queryKey: ['departments'], queryFn: () => get('/departments') });
  const desigs = useQuery<any[]>({ queryKey: ['designations'], queryFn: () => get('/designations') });
  const branches = useQuery<any[]>({ queryKey: ['branches'], queryFn: () => get('/branches') });
  return { departments: deps.data ?? [], designations: desigs.data ?? [], branches: branches.data ?? [] };
};

/** Mutation with toast feedback and cache invalidation. */
export function useAct<TArgs = void, TRes = any>(fn: (a: TArgs) => Promise<TRes>, opts: { success?: string; invalidate?: QueryKey[]; onDone?: (r: TRes) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(opts.success);
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      opts.onDone?.(r);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
  });
}

/** Map server 422 details onto react-hook-form fields. */
export const fieldErrors = (e: unknown) => (e instanceof ApiError ? Object.fromEntries(e.details.filter((d) => d.path).map((d) => [d.path!, d.message])) : {});
