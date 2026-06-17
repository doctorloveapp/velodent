import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/frontend/shared/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-alabaster-grey-500/20 bg-glaucous-950 text-ink-black-50",
        success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
        warning: "border-amber-500/25 bg-amber-500/10 text-amber-400",
        danger: "border-rose-600/25 bg-rose-600/10 text-rose-400"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, className }))} {...props} />;
}

