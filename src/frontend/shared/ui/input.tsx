import type { InputHTMLAttributes } from "react";
import { cn } from "@/frontend/shared/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex w-full rounded-md border border-alabaster-grey-500/20 bg-glaucous-950 px-3 py-2 text-sm text-white outline-none placeholder:text-alabaster-grey-500 focus:border-powder-blue-500 focus:ring-2 focus:ring-powder-blue-500/20",
        className
      )}
      {...props}
    />
  );
}

