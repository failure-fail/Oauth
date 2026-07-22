import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/chat", label: "Chat" },
  { href: "/account/providers", label: "Providers" },
  { href: "/dashboard#apps", label: "Apps" },
] as const;

export function AccountNav({ active }: { active: "overview" | "chat" | "providers" | "apps" }) {
  return (
    <div className="account-subnav">
      {LINKS.map((link) => {
        const isActive =
          (active === "overview" && link.href === "/dashboard") ||
          (active === "chat" && link.href === "/dashboard/chat") ||
          (active === "providers" && link.href === "/account/providers") ||
          (active === "apps" && link.href === "/dashboard#apps");
        return (
          <Link
            key={link.href}
            href={link.href}
            className={isActive ? "is-active" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
