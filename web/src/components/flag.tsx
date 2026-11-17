import { cn } from "@/lib/utils";

/** Bandera SVG (las emoji de bandera no se dibujan en Windows). Decorativa: el nombre del país va al lado. */
export function Flag({ code, className }: { code: string; className?: string }) {
  if (!/^[a-z]{2}$/i.test(code)) return null;
  return (
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      width={18}
      height={12}
      className={cn("inline-block h-3 w-[18px] shrink-0 rounded-[2px] object-cover align-[-1px] ring-1 ring-white/10", className)}
    />
  );
}
