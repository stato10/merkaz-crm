import { Search } from "lucide-react";
import { cx, inputClass } from "./ui";

/** Searches contacts by name, email, phone or company. Plain GET form: works before JS loads. */
export function GlobalSearch({ className }: { className?: string }) {
  return (
    <form action="/contacts" role="search" className={cx("relative", className)}>
      <Search
        size={15}
        aria-hidden
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        name="q"
        type="search"
        aria-label="חיפוש אנשי קשר"
        placeholder="חיפוש איש קשר, טלפון, אימייל…"
        className={cx(inputClass, "bg-surface-2 ps-9 focus:bg-surface")}
      />
    </form>
  );
}
