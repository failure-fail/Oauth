import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Overview", id: "overview" },
  { href: "/dashboard/chat", label: "Chat", id: "chat" },
  { href: "/dashboard/openai", label: "OpenAI API", id: "openai" },
  { href: "/account/providers", label: "Providers", id: "providers" },
  { href: "/dashboard#apps", label: "Apps", id: "apps" },
] as const;

export function AccountNav({
  active,
}: {
  active: "overview" | "chat" | "openai" | "providers" | "apps";
}) {
  return (
    <div className="account-subnav">
      {LINKS.map((link) => {
        const isActive = active === link.id;
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
