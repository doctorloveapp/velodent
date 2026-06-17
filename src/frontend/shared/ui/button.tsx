import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/frontend/shared/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-powder-blue-500/70 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-powder-blue-500 text-white hover:bg-pale-sky-500",
        secondary: "border border-alabaster-grey-500/20 bg-glaucous-950 text-ink-black-50 hover:bg-glaucous-500/20",
        ghost: "text-alabaster-grey-500 hover:bg-glaucous-950 hover:text-white",
        nav: "h-10 px-3 text-alabaster-grey-500 hover:bg-glaucous-950 hover:text-white",
        navActive: "h-10 border border-powder-blue-500/30 bg-powder-blue-950 px-3 text-white shadow-[0_0_18px_rgba(47,127,208,0.16)]"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ asChild = false, className, size, variant, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

