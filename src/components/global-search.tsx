import { Search } from "lucide-react";
import { cx, inputClass } from "./ui";

/** Searches contacts by name, email, phone or company. Plain GET form: works before JS loads. */
export function GlobalSearch({ className, bare }: { className?: string; bare?: boolean }) {
  return (
    <form action="/contacts" role="search" className={cx("relative", className)}>
      <Search
        size={18}
        strokeWidth={1.6}
        aria-hidden
        className={cx("pointer-events-none absolute top-1/2 -translate-y-1/2 text-icon", bare ? "start-0" : "start-3")}
      />
      <input
        name="q"
        type="search"
        aria-label="חיפוש אנשי קשר"
        placeholder="חיפוש כללי: איש קשר, טלפון, אימייל…"
        className={
          bare
            ? "h-10 w-full bg-transparent ps-8 text-[13px] text-ink placeholder:text-muted focus:outline-none"
            : cx(inputClass, "bg-surface-2 ps-10 focus:bg-surface")
        }
      />
    </form>
  );
}
