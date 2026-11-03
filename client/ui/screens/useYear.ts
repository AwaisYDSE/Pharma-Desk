// The financial year open on this device, when it is an older one, and the balances brought forward into it.
// © Awais Amin
import { useStore, useLive } from '../store.tsx';
import { carryOf } from '../../core/years.ts';
import { yearOf, type YearCarry, type YearWindow } from '../../../shared/years.ts';

export function useOpenYear(): YearWindow | null {
  const { ctx, shop } = useStore();
  return ctx.yearView && shop?.years?.on ? yearOf(ctx.yearView, shop.years.startMonth) : null;
}

export function useCarry() {
  const { ctx } = useStore();
  return useLive(() => carryOf(ctx), [], null as Pick<YearCarry, 'accounts' | 'money'> | null);
}
